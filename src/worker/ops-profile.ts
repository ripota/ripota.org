import {
  opsActivatorAuthorLabel,
  opsActivatorDisplayName,
} from "../lib/activate-ri/ops-author";
import type { ActivatorIdentity } from "./auth/authorization";
import type { Env } from "./env";
import { json, readJson } from "./http";
import { hasTrustedOrigin } from "./origin";
import { withPrivateHeaders } from "./private-response";

export async function opsProfileResponse(
  request: Request,
  env: Env,
  identity: ActivatorIdentity,
): Promise<Response> {
  const respond = (body: unknown, status = 200) =>
    withPrivateHeaders(json(body, { status }), "portal");
  const membership = await env.DB.prepare(
    `SELECT chat_display_name FROM activate_ri_ops_memberships
     WHERE event_id = ? AND activator_id = ?`,
  ).bind(env.ACTIVATE_RI_EVENT_ID, identity.activatorId)
    .first<{ chat_display_name: string | null }>();
  if (!membership) {
    return respond({ ok: false, error: "Ops Room membership unavailable" }, 403);
  }

  let chatDisplayName = membership.chat_display_name;
  if (request.method !== "GET") {
    if (request.method !== "PATCH") return respond({ ok: false, error: "Method not allowed" }, 405);
    if (!hasTrustedOrigin(request, env)) return respond({ ok: false, error: "Forbidden" }, 403);

    let payload: unknown;
    try {
      payload = await readJson(request);
    } catch (error) {
      return error instanceof Response
        ? respond({ ok: false, error: "Expected application/json." }, 415)
        : respond({ ok: false, error: "Expected valid JSON." }, 400);
    }
    if (!payload || typeof payload !== "object" || Array.isArray(payload) ||
        !("displayName" in payload) ||
        (payload.displayName !== null && typeof payload.displayName !== "string")) {
      return respond({ ok: false, error: "Choose a chat display name." }, 400);
    }
    if (typeof payload.displayName === "string" &&
        (/[\p{Cc}\u2028\u2029]/u.test(payload.displayName) || payload.displayName.trim().length > 40)) {
      return respond({ ok: false, error: "Use a display name of 40 characters or fewer without line breaks or control characters." }, 400);
    }
    chatDisplayName = payload.displayName === null ? null : payload.displayName.trim();
    const result = await env.DB.prepare(
      `UPDATE activate_ri_ops_memberships
       SET chat_display_name = ?, updated_at = ?
       WHERE event_id = ? AND activator_id = ?`,
    ).bind(chatDisplayName, new Date().toISOString(), env.ACTIVATE_RI_EVENT_ID, identity.activatorId).run();
    if ((result.meta?.changes ?? 0) === 0) {
      return respond({ ok: false, error: "Ops Room membership unavailable" }, 403);
    }
  }

  return respond({
    ok: true,
    callsign: identity.callsign.trim().toUpperCase(),
    displayName: opsActivatorDisplayName(identity.callsign, identity.name, chatDisplayName),
    authorLabel: opsActivatorAuthorLabel(identity.callsign, identity.name, chatDisplayName),
  });
}
