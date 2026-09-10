import type { Env } from "./env";
import { opsEmailAudienceSql } from "./ops-email-preferences";
import { logWorkerError } from "./logging";
import { recordOperationalFailure } from "./operational-health";

// Append to the same D1 batch as the message insert. The new UUID is absent on
// nonce replay, so a retry cannot notify new subscribers about an old message.
export function queueOpsMessageEmails(env: Env, messageId: string): D1PreparedStatement {
  return env.DB.prepare(`
    INSERT OR IGNORE INTO activate_ri_ops_email_deliveries (
      message_id, event_id, email_normalized, is_admin, category, next_attempt_at, created_at
    )
    SELECT m.id, m.event_id, a.email_normalized, MAX(a.is_admin),
      MIN(CASE WHEN m.email_broadcast_requested = 1 AND a.is_admin = 0 THEN 'announcement' ELSE 'chat' END),
      m.created_at, m.created_at
    FROM activate_ri_ops_messages m
    INNER JOIN (${opsEmailAudienceSql(env)}) a ON a.event_id = m.event_id
    LEFT JOIN activate_ri_ops_email_preferences p ON p.event_id = a.event_id AND p.email_normalized = a.email_normalized
    WHERE m.id = ? AND m.event_id = ? AND m.kind != 'system' AND (
      (m.email_broadcast_requested = 1 AND a.is_admin = 0)
      OR (a.chat_messages = 1
        AND COALESCE(p.author_key, '') != m.author_key
        AND a.email_normalized != COALESCE((SELECT email_normalized FROM activate_ri_activators WHERE id = m.author_activator_id), ''))
    )
    GROUP BY m.id, a.email_normalized
  `).bind(messageId, env.ACTIVATE_RI_EVENT_ID);
}

type Delivery = {
  message_id: string;
  email_normalized: string;
  is_admin: number;
  category: "announcement" | "chat";
  attempt_count: number;
  author_label: string;
  body: string;
  kind: string;
};

export async function deliverOpsMessageEmails(env: Env, messageId?: string): Promise<void> {
  const now = new Date().toISOString();
  const rows = await env.DB.prepare(`
    SELECT d.*, m.author_label, m.body, m.kind
    FROM activate_ri_ops_email_deliveries d
    INNER JOIN activate_ri_ops_messages m ON m.id = d.message_id
    WHERE d.event_id = ? AND d.status IN ('pending', 'failed', 'sending')
      AND d.attempt_count < 8 AND d.next_attempt_at <= ?
      ${messageId ? "AND d.message_id = ?" : ""}
    ORDER BY d.next_attempt_at, d.message_id LIMIT 20
  `).bind(env.ACTIVATE_RI_EVENT_ID, now, ...(messageId ? [messageId] : [])).all<Delivery>();
  for (let offset = 0; offset < rows.results.length; offset += 4) {
    await Promise.all(rows.results.slice(offset, offset + 4).map((row) => deliverOne(env, row)));
  }
}

