import { generateEditToken, tokenHash } from "../edit-token";
import { sendAuthAccessEmail } from "../email";
import type { Env } from "../env";
import { trustedSiteUrl } from "../origin";
import { verifyTurnstile } from "../turnstile";
import { authAuditStatement } from "./audit";
import { getAuthConfig } from "./config";
import {
  findUserByVerifiedEmail,
  getUserById,
  normalizeEmail,
  prepareActivatorMembershipLink,
  prepareUserWithVerifiedEmail,
} from "./db";
import { authSessionCookie, prepareAuthSession } from "./session";

export const genericEmailLoginMessage = "If we found an account that can use email sign-in, we sent a link.";

type EmailTokenRow = {
  token_hash: string;
  email_normalized: string;
  user_id: string | null;
  activator_id: string | null;
  expires_at: string;
};

type ActivatorEmailRow = {
  id: string;
  name: string;
  email_normalized: string;
};

export async function requestEmailLogin(
  request: Request,
  env: Env,
  input: { email: unknown; turnstileToken: unknown },
): Promise<{ ok: true; message: string }> {
  const config = getAuthConfig(env, request);
  if (!config.emailLoginEnabled || typeof input.email !== "string") {
    return genericResponse();
  }
  const email = normalizeEmail(input.email);
  if (!validEmail(email) || !await verifyTurnstile(request, env, input.turnstileToken)) {
    return genericResponse();
  }
  const network = request.headers.get("CF-Connecting-IP") ?? "unknown";
  const [emailRateKey, networkRateKey] = await Promise.all([
    tokenHash(`email:${email}`),
    tokenHash(`network:${network}`),
  ]);
  if (!env.AUTH_EMAIL_RATE_LIMIT) {
    return genericResponse();
  }
  const [emailLimit, networkLimit] = await Promise.all([
    env.AUTH_EMAIL_RATE_LIMIT.limit({ key: emailRateKey }),
    env.AUTH_EMAIL_RATE_LIMIT.limit({ key: networkRateKey }),
  ]);
  if (!emailLimit.success || !networkLimit.success) return genericResponse();

  const [user, activator] = await Promise.all([
    findUserByVerifiedEmail(env, email),
    env.DB.prepare(
      `SELECT id, name, email_normalized
       FROM activate_ri_activators
       WHERE event_id = ? AND email_normalized = ?
       LIMIT 1`,
    ).bind(env.ACTIVATE_RI_EVENT_ID, email).first<ActivatorEmailRow>(),
  ]);
  if (user?.disabledAt || !activator) {
    await authAuditStatement(env, {
      action: "email-login-requested",
      summary: "Processed an email login request without an eligible account.",
      eventId: null,
    }).run();
    return genericResponse();
  }

  const rawToken = generateEditToken();
  const hash = await tokenHash(rawToken);
  const now = new Date();
  const expiresAt = new Date(now.getTime() + 15 * 60 * 1000).toISOString();
  await env.DB.prepare(
    `INSERT INTO auth_email_tokens (
       token_hash, purpose, email_normalized, user_id, activator_id, created_at, expires_at
     ) VALUES (?, 'login', ?, ?, ?, ?, ?)`,
  ).bind(hash, email, user?.id ?? null, activator?.id ?? null, now.toISOString(), expiresAt).run();

  const accessUrl = trustedSiteUrl(request, env, "/account/access/");
  accessUrl.hash = rawToken;
  const delivery = await sendAuthAccessEmail(env, { to: email, accessUrl: accessUrl.href, purpose: "login" });
  if (delivery.status !== "sent") {
    await env.DB.prepare(
      `UPDATE auth_email_tokens SET used_at = ? WHERE token_hash = ? AND used_at IS NULL`,
    ).bind(new Date().toISOString(), hash).run();
  }
  await authAuditStatement(env, {
    action: "email-login-requested",
    summary: delivery.status === "sent" ? "Sent an email login link." : "Email login delivery did not complete.",
    subjectUserId: user?.id,
    details: { deliveryStatus: delivery.status },
  }).run();
  return genericResponse();
}

export async function consumeEmailLogin(
  env: Env,
  rawToken: string,
  now = new Date(),
): Promise<{ cookie: string; expiresAt: string } | null> {
  if (!/^[a-f0-9]{64}$/i.test(rawToken)) {
    return null;
  }
  const hash = await tokenHash(rawToken);
  const row = await env.DB.prepare(
    `SELECT token_hash, email_normalized, user_id, activator_id, expires_at
     FROM auth_email_tokens
     WHERE token_hash = ? AND purpose = 'login' AND used_at IS NULL AND expires_at > ?
     LIMIT 1`,
  ).bind(hash, now.toISOString()).first<EmailTokenRow>();
  if (!row) {
    return null;
  }
  const existingUser = row.user_id
    ? await getUserById(env, row.user_id)
    : await findUserByVerifiedEmail(env, row.email_normalized);
  const preparedUser = existingUser
    ? null
    : prepareUserWithVerifiedEmail(env, row.email_normalized, "", now.toISOString());
  const user = existingUser ?? preparedUser!.user;
  if (!user || user.disabledAt) {
    return null;
  }
  const session = await prepareAuthSession(env, {
    userId: user.id,
    authenticationMethod: "email",
    sourceEmailTokenHash: hash,
  }, now);
  const statements = [
    env.DB.prepare(
      `UPDATE auth_email_tokens SET used_at = ?
       WHERE token_hash = ? AND used_at IS NULL AND expires_at > ?`,
    ).bind(now.toISOString(), hash, now.toISOString()),
    ...(preparedUser?.statements ?? []),
    ...(row.activator_id
      ? prepareActivatorMembershipLink(env, user.id, row.activator_id, now.toISOString())
      : []),
    session.statement,
    authAuditStatement(env, {
      action: "email-login-consumed",
      summary: "Consumed a single-use email login link.",
      actorUserId: user.id,
      subjectUserId: user.id,
      createdAt: now.toISOString(),
    }),
  ];
  try {
    await env.DB.batch(statements);
  } catch {
    return null;
  }
  return { cookie: authSessionCookie(session.token), expiresAt: session.expiresAt };
}

function genericResponse(): { ok: true; message: string } {
  return { ok: true, message: genericEmailLoginMessage };
}

function validEmail(value: string): boolean {
  return value.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}
