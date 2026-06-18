import type { ActivityEventInput, EditablePlanDto } from "./db";
import type { Env } from "./env";
import references from "../data/ri-references.json";

type SendEmailResult =
  | {
      ok: true;
      status: "sent";
      attemptId: string;
      recipientsCount: number;
      recipients: string[];
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
      recipients: string[];
      recipientHashes: string[];
    }
  | {
      ok: false;
      status: "failed";
      attemptId: string;
      error: string;
      recipientsCount: number;
      recipients: string[];
      recipientHashes: string[];
    };

export async function sendActivatorEditLinkEmail(
  env: Env,
  plan: {
    submitter_callsign: string;
    submitter_name: string;
    submitter_email: string;
    status?: string;
    stops?: EditablePlanDto["stops"];
  },
  editUrl: string,
  helpUrl: string,
  options: { requiresAdminApproval?: boolean } = {},
): Promise<SendEmailResult> {
  const requiresAdminApproval = options.requiresAdminApproval ?? true;
  const statusLabel = requiresAdminApproval
    ? "Pending organizer approval"
    : "Live on the public schedule";
  const stopLines = planStopSummaryLines(
    { stops: plan.stops ?? [] },
    { includeCancelled: false },
  );

  return sendEmail(env, {
    kind: "activator-edit-link",
    to: plan.submitter_email,
    subject: "Your Activate All RI 2026 edit link",
    text: [
      `Hi ${plan.submitter_name || plan.submitter_callsign},`,
      "",
      "Your Activate All RI 2026 activation signup was saved.",
      "",
      `Status: ${statusLabel}`,
      "",
      "Current stops:",
      ...stopLines,
      "",
      "Private edit link:",
      editUrl,
      "",
      "Keep this link private. You can use it to update your plan again if timing or parks change.",
      "",
      "Activator help:",
      helpUrl,
      "",
      "73,",
      "RI POTA",
    ].join("\n"),
    html: [
      `<p>Hi ${escapeHtml(plan.submitter_name || plan.submitter_callsign)},</p>`,
      "<p>Your Activate All RI 2026 activation signup was saved.</p>",
      `<p>Status: ${escapeHtml(statusLabel)}</p>`,
      "<p>Current stops:</p>",
      stopSummaryListHtml(stopLines),
      `<p>Private edit link:<br><a href="${escapeHtml(editUrl)}">${escapeHtml(editUrl)}</a></p>`,
      "<p>Keep this link private. You can use it to update your plan again if timing or parks change.</p>",
      `<p><a href="${escapeHtml(helpUrl)}">Read the activator help page</a></p>`,
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

export async function sendActivatorPlanUpdatedEmail(
  env: Env,
  plan: EditablePlanDto,
  editUrl: string,
): Promise<SendEmailResult> {
  const stopLines = planStopSummaryLines(plan, { includeCancelled: false });
  const statusLabel = planStatusLabel(plan.status);

  return sendEmail(env, {
    kind: "activator-plan-updated",
    to: plan.submitter_email,
    subject: "Your Activate All RI 2026 plan was updated",
    text: [
      `Hi ${plan.submitter_name || plan.submitter_callsign},`,
      "",
      "We saved your Activate All RI 2026 plan update.",
      "",
      `Status: ${statusLabel}`,
      "",
      "Current stops:",
      ...stopLines,
      "",
      "Private edit link:",
      editUrl,
      "",
      "Keep this link private. You can use it to update your plan again if timing or parks change.",
      "",
      "73,",
      "RI POTA",
    ].join("\n"),
    html: [
      `<p>Hi ${escapeHtml(plan.submitter_name || plan.submitter_callsign)},</p>`,
      "<p>We saved your Activate All RI 2026 plan update.</p>",
      `<p>Status: ${escapeHtml(statusLabel)}</p>`,
      "<p>Current stops:</p>",
      stopSummaryListHtml(stopLines),
      `<p>Private edit link:<br><a href="${escapeHtml(editUrl)}">${escapeHtml(editUrl)}</a></p>`,
      "<p>Keep this link private. You can use it to update your plan again if timing or parks change.</p>",
      "<p>73,<br>RI POTA</p>",
    ].join(""),
  });
}

export async function sendActivatorPlanCancelledEmail(
  env: Env,
  plan: EditablePlanDto,
  editUrl: string,
): Promise<SendEmailResult> {
  const stopLines = planStopSummaryLines(plan, { includeCancelled: true });
  const statusLabel = plan.status === "approved"
    ? "Approved plan with cancelled itinerary"
    : planStatusLabel("withdrawn");

  return sendEmail(env, {
    kind: "activator-plan-cancelled",
    to: plan.submitter_email,
    subject: "Your Activate All RI 2026 plan was cancelled",
    text: [
      `Hi ${plan.submitter_name || plan.submitter_callsign},`,
      "",
      "Your Activate All RI 2026 activation plan has been cancelled.",
      "",
      `Status: ${statusLabel}`,
      "",
      "Cancelled stops:",
      ...stopLines,
      "",
      "Private edit link:",
      editUrl,
      "",
      "You can use the link if you need to review this signup or submit an updated plan later.",
      "",
      "73,",
      "RI POTA",
    ].join("\n"),
    html: [
      `<p>Hi ${escapeHtml(plan.submitter_name || plan.submitter_callsign)},</p>`,
      "<p>Your Activate All RI 2026 activation plan has been cancelled.</p>",
      `<p>Status: ${escapeHtml(statusLabel)}</p>`,
      "<p>Cancelled stops:</p>",
      stopSummaryListHtml(stopLines),
      `<p>Private edit link:<br><a href="${escapeHtml(editUrl)}">${escapeHtml(editUrl)}</a></p>`,
      "<p>You can use the link if you need to review this signup or submit an updated plan later.</p>",
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
  | "activator-plan-updated"
  | "activator-plan-cancelled"
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
      recipients,
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
      recipients,
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
      recipients,
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
      recipients,
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
    recipients,
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

function planStatusLabel(status: string): string {
  if (status === "approved") {
    return "Live on the public schedule";
  }

  if (status === "withdrawn") {
    return "Cancelled";
  }

  return "Pending organizer approval";
}

const referencesByCode = new Map(
  references.map((reference) => [reference.reference, reference.name]),
);

function planStopSummaryLines(
  plan: { stops: EditablePlanDto["stops"] },
  options: { includeCancelled: boolean },
): string[] {
  const lines = plan.stops
    .filter((stop) => options.includeCancelled || stop.status !== "cancelled")
    .sort((left, right) =>
      left.planned_date.localeCompare(right.planned_date) ||
      left.start_time.localeCompare(right.start_time) ||
      left.park_reference.localeCompare(right.park_reference) ||
      parkName(left.park_reference).localeCompare(parkName(right.park_reference)),
    )
    .map(
      (stop) =>
        `- ${stop.planned_date} ${stop.start_time}-${stop.end_time}: ${parkLabel(stop.park_reference)}`,
    );

  return lines.length > 0 ? lines : ["- No current stops."];
}

function parkLabel(reference: string): string {
  const name = parkName(reference);
  return name ? `${name} (${reference})` : reference;
}

function parkName(reference: string): string {
  return referencesByCode.get(reference) ?? "";
}

function stopSummaryListHtml(stopLines: string[]): string {
  return [
    "<ul>",
    ...stopLines.map((line) => `<li>${escapeHtml(line.replace(/^- /, ""))}</li>`),
    "</ul>",
  ].join("");
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
