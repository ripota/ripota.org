import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync, chmodSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { pathToFileURL } from "node:url";
import { afterActionBucket, afterActionScope, exportAfterActionEvidence, sha256, type ArchiveFile } from "../src/lib/analytics/archive.ts";
import { collectAnalyticsReport, parseAnalyticsReportArgs } from "./analytics-report.ts";

type ExportOptions = { since: string; until: string; directory: string; upload: boolean; legacyOnly: boolean };
export function parseExportOptions(args: string[], now = new Date()): ExportOptions {
  const options: ExportOptions = { since: "2026-08-31T19:34:14.000Z", until: now.toISOString(), directory: "tmp/aar-exports", upload: false, legacyOnly: false };
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg === "--upload") options.upload = true;
    else if (arg === "--legacy-only") options.legacyOnly = true;
    else if (["--since", "--until", "--directory"].includes(arg!)) {
      const value = args[++index];
      if (!value || value.startsWith("--")) throw new Error(`Missing value for ${arg}`);
      if (arg === "--since") options.since = value;
      else if (arg === "--until") options.until = value;
      else options.directory = value;
    } else throw new Error("Usage: mise run analytics:export -- [--since ISO] [--until ISO] [--directory PATH] [--upload] [--legacy-only]");
  }
  const start = Date.parse(options.since);
  const end = Date.parse(options.until);
  if (!Number.isFinite(start) || !Number.isFinite(end) || start >= end) throw new Error("Expected a valid increasing [since, until) interval");
  // Analytics Engine timestamps have second precision.
  options.since = new Date(Math.floor(start / 1000) * 1000).toISOString();
  options.until = new Date(Math.floor(end / 1000) * 1000).toISOString();
  if (options.since >= options.until) throw new Error("Expected an increasing interval at second precision");
  return options;
}

function wrangler(args: string[]): string {
  const result = spawnSync("npm", ["exec", "wrangler", "--", ...args], { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 });
  if (result.status !== 0) throw new Error(`Wrangler ${args.slice(0, 2).join(" ")} failed (exit ${result.status}); no complete archive was published.`);
  return result.stdout;
}
function wranglerJson<T>(args: string[]): T { return JSON.parse(wrangler([...args, "--json"])) as T; }

export async function readAnalyticsHistory(
  query: (since: string, until: string) => Promise<Record<string, unknown>[]>,
  since: string,
  until: string,
): Promise<Record<string, unknown>[]> {
  const rows = await query(since, until);
  if (rows.length < 10_000) return rows;
  const start = Date.parse(since);
  const end = Date.parse(until);
  const midpoint = Math.floor((start + end) / 2000) * 1000;
  if (midpoint <= start || midpoint >= end) throw new Error("Analytics history exceeds page limit within one second; export is incomplete");
  const middle = new Date(midpoint).toISOString();
  return [...await readAnalyticsHistory(query, since, middle), ...await readAnalyticsHistory(query, middle, until)];
}

async function collectHistory(since: string, until: string) {
  const identity = wranglerJson<{ accounts?: { id: string }[] }>(["whoami"]);
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID ?? (identity.accounts?.length === 1 ? identity.accounts[0]!.id : null);
  if (!accountId) throw new Error("Select a Cloudflare account before exporting");
  const { token } = wranglerJson<{ token?: string }>(["auth", "token"]);
  if (!token) throw new Error("Cloudflare authentication unavailable");
  return readAnalyticsHistory(async (from, to) => {
    const time = (value: string) => value.replace("T", " ").slice(0, 19);
    const columns = ["timestamp", "index1", ...Array.from({length: 20}, (_, n) => `blob${n + 1}`), ...Array.from({length: 20}, (_, n) => `double${n + 1}`), "_sample_interval"].join(", ");
    const sql = `SELECT ${columns} FROM ripota_usage WHERE blob1 = '${afterActionScope}' AND timestamp >= toDateTime('${time(from)}') AND timestamp < toDateTime('${time(to)}') ORDER BY timestamp LIMIT 10000`;
    const response = await fetch(`https://api.cloudflare.com/client/v4/accounts/${accountId}/analytics_engine/sql`, {
      method: "POST", headers: { authorization: `Bearer ${token}` }, body: sql,
    });
    if (!response.ok) throw new Error(`Analytics Engine history export failed (${response.status})`);
    const body = await response.json() as { data?: Record<string, unknown>[] };
    if (!Array.isArray(body.data)) throw new Error("Analytics Engine returned no data array");
    return body.data;
  }, since, until);
}

