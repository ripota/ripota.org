import type { ActivityEventInput, EditablePlanDto } from "./db";
import type { Env } from "./env";

type SendEmailResult =
  | {
      ok: true;
      status: "sent";
      attemptId: string;
      recipientsCount: number;
      recipientHashes: string[];
    }
  | {
      ok: true;
      status: "skipped";
      attemptId: string;
      reason:
        | "email-binding-missing"
        | "email-sender-missing"
        | "no-admin-recipients"
        | "no-trigger-events";
      recipientsCount: number;
      recipientHashes: string[];
    }
  | {
      ok: false;
      status: "failed";
      attemptId: string;
      error: string;
      recipientsCount: number;
      recipientHashes: string[];
    };

export async function sendActivatorEditLinkEmail(
  env: Env,
  plan: {
    submitter_callsign: string;
    submitter_name: string;
    submitter_email: string;
  },
  editUrl: string,
  helpUrl: string,
): Promise<SendEmailResult> {
  return sendEmail(env, {
    kind: "activator-edit-link",
    to: plan.submitter_email,
    subject: "Your Activate All RI 2026 edit link",
    text: [
      `Hi ${plan.submitter_name || plan.submitter_callsign},`,
      "",
      "We received your Activate All RI 2026 activation signup.",
      "Organizers will review and approve your initial activation plan before it appears on the public schedule.",
      "After approval, changes you save with your private edit link go live immediately.",
      "",
      "Use this private link to review or update your plan:",
      editUrl,
      "",
      "Activator help:",
      helpUrl,
      "",
      "This link works before and after organizer approval. Please keep it private.",
      "",
      "73,",
      "RI POTA",
    ].join("\n"),
    html: [
      `<p>Hi ${escapeHtml(plan.submitter_name || plan.submitter_callsign)},</p>`,
      "<p>We received your Activate All RI 2026 activation signup.</p>",
      "<p>Organizers will review and approve your initial activation plan before it appears on the public schedule. After approval, changes you save with your private edit link go live immediately.</p>",
      `<p><a href="${escapeHtml(editUrl)}">Review or update your plan</a></p>`,
      `<p><a href="${escapeHtml(helpUrl)}">Read the activator help page</a></p>`,
      `<p>If the button does not work, copy this link:<br><span>${escapeHtml(editUrl)}</span></p>`,
      "<p>This link works before and after organizer approval. Please keep it private.</p>",
      "<p>73,<br>RI POTA</p>",
    ].join(""),
  });
}

export async function sendActivatorApprovalEmail(
  env: Env,
  plan: {
    submitter_callsign: string;
    submitter_name: string;
    submitter_email: string;
  },
  helpUrl: string,
  scheduleUrl: string,
): Promise<SendEmailResult> {
  return sendEmail(env, {
    kind: "activator-approval",
    to: plan.submitter_email,
    subject: "Your Activate All RI 2026 plan is live",
    text: [
      `Hi ${plan.submitter_name || plan.submitter_callsign},`,
      "",
      "Your Activate All RI 2026 activation plan is approved and live on the public schedule.",
      "Changes you save later with your private edit link go live immediately.",
      "",
      "Public schedule:",
      scheduleUrl,
      "",
      "Activator help:",
      helpUrl,
      "",
      "73,",
      "RI POTA",
    ].join("\n"),
    html: [
      `<p>Hi ${escapeHtml(plan.submitter_name || plan.submitter_callsign)},</p>`,
      "<p>Your Activate All RI 2026 activation plan is approved and live on the public schedule.</p>",
      "<p>Changes you save later with your private edit link go live immediately.</p>",
      `<p><a href="${escapeHtml(scheduleUrl)}">View the public schedule</a></p>`,
      `<p><a href="${escapeHtml(helpUrl)}">Read the activator help page</a></p>`,
      "<p>73,<br>RI POTA</p>",
    ].join(""),
  });
}

export async function sendAdminActivityEmail(
  env: Env,
  plan: EditablePlanDto,
  events: ActivityEventInput[],
): Promise<SendEmailResult> {
  const recipients = adminEmails(env);
  if (recipients.length === 0) {
    return skippedEmail("admin-activity", "no-admin-recipients", recipients);
  }

  if (events.length === 0) {
    return skippedEmail("admin-activity", "no-trigger-events", recipients);
  }

  const subject = `Activate RI update: ${plan.submitter_callsign}`;
  const text = [
    `${plan.submitter_callsign} made a high-impact update to an approved Activate All RI 2026 plan.`,
    "",
    ...events.flatMap((event) => [`- ${event.summary}`, ""]),
    `Admin plan: https://ripota.org/activate-ri-2026/admin/`,
  ].join("\n");
  const html = [
    `<p><strong>${escapeHtml(plan.submitter_callsign)}</strong> made a high-impact update to an approved Activate All RI 2026 plan.</p>`,
    "<ul>",
    ...events.map((event) => `<li>${escapeHtml(event.summary)}</li>`),
    "</ul>",
    '<p><a href="https://ripota.org/activate-ri-2026/admin/">Open the admin dashboard</a></p>',
  ].join("");

  return sendEmail(env, {
    kind: "admin-activity",
    to: recipients,
    subject,
    text,
    html,
  });
}

