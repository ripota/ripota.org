import type { ActivityEventInput, EditablePlanDto } from "./db";
import type { Env } from "./env";
import references from "../data/ri-references.json";
import { formatActivationDateTimeRange } from "../lib/activate-ri/time";

export type SendEmailResult =
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
  planUrl: string,
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
      "Changes you save later in My Plan go live immediately.",
    ],
    statusLabel: "Live on the public schedule",
    stopLines,
    stopsHeading: "Current stops",
    planUrl,
    scheduleUrl,
    helpUrl,
  });
}

export async function sendActivatorPlanUpdatedEmail(
  env: Env,
  plan: EditablePlanDto,
  planUrl: string,
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
    planUrl,
  });
}

export async function sendActivatorPlanCancelledEmail(
  env: Env,
  plan: EditablePlanDto,
  planUrl: string,
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
    planUrl,
  });
}

export async function sendActivatorSecureAccessRevokedEmail(
  env: Env,
  plan: EditablePlanDto,
  planUrl: string,
  helpUrl: string,
): Promise<SendEmailResult> {
  return sendActivatorReceiptEmail(env, {
    kind: "activator-secure-access-revoked",
    plan,
    subject: "Your Activate All RI 2026 access was reset",
    introLines: [
      "An organizer revoked the private links and browser sessions for your activation signup.",
      "Sign in with a passkey or request a short-lived email link to return.",
    ],
    statusLabel: planStatusLabel(plan.status),
    stopLines: planStopSummaryLines(plan, { includeCancelled: true }),
    stopsHeading: "Current stops",
    planUrl,
    helpUrl,
  });
}

export async function sendAuthAccessEmail(
  env: Env,
  input: {
    to: string;
    accessUrl: string;
    purpose: "login" | "passkey-reset" | "activator-submission";
  },
): Promise<SendEmailResult> {
  const reset = input.purpose === "passkey-reset";
  const submission = input.purpose === "activator-submission";
  const subject = reset
    ? "Reset your RI POTA passkey"
    : submission
      ? "Open your Activate All RI 2026 plan"
      : "Your RI POTA sign-in link";
  const intro = reset
    ? "An Activate All RI organizer sent you a passkey recovery link. Your existing passkeys remain active until you finish recovery."
    : submission
      ? "Your Activate All RI 2026 activation signup was saved. Use this short-lived, single-use link to open My Plan."
      : "Use this short-lived, single-use link to sign in to your RI POTA account.";
  const expiration = reset ? "30 minutes" : "15 minutes";
  const text = [
    intro,
    "",
    input.accessUrl,
    "",
    `This link expires in ${expiration}. If you did not request it, you can ignore this email.`,
    "Any Activate All RI private links issued previously continue to work.",
    "",
    "RI POTA is an unofficial community site. Parks on the Air is the source of truth for official accounts, rules, spots, and logs.",
    "Official POTA resources: https://docs.pota.app/",
    "",
    "73,",
    "RI POTA",
  ].join("\n");
  const html = [
    `<p>${escapeHtml(intro)}</p>`,
    `<p><a href="${escapeHtml(input.accessUrl)}">${reset ? "Recover your passkey" : submission ? "Open My Plan" : "Sign in to RI POTA"}</a></p>`,
    `<p>This link expires in ${expiration}. If you did not request it, you can ignore this email.</p>`,
    "<p>Any Activate All RI private links issued previously continue to work.</p>",
    "<p>RI POTA is an unofficial community site. Parks on the Air is the source of truth for official accounts, rules, spots, and logs.</p>",
    '<p><a href="https://docs.pota.app/">Official Parks on the Air resources</a></p>',
    "<p>73,<br>RI POTA</p>",
  ].join("");
  return sendEmail(env, {
    kind: reset ? "auth-passkey-reset" : submission ? "auth-activator-submission" : "auth-email-login",
    to: input.to,
    subject,
    text,
    html,
  });
}

function sendActivatorReceiptEmail(
  env: Env,
  receipt: {
    kind:
      | "activator-edit-link"
      | "activator-approval"
      | "activator-plan-updated"
      | "activator-plan-cancelled"
      | "activator-secure-access-revoked";
    plan: ActivatorEmailPlan;
    subject: string;
    introLines: string[];
    statusLabel: string;
    stopLines: string[];
    stopsHeading: string;
    editUrl?: string;
    planUrl?: string;
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
    ...textUrlBlock("My Plan", receipt.planUrl),
    "Any private links already issued continue to work unless an organizer revokes them. Use a passkey or an email sign-in link for future access.",
    "",
    "Already added a passkey? Sign in at https://ripota.org/account/sign-in/",
    "",
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
    ...htmlUrlBlock("Open My Plan", receipt.planUrl),
    "<p>Any private links already issued continue to work unless an organizer revokes them. Use a passkey or an email sign-in link for future access.</p>",
    '<p><a href="https://ripota.org/account/sign-in/">Sign in with an existing passkey</a></p>',
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
  | "activator-secure-access-revoked"
  | "admin-activity"
  | "admin-pending-plan"
  | "auth-email-login"
  | "auth-activator-submission"
  | "auth-passkey-reset";

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
        `- ${formatActivationDateTimeRange({
          plannedDate: stop.planned_date,
          startTime: stop.start_time,
          endTime: stop.end_time,
        })}: ${parkLabel(stop.park_reference)}`,
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
