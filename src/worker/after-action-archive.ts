import { afterActionRetainUntil, afterActionScope, exportAfterActionEvidence } from "../lib/analytics/archive";
import type { Env } from "./env";
import { logWorkerError } from "./logging";

export const afterActionArchiveCron = "43 * * 9 *";
export const afterActionSnapshotUntil = "2026-10-01T00:00:00.000Z";

export async function runAfterActionArchive(env: Env, scheduledAt: number): Promise<void> {
  const snapshotUntil = Date.parse(afterActionSnapshotUntil);
  if (!env.EVENT_ARCHIVES || scheduledAt >= snapshotUntil || Date.now() >= snapshotUntil) return;
  const startedAt = new Date().toISOString();
  const day = new Date(scheduledAt).toISOString().slice(0, 10);
  const id = `${afterActionScope}:${day}`;
  const prefix = `${afterActionScope}/scheduled/${day}/${crypto.randomUUID()}`;
  const claim = await env.DB.prepare(`INSERT INTO analytics_archive_exports (id, scope, prefix, status, started_at)
    VALUES (?, ?, ?, 'running', ?) ON CONFLICT(id) DO NOTHING`).bind(id, afterActionScope, prefix, startedAt).run();
  if (claim.meta.changes === 0) {
    // One complete snapshot per UTC day, with hourly retry after failure or a
    // crashed execution. Claim atomically so overlapping triggers cannot race.
    const retry = await env.DB.prepare(`UPDATE analytics_archive_exports
      SET status = 'running', prefix = ?, started_at = ?, finished_at = NULL, error_category = ''
      WHERE id = ? AND (status = 'failed' OR (status = 'running' AND started_at < ?))`)
      .bind(prefix, startedAt, id, new Date(Date.now() - 30 * 60_000).toISOString()).run();
    if (retry.meta.changes === 0) return;
  }
  try {
    const manifest = await exportAfterActionEvidence(
      async (sql, bindings) => {
        const result = await env.DB.prepare(sql).bind(...bindings).all<Record<string, unknown>>();
        if (!result.success) throw new Error("Archive source query failed");
        return result.results;
      },
      async (key, body, digest) => {
        const object = await env.EVENT_ARCHIVES!.put(key, body, {
          onlyIf: { etagDoesNotMatch: "*" },
          httpMetadata: { contentType: "application/json", cacheControl: "private, no-store" },
          customMetadata: { sha256: digest, retainUntil: afterActionRetainUntil },
          sha256: digest,
        });
        if (!object) throw new Error("Archive write was not accepted");
        const check = await env.EVENT_ARCHIVES!.head(key);
        if (!check || check.size !== new TextEncoder().encode(body).length || check.customMetadata?.sha256 !== digest) {
          throw new Error("Archive object verification failed");
        }
      },
      { prefix },
    );
    const rows = manifest.tables.reduce((sum, table) => sum + table.rows, 0);
    const completed = await env.DB.prepare(`UPDATE analytics_archive_exports SET status = 'complete', finished_at = ?, table_count = ?, row_count = ? WHERE id = ? AND prefix = ? AND status = 'running'`)
      .bind(manifest.finishedAt, manifest.tables.length, rows, id, prefix).run();
    if (completed.meta.changes === 1) console.log(JSON.stringify({ event: "after-action-archive-complete", id, tables: manifest.tables.length, rows }));
  } catch (error) {
    await env.DB.prepare(`UPDATE analytics_archive_exports SET status = 'failed', finished_at = ?, error_category = 'export' WHERE id = ? AND prefix = ? AND status = 'running'`)
      .bind(new Date().toISOString(), id, prefix).run();
    logWorkerError("after-action-archive-failed", error, { category: "storage" });
    throw error;
  }
}