export async function exportAnalytics(options: ExportOptions) {
  const stamp = new Date().toISOString().replaceAll(":", "-");
  const id = `${stamp}-${crypto.randomUUID()}`;
  const directory = resolve(options.directory, id);
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const prefix = `${afterActionScope}/manual/${id}`;
  const files: ArchiveFile[] = [];
  const write = async (key: string, body: string, digest: string) => {
    const relative = key.slice(prefix.length + 1);
    const file = resolve(directory, relative);
    mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
    writeFileSync(file, body, { mode: 0o600, flag: "wx" });
    if (await sha256(readFileSync(file, "utf8")) !== digest) throw new Error("Local archive checksum mismatch");
    files.push({ key, bytes: Buffer.byteLength(body), sha256: digest });
  };
  const history = await collectHistory(options.since, options.until);
  const historyBody = `${JSON.stringify({ schemaVersion: 1, scope: afterActionScope, since: options.since, until: options.until,
    completeness: "Cloudflare-returned sampled observations; preserve _sample_interval; not exact unsampled people or event counts",
    containsPrivateHmacKeys: true, rows: history })}\n`;
  await write(`${prefix}/analytics-engine-history.json`, historyBody, await sha256(historyBody));

  if (!options.legacyOnly) {
    const backup = resolve(directory, "production-d1.sql");
    wrangler(["d1", "export", "ripota-org", "--remote", "--env=", "--output", backup]);
    chmodSync(backup, 0o600);
    const sqlite = new DatabaseSync(":memory:");
    try {
      sqlite.exec(readFileSync(backup, "utf8"));
      const integrity = sqlite.prepare("PRAGMA integrity_check").get();
      if (Object.values(integrity ?? {})[0] !== "ok") throw new Error("D1 backup failed integrity check");
      await exportAfterActionEvidence(async (sql, bindings) => sqlite.prepare(sql).all(...bindings) as Record<string, unknown>[], write, { prefix, consistentDatabase: true });
    } finally { sqlite.close(); }
    const report = await collectAnalyticsReport(parseAnalyticsReportArgs(["--json", "--since", options.since, "--until", options.until]));
    const reportBody = `${JSON.stringify(report, null, 2)}\n`;
    await write(`${prefix}/analytics-report.json`, reportBody, await sha256(reportBody));
    // The full recovery backup stays private and local; R2 gets selected evidence.
  }
  const completeBody = `${JSON.stringify({ schemaVersion: 1, scope: afterActionScope, generatedAt: new Date().toISOString(),
    since: options.since, until: options.until, legacyOnly: options.legacyOnly,
    retainUntil: "2027-01-01T00:00:00.000Z", files }, null, 2)}\n`;
  const completionKey = `${prefix}/export-complete.json`;
  await write(completionKey, completeBody, await sha256(completeBody));

  if (options.upload) {
    // Publish completion last, verify each upload by downloading and hashing it.
    const verifyFile = resolve(directory, ".r2-verification");
    for (const file of files) {
      const path = resolve(directory, file.key.slice(prefix.length + 1));
      wrangler(["r2", "object", "put", `${afterActionBucket}/${file.key}`, "--remote", "--file", path, "--content-type", "application/json"]);
      wrangler(["r2", "object", "get", `${afterActionBucket}/${file.key}`, "--remote", "--file", verifyFile]);
      chmodSync(verifyFile, 0o600);
      if (await sha256(readFileSync(verifyFile, "utf8")) !== file.sha256) throw new Error("R2 download checksum mismatch");
    }
  }
  return { directory, prefix, uploaded: options.upload, files: files.length, engineRows: history.length, since: options.since, until: options.until };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  exportAnalytics(parseExportOptions(process.argv.slice(2)))
    .then((result) => process.stdout.write(`${JSON.stringify(result, null, 2)}\n`))
    .catch((error) => { process.stderr.write(`${error instanceof Error ? error.message : "Archive failed"}\n`); process.exitCode = 1; });
}
