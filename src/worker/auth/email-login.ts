import { generateEditToken, tokenHash } from "../edit-token";
import { sendAuthAccessEmail } from "../email";
import type { SendEmailResult } from "../email";
import type { Env } from "../env";
import { trustedSiteUrl } from "../origin";
import { verifyTurnstile } from "../turnstile";
import { authAuditStatement } from "./audit";
import { getAuthConfig } from "./config";
import {
  ActivatorMembershipConflictError,
  findUserByVerifiedEmail,
  getUserById,
  isActivatorMembershipConflict,
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
  activator_name: string | null;
  expires_at: string;
};

type ActivatorEmailRow = {
  id: string;
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
  await issueActivatorEmailLogin(request, env, {
    email,
    purpose: "login",
    rateLimit: true,
  });
  return genericResponse();
}

export async function issueActivatorEmailLogin(
  request: Request,
  env: Env,
  input: {
    email: string;
    activatorId?: string;
    purpose?: "login" | "activator-submission";
    rateLimit?: boolean;
  },
): Promise<SendEmailResult | null> {
  const config = getAuthConfig(env, request);
  const email = normalizeEmail(input.email);
  if (!config.emailLoginEnabled || !validEmail(email)) return null;
  if (input.rateLimit && !await emailLoginRateAllowed(request, env, email)) return null;

  const [user, activator] = await Promise.all([
    findUserByVerifiedEmail(env, email),
    input.activatorId
      ? env.DB.prepare(
          `SELECT id, email_normalized
           FROM activate_ri_activators
           WHERE id = ? AND event_id = ? AND email_normalized = ?
           LIMIT 1`,
        ).bind(input.activatorId, env.ACTIVATE_RI_EVENT_ID, email).first<ActivatorEmailRow>()
      : env.DB.prepare(
          `SELECT id, email_normalized
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
    return null;
  }

  const rawToken = generateEditToken();
  const hash = await tokenHash(rawToken);
  const now = new Date();
  const expiresAt = new Date(now.getTime() + 15 * 60 * 1000).toISOString();
  await env.DB.prepare(
    `INSERT INTO auth_email_tokens (
       token_hash, purpose, email_normalized, user_id, activator_id, created_at, expires_at
     ) VALUES (?, 'login', ?, ?, ?, ?, ?)`,
  ).bind(hash, email, user?.id ?? null, activator.id, now.toISOString(), expiresAt).run();

  const accessUrl = trustedSiteUrl(request, env, "/account/access/");
  accessUrl.hash = rawToken;
  const delivery = await sendAuthAccessEmail(env, {
    to: email,
    accessUrl: accessUrl.href,
    purpose: input.purpose ?? "login",
  });
  if (delivery.status !== "sent") {
    await env.DB.prepare(
      `UPDATE auth_email_tokens SET used_at = ? WHERE token_hash = ? AND used_at IS NULL`,
    ).bind(new Date().toISOString(), hash).run();
  }
  await authAuditStatement(env, {
    action: "email-login-requested",
    summary: delivery.status === "sent" ? "Sent an email login link." : "Email login delivery did not complete.",
    subjectUserId: user?.id,
    details: { deliveryStatus: delivery.status, purpose: input.purpose ?? "login" },
  }).run();
  return delivery;
}

export async function consumeEmailLogin(
  env: Env,
  rawToken: string,
  now = new Date(),
): Promise<{ cookie: string; expiresAt: string; nextPath: string } | null> {
  if (!/^[a-f0-9]{64}$/i.test(rawToken)) {
    return null;
  }
  const hash = await tokenHash(rawToken);
  const row = await env.DB.prepare(
    `SELECT
       t.token_hash,
       t.email_normalized,
       t.user_id,
       t.activator_id,
       a.name AS activator_name,
       t.expires_at
     FROM auth_email_tokens t
     LEFT JOIN activate_ri_activators a ON a.id = t.activator_id
     WHERE t.token_hash = ? AND t.purpose = 'login' AND t.used_at IS NULL AND t.expires_at > ?
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
    : prepareUserWithVerifiedEmail(
        env,
        row.email_normalized,
        row.activator_name ?? "",
        now.toISOString(),
      );
  const user = existingUser ?? preparedUser!.user;
  if (!user || user.disabledAt) {
    return null;
  }
  let preparedMembership: Awaited<ReturnType<typeof prepareActivatorMembershipLink>> | null = null;
  if (row.activator_id) {
    try {
      preparedMembership = await prepareActivatorMembershipLink(
        env,
        user.id,
        row.activator_id,
        now.toISOString(),
        {
          userWillBeInserted: preparedUser !== null,
          userPrimaryEmail: row.email_normalized,
        },
      );
    } catch (error) {
      if (error instanceof ActivatorMembershipConflictError) {
        console.error(JSON.stringify({ event: "email-login-membership-conflict" }));
        return null;
      }
      throw error;
    }
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
    ...(preparedMembership?.statements ?? []),
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
  } catch (error) {
    console.error(JSON.stringify({
      event: preparedMembership?.status === "pending" && isActivatorMembershipConflict(error)
        ? "email-login-membership-conflict"
        : "email-login-consume-transaction-failed",
    }));
    return null;
  }
  return {
    cookie: authSessionCookie(session.token),
    expiresAt: session.expiresAt,
    nextPath: row.activator_id
      ? "/activate-ri-2026/activator/plan/"
      : "/account/security/",
  };
}

async function emailLoginRateAllowed(
  request: Request,
  env: Env,
  email: string,
): Promise<boolean> {
  const network = request.headers.get("CF-Connecting-IP") ?? "unknown";
  const [emailRateKey, networkRateKey] = await Promise.all([
    tokenHash(`email:${email}`),
    tokenHash(`network:${network}`),
  ]);
  if (!env.AUTH_EMAIL_RATE_LIMIT) return false;
  const [emailLimit, networkLimit] = await Promise.all([
    env.AUTH_EMAIL_RATE_LIMIT.limit({ key: emailRateKey }),
    env.AUTH_EMAIL_RATE_LIMIT.limit({ key: networkRateKey }),
  ]);
  return emailLimit.success && networkLimit.success;
}

function genericResponse(): { ok: true; message: string } {
  return { ok: true, message: genericEmailLoginMessage };
}

function validEmail(value: string): boolean {
  return value.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}
