import type { Env } from "./env";

export type OpsEngagementInput = {
  messageIds: string[];
  entrySource: "direct" | "message_link";
};

export async function readOpsEngagement(request: Request): Promise<OpsEngagementInput | null> {
  if (!request.headers.get("content-type")?.includes("application/json") || !request.body) return null;
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      length += next.value.byteLength;
      if (length > 8192) {
        await reader.cancel();
        return null;
      }
      chunks.push(next.value);
    }
    const bytes = new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    const input: unknown = JSON.parse(new TextDecoder().decode(bytes));
    if (!input || typeof input !== "object" || Array.isArray(input)) return null;
    const value = input as Record<string, unknown>;
    if (Object.keys(value).some((key) => !["messageIds", "entrySource"].includes(key))) return null;
    if (value.entrySource !== "direct" && value.entrySource !== "message_link") return null;
    if (!Array.isArray(value.messageIds) || value.messageIds.length > 50 ||
      value.messageIds.some((id) => typeof id !== "string" || !/^[a-f0-9-]{36}$/i.test(id))) return null;
    return { messageIds: [...new Set(value.messageIds)], entrySource: value.entrySource };
  } catch {
    return null;
  } finally {
    reader.releaseLock();
  }
}

export async function recordOpsEngagement(
  env: Env,
  activatorId: string,
  input: OpsEngagementInput,
  now = new Date(),
): Promise<void> {
  const occurredAt = now.toISOString();
  await env.DB.batch([
    env.DB.prepare(`INSERT INTO analytics_collection_metadata (scope, stream, started_at)
      VALUES (?, 'ops_engagement', ?) ON CONFLICT(scope, stream) DO UPDATE SET
      started_at = MIN(started_at, excluded.started_at)`).bind(env.ACTIVATE_RI_EVENT_ID, occurredAt),
    env.DB.prepare(`INSERT OR IGNORE INTO activate_ri_ops_foreground_samples
      (event_id, activator_id, utc_minute, occurred_at, entry_source)
      VALUES (?, ?, ?, ?, ?)`).bind(
      env.ACTIVATE_RI_EVENT_ID, activatorId, occurredAt.slice(0, 16), occurredAt, input.entrySource,
    ),
    ...input.messageIds.map((messageId) => env.DB.prepare(`INSERT OR IGNORE INTO activate_ri_ops_message_exposures
      (event_id, activator_id, message_id, utc_date, first_exposed_at, entry_source)
      SELECT event_id, ?, id, ?, ?, ? FROM activate_ri_ops_messages
      WHERE event_id = ? AND id = ? AND removed_at IS NULL`).bind(
      activatorId, occurredAt.slice(0, 10), occurredAt, input.entrySource, env.ACTIVATE_RI_EVENT_ID, messageId,
    )),
  ]);
}
