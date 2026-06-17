import type { ActivityEventInput, EditableRouteDto } from "./db";
import type { Env } from "./env";

type SendEmailResult =
  | { ok: true }
  | { ok: false; error: string };

export async function sendActivatorEditLinkEmail(
  env: Env,
  route: {
    submitter_callsign: string;
    submitter_name: string;
    submitter_email: string;
  },
  editUrl: string,
): Promise<SendEmailResult> {
  return sendEmail(env, {
    to: route.submitter_email,
    subject: "Your Activate All RI 2026 edit link",
    text: [
      `Hi ${route.submitter_name || route.submitter_callsign},`,
      "",
      "We received your Activate All RI 2026 activation signup.",
      "Use this private link to review or update your route:",
      editUrl,
      "",
      "This link works before and after organizer approval. Please keep it private.",
      "",
      "73,",
      "RI POTA",
    ].join("\n"),
    html: [
      `<p>Hi ${escapeHtml(route.submitter_name || route.submitter_callsign)},</p>`,
      "<p>We received your Activate All RI 2026 activation signup.</p>",
      `<p><a href="${escapeHtml(editUrl)}">Review or update your route</a></p>`,
      `<p>If the button does not work, copy this link:<br><span>${escapeHtml(editUrl)}</span></p>`,
      "<p>This link works before and after organizer approval. Please keep it private.</p>",
      "<p>73,<br>RI POTA</p>",
    ].join(""),
  });
}

export async function sendAdminActivityEmail(
  env: Env,
  route: EditableRouteDto,
  events: ActivityEventInput[],
): Promise<SendEmailResult> {
  const recipients = adminEmails(env);
  if (recipients.length === 0 || events.length === 0) {
    return { ok: true };
  }

  const subject = `Activate RI update: ${route.submitter_callsign}`;
  const text = [
    `${route.submitter_callsign} made a high-impact update to an approved Activate All RI 2026 route.`,
    "",
    ...events.flatMap((event) => [`- ${event.summary}`, ""]),
    `Admin route: https://ripota.org/activate-ri-2026/admin/`,
  ].join("\n");
  const html = [
    `<p><strong>${escapeHtml(route.submitter_callsign)}</strong> made a high-impact update to an approved Activate All RI 2026 route.</p>`,
    "<ul>",
    ...events.map((event) => `<li>${escapeHtml(event.summary)}</li>`),
    "</ul>",
    '<p><a href="https://ripota.org/activate-ri-2026/admin/">Open the admin dashboard</a></p>',
  ].join("");

  return sendEmail(env, {
    to: recipients,
    subject,
    text,
    html,
  });
}

async function sendEmail(
  env: Env,
  message: {
    to: string | string[];
    subject: string;
    text: string;
    html: string;
  },
): Promise<SendEmailResult> {
  if (!env.EMAIL) {
    return { ok: false, error: "Email binding is not configured." };
  }

  const from = env.ACTIVATE_RI_EMAIL_FROM;
  if (!from) {
    return { ok: false, error: "Email sender is not configured." };
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
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Email send failed.",
    };
  }
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
