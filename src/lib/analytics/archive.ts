import { displayReferences } from "@ripota/parks/display";

export const afterActionScope = "activate-ri-2026";
export const afterActionRetainUntil = "2027-01-01T00:00:00.000Z";
export const afterActionBucket = "ripota-org-event-archives";

// This is a private evidence export, not a public endpoint. Exclude credentials,
// contact details, and Ops body text (including edited/removed body history).
export const evidenceTables = [
  { name: "activate_ri_pota_spot_archive", scope: "event_id" },
  { name: "activate_ri_pota_collection_runs", scope: "event_id" },
  { name: "activate_ri_pota_activation_revisions", scope: "event_id" },
  { name: "activate_ri_pota_activation_evidence", scope: "event_id" },
  { name: "activate_ri_pota_spot_observations", scope: "event_id" },
  { name: "activate_ri_pota_reconciliation", scope: "event_id" },
  { name: "analytics_anonymous_events", scope: "scope" },
  { name: "analytics_collection_metadata", scope: "scope" },
  { name: "analytics_feature_events", scope: "scope" },
  { name: "analytics_feature_usage", scope: "scope" },
  { name: "analytics_feature_usage_legacy", scope: "scope" },
  { name: "analytics_ingestion_daily", scope: null },
  { name: "operational_health_daily", scope: "scope" },
  { name: "activate_ri_ops_foreground_samples", scope: "event_id" },
  { name: "activate_ri_ops_message_exposures", scope: "event_id" },
  { name: "activate_ri_stops", scope: "event_id", columns: "id,activator_id,event_id,park_reference,start_at,end_at,bands_json,modes_json,status,created_at,updated_at,cancelled_at,cancel_reason" },
  { name: "activate_ri_activators", scope: "event_id", columns: "id,event_id,primary_callsign,status,created_at,updated_at,approved_at" },
  { name: "activate_ri_activity_events", scope: "event_id", columns: "id,event_id,plan_id,stop_id,actor_type,action,details_json,created_at" },
  { name: "activate_ri_ops_memberships", scope: "event_id", columns: "event_id,activator_id,status,accepted_rules_version,accepted_rules_at,created_at,updated_at" },
  { name: "activate_ri_ops_messages", scope: "event_id", columns: "id,event_id,author_type,author_activator_id,kind,park_reference,stop_id,created_at,edited_at,resolved_at,removed_at,email_broadcast_requested" },
  { name: "activate_ri_ops_events", scope: "event_id", columns: "sequence,event_id,event_type,message_id,created_at" },
  { name: "activate_ri_ops_email_deliveries", scope: "event_id", columns: "message_id,event_id,is_admin,category,status,attempt_count,next_attempt_at,created_at,sent_at" },
] as const;

export type ArchiveQuery = (sql: string, bindings: (string | number)[]) => Promise<Record<string, unknown>[]>;
export type ArchiveWrite = (key: string, body: string, sha256: string) => Promise<void>;
export type ArchiveFile = { key: string; bytes: number; sha256: string; rows?: number };
export type ArchiveManifest = {
  schemaVersion: 1;
  scope: string;
  prefix: string;
  startedAt: string;
  finishedAt: string;
  retainUntil: string;
  eventWindow: { since: string; until: string; reconciliationUntil: string };
  consistency: string;
  limitations: string[];
  tables: { name: string; rows: number; highWaterRowid: number }[];
  files: ArchiveFile[];
};