export async function sendAdminPendingPlanEmail(
  env: Env,
  plan: {
    submitter_callsign: string;
    submitter_name: string;
    submitter_email: string;
  },
): Promise<SendEmailResult> {
  const recipients = adminEmails(env);
  if (recipients.length === 0) {
    return skippedEmail("admin-pending-plan", "no-admin-recipients", recipients);
  }

  const subject = `Activate RI approval needed: ${plan.submitter_callsign}`;
  const text = [
    `${plan.submitter_callsign} submitted a new Activate All RI 2026 activation plan for organizer review.`,
    "",
    `Submitter: ${plan.submitter_name} <${plan.submitter_email}>`,
    "",
    "Admin dashboard:",
    "https://ripota.org/activate-ri-2026/admin/",
  ].join("\n");
  const html = [
    `<p><strong>${escapeHtml(plan.submitter_callsign)}</strong> submitted a new Activate All RI 2026 activation plan for organizer review.</p>`,
    `<p>Submitter: ${escapeHtml(plan.submitter_name)} &lt;${escapeHtml(plan.submitter_email)}&gt;</p>`,
    '<p><a href="https://ripota.org/activate-ri-2026/admin/">Open the admin dashboard</a></p>',
  ].join("");

  return sendEmail(env, {
    kind: "admin-pending-plan",
    to: recipients,
    subject,
    text,
    html,
  });
}

type EmailKind =
  | "activator-edit-link"
  | "activator-approval"
  | "admin-activity"
  | "admin-pending-plan";

async function sendEmail(
  env: Env,
  message: {
    kind: EmailKind;
    to: string | string[];
    subject: string;
    text: string;
    html: string;
  },
): Promise<SendEmailResult> {
  const attemptId = crypto.randomUUID();
  const recipients = Array.isArray(message.to) ? message.to : [message.to];
  const recipientHashes = await emailHashes(recipients);
  if (!env.EMAIL) {
    return logEmailOutcome({
      ok: true,
      status: "skipped",
      attemptId,
      kind: message.kind,
      reason: "email-binding-missing",
      recipientsCount: recipients.length,
      recipientHashes,
      subject: message.subject,
    });
  }

  const from = env.ACTIVATE_RI_EMAIL_FROM;
  if (!from) {
    return logEmailOutcome({
      ok: true,
      status: "skipped",
      attemptId,
      kind: message.kind,
      reason: "email-sender-missing",
      recipientsCount: recipients.length,
      recipientHashes,
      subject: message.subject,
    });
  }

  try {
    await env.EMAIL.send({
      to: message.to,
      from: {
        email: from,
        name: env.ACTIVATE_RI_EMAIL_FROM_NAME ?? "RI POTA",
      },
      subject: message.subject,
      text: message.text,
      html: message.html,
    });
    return logEmailOutcome({
      ok: true,
      status: "sent",
      attemptId,
      kind: message.kind,
      recipientsCount: recipients.length,
      recipientHashes,
      subject: message.subject,
    });
  } catch (error) {
    return logEmailOutcome({
      ok: false,
      status: "failed",
      attemptId,
      kind: message.kind,
      error: error instanceof Error ? error.message : "Email send failed.",
      recipientsCount: recipients.length,
      recipientHashes,
      subject: message.subject,
    });
  }
}

async function skippedEmail(
  kind: "admin-activity" | "admin-pending-plan",
  reason: "no-admin-recipients" | "no-trigger-events",
  recipients: string[],
): Promise<SendEmailResult> {
  return logEmailOutcome({
    ok: true,
    status: "skipped",
    attemptId: crypto.randomUUID(),
    kind,
    reason,
    recipientsCount: recipients.length,
    recipientHashes: await emailHashes(recipients),
  });
}

function logEmailOutcome(
  result: SendEmailResult & {
    kind: EmailKind;
    subject?: string;
  },
): SendEmailResult {
  console.log({
    event: "email_send_attempt",
    emailAttemptId: result.attemptId,
    kind: result.kind,
    status: result.status,
    reason: result.status === "skipped" ? result.reason : undefined,
    error: result.status === "failed" ? result.error : undefined,
    recipientsCount: result.recipientsCount,
    recipientHashes: result.recipientHashes,
    subject: result.subject,
  });

  const { kind: _kind, subject: _subject, ...sendResult } = result;
  return sendResult;
}

async function emailHashes(emails: string[]): Promise<string[]> {
  return Promise.all(
    emails.map(async (email) => {
      const bytes = new TextEncoder().encode(email.trim().toLowerCase());
      const digest = await crypto.subtle.digest("SHA-256", bytes);
      return [...new Uint8Array(digest)]
        .map((byte) => byte.toString(16).padStart(2, "0"))
        .join("");
    }),
  );
}

function adminEmails(env: Env): string[] {
  return (env.ACTIVATE_RI_ADMIN_EMAILS ?? "")
    .split(",")
    .map((email) => email.trim())
    .filter(Boolean);
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