async function deliverOne(env: Env, row: Delivery): Promise<void> {
  const now = new Date();
  const claim = crypto.randomUUID();
  const claimed = await env.DB.prepare(`
    UPDATE activate_ri_ops_email_deliveries
    SET status = 'sending', claim_token = ?, next_attempt_at = ?, attempt_count = attempt_count + 1
    WHERE message_id = ? AND email_normalized = ? AND event_id = ?
      AND status IN ('pending', 'failed', 'sending') AND next_attempt_at <= ? AND attempt_count < 8
  `).bind(claim, new Date(now.getTime() + 5 * 60_000).toISOString(), row.message_id,
    row.email_normalized, env.ACTIVATE_RI_EVENT_ID, now.toISOString()).run();
  if (!claimed.meta.changes) return;
  try {
    const eligible = await env.DB.prepare(`
      SELECT MAX(a.is_admin) AS is_admin FROM (${opsEmailAudienceSql(env)}) a
      WHERE a.event_id = ? AND a.email_normalized = ?
        AND ((? = 'announcement' AND a.is_admin = 0) OR a.chat_messages = 1)
        AND EXISTS (SELECT 1 FROM activate_ri_ops_messages WHERE id = ? AND removed_at IS NULL)
      HAVING COUNT(*) > 0
    `).bind(env.ACTIVATE_RI_EVENT_ID, row.email_normalized, row.category, row.message_id)
      .first<{ is_admin: number }>();
    if (!eligible) {
      await finishDelivery(env, row, claim, "skipped");
      return;
    }
    if (!env.EMAIL || !env.ACTIVATE_RI_EMAIL_FROM) throw new Error("Email service is not configured.");
    const portal = new URL(eligible.is_admin
      ? "/activate-ri-2026/admin/?view=ops"
      : "/activate-ri-2026/activator/", env.SITE_ORIGIN ?? "https://ripota.org");
    portal.hash = `ops-message-${row.message_id}`;
    const preferences = new URL(eligible.is_admin
      ? "/activate-ri-2026/admin/?view=ops#ops-email-notifications"
      : "/activate-ri-2026/activator/account/#ops-email-notifications", portal);
    const subject = row.category === "announcement"
      ? "Activate All RI 2026 organizer announcement"
      : `Ops Room: ${row.author_label} posted a new message`;
    const reason = row.category === "announcement"
      ? "The organizers selected this announcement for email delivery."
      : "You receive these emails because you enabled notifications for every new room message.";
    const reply = "Open the Ops Room to reply. Email replies are not posted to the room.";
    const disclaimer = "RI POTA is an unofficial community site; official POTA resources remain authoritative.";
    await env.EMAIL.send({
      from: { email: env.ACTIVATE_RI_EMAIL_FROM, name: env.ACTIVATE_RI_EMAIL_FROM_NAME ?? "RI POTA" },
      to: row.email_normalized,
      subject,
      text: `${row.author_label}\n\n${row.body}\n\n${reply}\n${portal.href}\n\n${reason}\nManage email notifications: ${preferences.href}\n\n${disclaimer}`,
      html: `<p><strong>${escapeHtml(row.author_label)}</strong></p><p>${escapeHtml(row.body).replaceAll("\n", "<br>")}</p><p><a href="${escapeHtml(portal.href)}">Open the Ops Room to reply</a></p><p>${reply}</p><p>${reason} <a href="${escapeHtml(preferences.href)}">Manage email notifications</a>.</p><p>${disclaimer}</p>`,
    });
    await finishDelivery(env, row, claim, "sent");
  } catch (error) {
    logWorkerError("ops-message-email-failed", error, { messageId: row.message_id });
    await recordOperationalFailure(env, "ops_email_delivery");
    await env.DB.prepare(`
      UPDATE activate_ri_ops_email_deliveries SET status = 'failed', last_error = ?, next_attempt_at = ?
      WHERE message_id = ? AND email_normalized = ? AND claim_token = ?
    `).bind(error instanceof Error ? error.message : "Email delivery failed.",
      new Date(now.getTime() + Math.min(30, 2 ** row.attempt_count) * 60_000).toISOString(),
      row.message_id, row.email_normalized, claim).run();
  }
}

async function finishDelivery(env: Env, row: Delivery, claim: string, status: "sent" | "skipped"): Promise<void> {
  await env.DB.prepare(`
    UPDATE activate_ri_ops_email_deliveries SET status = ?, last_error = '', sent_at = ?
    WHERE message_id = ? AND email_normalized = ? AND claim_token = ?
  `).bind(status, status === "sent" ? new Date().toISOString() : null, row.message_id, row.email_normalized, claim).run();
}

export async function retryOpsMessageEmails(env: Env, messageId?: string): Promise<void> {
  await env.DB.prepare(`
    UPDATE activate_ri_ops_email_deliveries SET attempt_count = 0, next_attempt_at = ?
    WHERE event_id = ? AND status = 'failed' ${messageId ? "AND message_id = ?" : ""}
  `).bind(new Date().toISOString(), env.ACTIVATE_RI_EVENT_ID, ...(messageId ? [messageId] : [])).run();
  await deliverOpsMessageEmails(env, messageId);
}

export async function scheduleOpsMessageEmails(env: Env, ctx?: ExecutionContext): Promise<void> {
  const delivery = deliverOpsMessageEmails(env).catch(async (error) => {
    logWorkerError("ops-email-drain-failed", error, {});
    await recordOperationalFailure(env, "ops_email_drain");
  });
  if (ctx) ctx.waitUntil(delivery); else await delivery;
}

function escapeHtml(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}