export async function sha256(value: string): Promise<string> {
  const bytes = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)));
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** Publish the manifest last: its existence certifies every page was written. */
export async function exportAfterActionEvidence(
  query: ArchiveQuery,
  write: ArchiveWrite,
  options: { prefix: string; now?: () => Date; consistentDatabase?: boolean; pageSize?: number },
): Promise<ArchiveManifest> {
  const now = options.now ?? (() => new Date());
  const pageSize = options.pageSize ?? 500;
  if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > 1000) throw new Error("Invalid archive page size");
  if (!/^activate-ri-2026\/[a-zA-Z0-9_./-]+$/.test(options.prefix) || options.prefix.includes("..")) {
    throw new Error("Invalid archive prefix");
  }
  const manifest: ArchiveManifest = {
    schemaVersion: 1, scope: afterActionScope, prefix: options.prefix,
    startedAt: now().toISOString(), finishedAt: "", retainUntil: afterActionRetainUntil,
    eventWindow: { since: "2026-09-10T00:00:00.000Z", until: "2026-09-14T00:00:00.000Z", reconciliationUntil: "2026-09-21T00:00:00.000Z" },
    consistency: options.consistentDatabase ? "single D1 export restored to SQLite" : "per-table rowid high-water marks; current rows can change during export",
    limitations: [
      "Instrumentation begins at each stream's recorded started_at; no earlier behavioral observations are invented.",
      "Anonymous browser identifiers are HMAC keys, not people or authenticated identities; privacy opt-outs remain unobserved.",
      "Checklist progress is all-time self-reported progress, not verified event QSOs.",
      "Spot reports are observed evidence, not verified contacts or complete operating intervals.",
      "Ops exports contain metadata, not message body history; foreground/exposure is not proof of reading.",
      "Notification exports retain aggregate delivery facts without recipient contact details; use private D1 for recipient-level attribution.",
      "Cloudflare Analytics Engine history is separate from these D1 records; do not add overlapping counts.",
    ],
    tables: [], files: [],
  };
  const legacyIds = new Map<string, Promise<string>>();
  function privateId(value: string) {
    if (!legacyIds.has(value)) legacyIds.set(value, sha256(`ripota-archive-legacy-id:${value}`).then((hash) => `legacy:${hash}`));
    return legacyIds.get(value)!;
  }
  async function file(name: string, value: unknown, rows?: number) {
    const body = `${JSON.stringify(value)}\n`;
    const key = `${options.prefix}/${name}`;
    const digest = await sha256(body);
    await write(key, body, digest);
    manifest.files.push({ key, bytes: new TextEncoder().encode(body).length, sha256: digest, ...(rows === undefined ? {} : { rows }) });
  }

  await file("park-catalog.json", displayReferences);
  for (const table of evidenceTables) {
    const where = table.scope ? `${table.scope} = ?` : "1 = 1";
    const base: (string | number)[] = table.scope ? [afterActionScope] : [];
    const [boundary] = await query(`SELECT COALESCE(MAX(rowid), 0) AS high_water, COUNT(*) AS count FROM ${table.name} WHERE ${where}`, base);
    const highWater = Number(boundary?.high_water ?? 0);
    const expected = Number(boundary?.count ?? 0);
    let cursor = 0;
    let count = 0;
    let page = 0;
    do {
      const columns = "columns" in table ? table.columns : "*";
      const rows = await query(`SELECT rowid AS _export_rowid, ${columns} FROM ${table.name} WHERE ${where} AND rowid > ? AND rowid <= ? ORDER BY rowid LIMIT ?`, [...base, cursor, highWater, pageSize]);
      if (!rows.length && page > 0) break;
      for (const row of rows) {
        cursor = Number(row._export_rowid);
        delete row._export_rowid;
      }
      // Audit details are plan snapshots; omit contact/token/organizer note
      // fields. Email-bearing legacy IDs are pseudonymized consistently so
      // evidence joins still work without exporting the email itself.
      if (table.name === "activate_ri_activity_events") {
        for (const row of rows) row.details_json = JSON.stringify(await sanitizePlanEvidence(JSON.parse(String(row.details_json)), privateId));
      }
      if (!table.name.includes("pota")) {
        for (let index = 0; index < rows.length; index++) rows[index] = await sanitizePlanEvidence(rows[index], privateId) as Record<string, unknown>;
      }
      await file(`${table.name}/${String(page).padStart(5, "0")}.json`, rows, rows.length);
      count += rows.length;
      page += 1;
      if (rows.length < pageSize) break;
    } while (cursor < highWater);
    if (count !== expected) throw new Error(`Archive row count changed for ${table.name}: expected ${expected}, exported ${count}`);
    manifest.tables.push({ name: table.name, rows: count, highWaterRowid: highWater });
  }
  manifest.finishedAt = now().toISOString();
  const body = `${JSON.stringify(manifest, null, 2)}\n`;
  await write(`${options.prefix}/manifest.json`, body, await sha256(body));
  return manifest;
}

async function sanitizePlanEvidence(value: unknown, privateId: (value: string) => Promise<string>, key = ""): Promise<unknown> {
  if (typeof value === "string") {
    if (/id$/i.test(key) && value.includes("@")) return privateId(value);
    return value.replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, "[redacted-email]");
  }
  if (Array.isArray(value)) return Promise.all(value.map((entry) => sanitizePlanEvidence(entry, privateId)));
  if (value && typeof value === "object") {
    return Object.fromEntries(await Promise.all(Object.entries(value).filter(([name, entry]) =>
      !/token|secret|password|^body$|organizer.?notes?/i.test(name) && !(typeof entry === 'string' && /email|phone/i.test(name)),
    ).map(async ([name, entry]) => [name, await sanitizePlanEvidence(entry, privateId, name)])));
  }
  return value;
}
