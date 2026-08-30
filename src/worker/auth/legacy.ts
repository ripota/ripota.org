import {
  activatorSessionCookie,
  clearActivatorSessionCookie,
  createActivatorSession,
  getActivatorSession,
  type ActivatorSessionIdentity,
} from "../activator-session";
import type { Env } from "../env";
import { authAuditStatement } from "./audit";
import {
  createUserWithVerifiedEmail,
  findUserByVerifiedEmail,
  linkActivatorMembership,
} from "./db";
import { authSessionCookie, prepareAuthSession } from "./session";
import type { AuthMethod } from "./types";

type ActivatorClaimRow = {
  id: string;
  email_normalized: string;
  name: string;
};

export async function claimActivator(
  env: Env,
  activatorId: string,
): Promise<{ userId: string; email: string }> {
  const activator = await env.DB.prepare(
    `SELECT id, email_normalized, name
     FROM activate_ri_activators
     WHERE id = ? AND event_id = ?
     LIMIT 1`,
  ).bind(activatorId, env.ACTIVATE_RI_EVENT_ID).first<ActivatorClaimRow>();
  if (!activator) {
    throw new Error("Activator not found.");
  }
  const existing = await findUserByVerifiedEmail(env, activator.email_normalized);
  if (existing?.disabledAt) {
    throw new Error("Account disabled.");
  }
  const user = existing ?? await createUserWithVerifiedEmail(
    env,
    activator.email_normalized,
    activator.name,
  );
  await linkActivatorMembership(env, user.id, activator.id);
  return { userId: user.id, email: activator.email_normalized };
}

export async function createUnifiedActivatorSession(
  env: Env,
  identity: Pick<ActivatorSessionIdentity, "activatorId">,
  method: Extract<AuthMethod, "legacy-link" | "legacy-session">,
): Promise<{ cookie: string; expiresAt: string }> {
  const claim = await claimActivator(env, identity.activatorId);
  const now = new Date().toISOString();
  const session = await prepareAuthSession(env, {
    userId: claim.userId,
    authenticationMethod: method,
  });
  await env.DB.batch([
    session.statement,
    authAuditStatement(env, {
      action: method === "legacy-link" ? "legacy-link-consumed" : "legacy-session-upgraded",
      summary: method === "legacy-link"
        ? "Consumed a compatible activator edit link."
        : "Upgraded a compatible activator session.",
      actorUserId: claim.userId,
      subjectUserId: claim.userId,
      createdAt: now,
    }),
  ]);
  return { cookie: authSessionCookie(session.token), expiresAt: session.expiresAt };
}

export async function consumeLegacyEditToken(env: Env, token: string) {
  const legacy = await createActivatorSession(env, token);
  if (!legacy) {
    return null;
  }
  const unified = await createUnifiedActivatorSession(env, legacy.identity, "legacy-link");
  return { legacy, unified };
}

export function legacySessionCookie(sessionToken: string): string {
  return activatorSessionCookie(sessionToken);
}

export async function upgradeLegacySession(request: Request, env: Env) {
  const identity = await getActivatorSession(request, env);
  if (!identity) {
    return null;
  }
  const unified = await createUnifiedActivatorSession(env, identity, "legacy-session");
  return {
    identity,
    unified,
    clearLegacyCookie: clearActivatorSessionCookie(),
  };
}
