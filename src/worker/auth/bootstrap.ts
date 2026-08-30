import { requireAccessIdentity } from "../access";
import type { Env } from "../env";
import { authAuditStatement } from "./audit";
import {
  createUserWithVerifiedEmail,
  findUserByVerifiedEmail,
  grantAdminRole,
  normalizeEmail,
} from "./db";
import { authSessionCookie, createAuthSession, privilegedSessionLifetimeSeconds } from "./session";

export async function accessBootstrap(request: Request, env: Env) {
  const access = await requireAccessIdentity(request, env);
  if (access instanceof Response) {
    return access;
  }
  const email = normalizeEmail(access.email);
  const existing = await findUserByVerifiedEmail(env, email);
  const existingRole = existing
    ? await env.DB.prepare(
        `SELECT 1 AS allowed FROM auth_event_roles
         WHERE user_id = ? AND event_id = ? AND role = 'admin' AND revoked_at IS NULL
         LIMIT 1`,
      ).bind(existing.id, env.ACTIVATE_RI_EVENT_ID).first<{ allowed: number }>()
    : null;
  const allowlisted = bootstrapEmails(env).includes(email);
  if (!allowlisted && !existingRole) {
    return new Response(JSON.stringify({ ok: false, error: "Forbidden" }), {
      status: 403,
      headers: { "content-type": "application/json; charset=utf-8" },
    });
  }
  if (existing?.disabledAt) {
    return new Response(JSON.stringify({ ok: false, error: "Forbidden" }), { status: 403 });
  }
  const user = existing ?? await createUserWithVerifiedEmail(env, email, email.split("@", 1)[0]);
  if (!existingRole && allowlisted) {
    await grantAdminRole(env, user.id, null);
  }
  const session = await createAuthSession(env, {
    userId: user.id,
    purpose: "enrollment",
    authenticationMethod: "access-bootstrap",
  });
  await authAuditStatement(env, {
    action: "access-bootstrap-used",
    summary: "Used Cloudflare Access to begin administrator passkey enrollment.",
    subjectUserId: user.id,
  }).run();
  return {
    cookie: authSessionCookie(session.token, privilegedSessionLifetimeSeconds),
    expiresAt: session.expiresAt,
  };
}

function bootstrapEmails(env: Env): string[] {
  return (env.AUTH_BOOTSTRAP_ADMIN_EMAILS ?? "")
    .split(",")
    .map(normalizeEmail)
    .filter(Boolean);
}
