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

type ActivatorEmailPlan = {
  submitter_callsign: string;
  submitter_name: string;
  submitter_email: string;
  status?: string;
  stops?: EditablePlanDto["stops"];
};

export async function sendActivatorEditLinkEmail(
  env: Env,
  plan: ActivatorEmailPlan,
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

  return sendActivatorReceiptEmail(env, {
    kind: "activator-edit-link",
    plan,
    subject: "Your Activate All RI 2026 edit link",
    introLines: ["Your Activate All RI 2026 activation signup was saved."],
    statusLabel,
    stopLines,
    stopsHeading: "Current stops",
    editUrl,
    privateLinkNote:
      "Keep this link private. You can use it to update your plan again if timing or parks change.",
    helpUrl,
  });
}

export async function sendActivatorApprovalEmail(
  env: Env,
  plan: ActivatorEmailPlan,
  helpUrl: string,
  scheduleUrl: string,
): Promise<SendEmailResult> {
  const stopLines = planStopSummaryLines(
    { stops: plan.stops ?? [] },
    { includeCancelled: false },
  );

  return sendActivatorReceiptEmail(env, {
    kind: "activator-approval",
    plan,
    subject: "Your Activate All RI 2026 plan is live",
    introLines: [
      "Your Activate All RI 2026 activation plan is approved and live on the public schedule.",
      "Changes you save later with your private edit link go live immediately.",
    ],
    statusLabel: "Live on the public schedule",
    stopLines,
    stopsHeading: "Current stops",
    scheduleUrl,
    helpUrl,
  });
}

export async function sendActivatorPlanUpdatedEmail(
  env: Env,
  plan: EditablePlanDto,
  editUrl: string,
): Promise<SendEmailResult> {
  const stopLines = planStopSummaryLines(plan, { includeCancelled: false });
  const statusLabel = planStatusLabel(plan.status);

  return sendActivatorReceiptEmail(env, {
    kind: "activator-plan-updated",
    plan,
    subject: "Your Activate All RI 2026 plan was updated",
    introLines: ["We saved your Activate All RI 2026 plan update."],
    statusLabel,
    stopLines,
    stopsHeading: "Current stops",
    editUrl,
    privateLinkNote:
      "Keep this link private. You can use it to update your plan again if timing or parks change.",
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

  return sendActivatorReceiptEmail(env, {
    kind: "activator-plan-cancelled",
    plan,
    subject: "Your Activate All RI 2026 plan was cancelled",
    introLines: ["Your Activate All RI 2026 activation plan has been cancelled."],
    statusLabel,
    stopLines,
    stopsHeading: "Cancelled stops",
    editUrl,
    privateLinkNote:
      "You can use the link if you need to review this signup or submit an updated plan later.",
  });
}

function sendActivatorReceiptEmail(
  env: Env,
  receipt: {
    kind:
      | "activator-edit-link"
      | "activator-approval"
      | "activator-plan-updated"
      | "activator-plan-cancelled";
    plan: ActivatorEmailPlan;
    subject: string;
    introLines: string[];
    statusLabel: string;
    stopLines: string[];
    stopsHeading: string;
    editUrl?: string;
    privateLinkNote?: string;
    helpUrl?: string;
    scheduleUrl?: string;
  },
): Promise<SendEmailResult> {
  const greetingName = receipt.plan.submitter_name ||
    receipt.plan.submitter_callsign;
  const text = [
    `Hi ${greetingName},`,
    "",
    ...receipt.introLines,
    "",
    `Status: ${receipt.statusLabel}`,
    "",
    `${receipt.stopsHeading}:`,
    ...receipt.stopLines,
    "",
    ...textUrlBlock("Private edit link", receipt.editUrl),
    ...textLineBlock(receipt.privateLinkNote),
    ...textUrlBlock("Public schedule", receipt.scheduleUrl),
    ...textUrlBlock("Activator help", receipt.helpUrl),
    "73,",
    "RI POTA",
  ].join("\n");

  const html = [
    `<p>Hi ${escapeHtml(greetingName)},</p>`,
    ...receipt.introLines.map((line) => `<p>${escapeHtml(line)}</p>`),
    `<p>Status: ${escapeHtml(receipt.statusLabel)}</p>`,
    `<p>${escapeHtml(receipt.stopsHeading)}:</p>`,
    stopSummaryListHtml(receipt.stopLines),
    ...htmlUrlBlock("Private edit link", receipt.editUrl),
    ...htmlLineBlock(receipt.privateLinkNote),
    ...htmlUrlBlock("View the public schedule", receipt.scheduleUrl),
    ...htmlUrlBlock("Read the activator help page", receipt.helpUrl),
    "<p>73,<br>RI POTA</p>",
  ].join("");

  return sendEmail(env, {
    kind: receipt.kind,
    to: receipt.plan.submitter_email,
    subject: receipt.subject,
    text,
    html,
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

function textLineBlock(line: string | undefined): string[] {
  return line ? [line, ""] : [];
}

function textUrlBlock(label: string, url: string | undefined): string[] {
  return url ? [`${label}:`, url, ""] : [];
}

function htmlLineBlock(line: string | undefined): string[] {
  return line ? [`<p>${escapeHtml(line)}</p>`] : [];
}

function htmlUrlBlock(label: string, url: string | undefined): string[] {
  return url
    ? [`<p><a href="${escapeHtml(url)}">${escapeHtml(label)}</a></p>`]
    : [];
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
