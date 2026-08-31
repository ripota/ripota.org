import type { Env } from "./env";
import { logActivityEvent } from "./db";
import { logWorkerError } from "./logging";

type RecipientRow = {
  activator_id: string;
  email_normalized: string;
};

export async function createOpsEmailBroadcast(
  env: Env,
  messageId: string,
  requestedBy: string,
  now = new Date().toISOString(),
): Promise<{ id: string; recipientCount: number }> {
  const existing = await env.DB.prepare(
    `SELECT id, recipient_count FROM activate_ri_ops_email_broadcasts
     WHERE event_id = ? AND message_id = ?`,
  ).bind(env.ACTIVATE_RI_EVENT_ID, messageId)
    .first<{ id: string; recipient_count: number }>();
  if (existing) return { id: existing.id, recipientCount: existing.recipient_count };

  const recipients = await env.DB.prepare(
    `SELECT m.activator_id, a.email_normalized
     FROM activate_ri_ops_memberships m
     INNER JOIN activate_ri_activators a ON a.id = m.activator_id
     WHERE m.event_id = ? AND m.status IN ('active', 'muted')
     ORDER BY m.activator_id`,
  ).bind(env.ACTIVATE_RI_EVENT_ID).all<RecipientRow>();
  const broadcastId = crypto.randomUUID();
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO activate_ri_ops_email_broadcasts (
         id, event_id, message_id, status, requested_by, recipient_count, created_at
       ) VALUES (?, ?, ?, 'pending', ?, ?, ?)`,
    ).bind(
      broadcastId,
      env.ACTIVATE_RI_EVENT_ID,
      messageId,
      requestedBy,
      recipients.results.length,
      now,
    ),
    ...recipients.results.map((recipient, index) =>
      env.DB.prepare(
        `INSERT INTO activate_ri_ops_email_recipients (
           broadcast_id, activator_id, batch_number, status
         ) VALUES (?, ?, ?, 'pending')`,
      ).bind(broadcastId, recipient.activator_id, Math.floor(index / 49) + 1)
    ),
    env.DB.prepare(
      `INSERT INTO activate_ri_activity_events (
         id, event_id, actor_type, actor_email, action, summary, details_json, created_at
       ) VALUES (?, ?, 'admin', ?, 'ops-announcement-email-requested', ?, ?, ?)`,
    ).bind(
      crypto.randomUUID(),
      env.ACTIVATE_RI_EVENT_ID,
      requestedBy,
      `Announcement email requested for ${recipients.results.length} eligible activators.`,
      JSON.stringify({ messageId, broadcastId, recipientCount: recipients.results.length }),
      now,
    ),
  ]);
  return { id: broadcastId, recipientCount: recipients.results.length };
}

export async function sendOpsEmailBroadcast(
  env: Env,
  broadcastId: string,
  retryFailedOnly = false,
): Promise<void> {
  const broadcast = await env.DB.prepare(
    `SELECT b.message_id, b.requested_by, m.body, m.created_at
     FROM activate_ri_ops_email_broadcasts b
     INNER JOIN activate_ri_ops_messages m ON m.id = b.message_id
     WHERE b.event_id = ? AND b.id = ?`,
  ).bind(env.ACTIVATE_RI_EVENT_ID, broadcastId).first<{
    message_id: string;
    requested_by: string;
    body: string;
    created_at: string;
  }>();
  if (!broadcast) return;

  await env.DB.prepare(
    `UPDATE activate_ri_ops_email_broadcasts
     SET status = 'sending', completed_at = NULL, last_error = '' WHERE id = ?`,
  ).bind(broadcastId).run();
  const recipients = await env.DB.prepare(
    `SELECT r.activator_id, r.batch_number, a.email_normalized
     FROM activate_ri_ops_email_recipients r
     INNER JOIN activate_ri_activators a ON a.id = r.activator_id
     WHERE r.broadcast_id = ? AND r.status ${retryFailedOnly ? "= 'failed'" : "= 'pending'"}
     ORDER BY r.batch_number, r.activator_id`,
  ).bind(broadcastId).all<RecipientRow & { batch_number: number }>();
  const batches = Map.groupBy(recipients.results, (recipient) => recipient.batch_number);
  let lastError = "";
  for (const batch of batches.values()) {
    const emails = batch.map((recipient) => recipient.email_normalized);
    const result = await sendAnnouncementBatch(env, emails, broadcast.body, broadcast.created_at);
    if (!result.ok) lastError = result.error;
    await env.DB.batch(batch.map((recipient) =>
      env.DB.prepare(
        `UPDATE activate_ri_ops_email_recipients
         SET status = ?, attempt_count = attempt_count + 1,
             sent_at = CASE WHEN ? = 'sent' THEN ? ELSE sent_at END,
             last_error = ?
         WHERE broadcast_id = ? AND activator_id = ?`,
      ).bind(
        result.ok ? "sent" : "failed",
        result.ok ? "sent" : "failed",
        new Date().toISOString(),
        result.ok ? "" : result.error,
        broadcastId,
        recipient.activator_id,
      )
    ));
  }

  const counts = await env.DB.prepare(
    `SELECT
       SUM(CASE WHEN status = 'sent' THEN 1 ELSE 0 END) AS sent_count,
       SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS failed_count,
       SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) AS pending_count
     FROM activate_ri_ops_email_recipients WHERE broadcast_id = ?`,
  ).bind(broadcastId).first<{ sent_count: number; failed_count: number; pending_count: number }>();
  const status = (counts?.failed_count ?? 0) > 0
    ? (counts?.sent_count ?? 0) > 0 ? "partial" : "failed"
    : "sent";
  const completedAt = new Date().toISOString();
  await env.DB.prepare(
    `UPDATE activate_ri_ops_email_broadcasts
     SET status = ?, sent_count = ?, failed_count = ?, completed_at = ?, last_error = ?
     WHERE id = ?`,
  ).bind(
    status,
    counts?.sent_count ?? 0,
    counts?.failed_count ?? 0,
    completedAt,
    lastError,
    broadcastId,
  ).run();
  await logActivityEvent(env, {
    actorType: "system",
    action: `ops-announcement-email-${status}`,
    summary: `Announcement email broadcast ${status}.`,
    details: {
      broadcastId,
      messageId: broadcast.message_id,
      sentCount: counts?.sent_count ?? 0,
      failedCount: counts?.failed_count ?? 0,
    },
  }, completedAt);
}

async function sendAnnouncementBatch(
  env: Env,
  recipients: string[],
  announcement: string,
  createdAt: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (recipients.length === 0) return { ok: true };
  if (!env.EMAIL || !env.ACTIVATE_RI_EMAIL_FROM) {
    return { ok: false, error: "Email service is not configured." };
  }
  const portalUrl = new URL(
    "/activate-ri-2026/activator/",
    env.SITE_ORIGIN ?? "https://ripota.org",
  ).href;
  const text = [
    "Activate All RI 2026 organizer announcement",
    "",
    announcement,
    "",
    `Posted: ${createdAt}`,
    `Activator portal: ${portalUrl}`,
    "",
    "If your session expired, reopen your private signup email link or use the recovery form on the volunteer page.",
    "This room and email are not monitored emergency services.",
    "RI POTA is an unofficial community site; official POTA resources remain authoritative.",
  ].join("\n");
  try {
    await env.EMAIL.send({
      from: {
        email: env.ACTIVATE_RI_EMAIL_FROM,
        name: env.ACTIVATE_RI_EMAIL_FROM_NAME ?? "RI POTA",
      },
      to: env.ACTIVATE_RI_EMAIL_FROM,
      bcc: recipients,
      subject: "Activate All RI 2026 organizer announcement",
      text,
      html: `<p><strong>Activate All RI 2026 organizer announcement</strong></p><p>${escapeHtml(announcement).replaceAll("\n", "<br>")}</p><p><a href="${portalUrl}">Open the activator portal</a></p><p>If your session expired, reopen your private signup email link or use the recovery form on the volunteer page.</p><p>This room and email are not monitored emergency services.</p><p>RI POTA is an unofficial community site; official POTA resources remain authoritative.</p>`,
    });
    console.log(JSON.stringify({
      event: "ops_announcement_email_batch",
      recipientsCount: recipients.length,
      status: "sent",
    }));
    return { ok: true };
  } catch (error) {
    logWorkerError("ops-announcement-email-batch-failed", error, {
      recipientsCount: recipients.length,
    });
    return { ok: false, error: error instanceof Error ? error.message : "Email send failed." };
  }
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
