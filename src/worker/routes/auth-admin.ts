import {
  disableAccount,
  enableAccount,
  listAdminAccounts,
  requestPasskeyReset,
  revokeAccountSessions,
} from "../auth/admin-recovery";
import { requireAdmin } from "../auth/authorization";
import type { Env } from "../env";
import { json, readJson } from "../http";
import { hasTrustedOrigin } from "../origin";
import { withPrivateHeaders } from "../private-response";

export async function handleAuthAdminApi(request: Request, env: Env): Promise<Response> {
  const identity = await requireAdmin(request, env);
  if (identity instanceof Response) return identity;
  if (!identity.userId) {
    return privateJson({ ok: false, error: "Passkey administrator session required" }, { status: 401 });
  }
  const url = new URL(request.url);
  if (request.method === "GET" && url.pathname === "/api/activate-ri-2026/admin/accounts") {
    return privateJson({ ok: true, accounts: await listAdminAccounts(env) });
  }
  if (request.method !== "GET" && !hasTrustedOrigin(request, env)) {
    return privateJson({ ok: false, error: "Forbidden" }, { status: 403 });
  }
  const match = url.pathname.match(
    /^\/api\/activate-ri-2026\/admin\/accounts\/([^/]+)\/(passkey-reset|revoke-auth-sessions|disable-auth|enable-auth)$/,
  );
  if (request.method !== "POST" || !match) {
    return privateJson({ ok: false, error: "Not found" }, { status: 404 });
  }
  const subjectUserId = decodeURIComponent(match[1]);
  const action = match[2];
  if (action === "passkey-reset") {
    const result = await requestPasskeyReset(request, env, identity.userId, subjectUserId);
    return result === "not-found"
      ? privateJson({ ok: false, error: "Account not found" }, { status: 404 })
      : privateJson({ ok: result === "sent", deliveryStatus: result }, { status: result === "sent" ? 200 : 502 });
  }
  if (action === "revoke-auth-sessions") {
    return await revokeAccountSessions(env, identity.userId, subjectUserId)
      ? privateJson({ ok: true })
      : privateJson({ ok: false, error: "Account not found" }, { status: 404 });
  }
  if (action === "enable-auth") {
    return await enableAccount(env, identity.userId, subjectUserId)
      ? privateJson({ ok: true, recoveryRequired: true })
      : privateJson({ ok: false, error: "Account not found" }, { status: 404 });
  }
  const payload = await safePayload(request);
  const confirmation = isRecord(payload) && typeof payload.confirmation === "string"
    ? payload.confirmation
    : "";
  const result = await disableAccount(env, identity.userId, subjectUserId, confirmation);
  return result === "disabled"
    ? privateJson({ ok: true })
    : privateJson({ ok: false, error: result === "confirmation" ? "Confirmation did not match" : "Account not found" }, { status: result === "confirmation" ? 409 : 404 });
}

async function safePayload(request: Request): Promise<unknown> {
  try {
    return await readJson(request);
  } catch {
    return null;
  }
}

function privateJson(data: unknown, init: ResponseInit = {}): Response {
  return withPrivateHeaders(json(data, init));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
