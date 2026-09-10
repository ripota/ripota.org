import { afterEach, describe, expect, it } from "vitest";
import { exportAfterActionEvidence, sha256, type ArchiveQuery } from "./archive";
import { createMigratedSqliteD1 } from "../../worker/test-utils/sqlite-d1";

const databases: ReturnType<typeof createMigratedSqliteD1>[] = [];
afterEach(() => databases.splice(0).forEach((db) => db.close()));
function setup() {
  const context = createMigratedSqliteD1();
  databases.push(context);
  const query: ArchiveQuery = async (sql, bindings) => (await context.DB.prepare(sql).bind(...bindings).all<Record<string, unknown>>()).results;
  return { db: context.DB, query };
}
describe("after-action snapshots", () => {
  it("exports every evidence table with count and checksum verification and publishes manifest last", async () => {
    const { db, query } = setup();
    await db.prepare(`INSERT INTO analytics_anonymous_events
      (scope,subject_hash,event_id,event_name,schema_version,occurred_at,received_at,properties_json)
      VALUES ('activate-ri-2026','hmac','one','hunter_progress_changed',2,'2026-09-10T00:00:00.000Z','2026-09-10T00:00:00.000Z','{"completedCount":4}')`).run();
    const files = new Map<string, string>();
    const manifest = await exportAfterActionEvidence(query, async (key, body, digest) => {
      expect(await sha256(body)).toBe(digest);
      files.set(key, body);
    }, { prefix: "activate-ri-2026/test/snapshot", pageSize: 1, consistentDatabase: true });
    expect(manifest.tables.find((table) => table.name === "analytics_anonymous_events")?.rows).toBe(1);
    expect([...files.keys()].at(-1)).toBe("activate-ri-2026/test/snapshot/manifest.json");
    expect(manifest.files.every((file) => files.has(file.key))).toBe(true);
    expect(manifest.retainUntil).toBe("2027-01-01T00:00:00.000Z");
    expect(JSON.parse(files.get("activate-ri-2026/test/snapshot/analytics_anonymous_events/00000.json")!)[0]).not.toHaveProperty("_export_rowid");
  });

  it("does not publish a complete manifest if any object write fails", async () => {
    const { query } = setup();
    const written: string[] = [];
    await expect(exportAfterActionEvidence(query, async (key) => {
      if (key.includes("analytics_anonymous_events")) throw new Error("unavailable");
      written.push(key);
    }, { prefix: "activate-ri-2026/test/failed" })).rejects.toThrow("unavailable");
    expect(written.some((key) => key.endsWith("manifest.json"))).toBe(false);
  });

  it("fails closed if source deletion changes the counted export", async () => {
    const { query } = setup();
    const inconsistent: ArchiveQuery = async (sql, bindings) => {
      const rows = await query(sql, bindings);
      if (sql.includes("COUNT(*)") && sql.includes("analytics_collection_metadata")) rows[0]!.count = 999;
      return rows;
    };
    await expect(exportAfterActionEvidence(inconsistent, async () => {}, { prefix: "activate-ri-2026/test/inconsistent" }))
      .rejects.toThrow("Archive row count changed");
  });
});
