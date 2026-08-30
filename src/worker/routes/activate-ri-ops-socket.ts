import { requireAccessIdentity } from "../access";
import { getActivatorSession } from "../activator-session";
import { tokenHash } from "../edit-token";
import type { Env } from "../env";
import { json } from "../http";
import { getOpsAccess, getOpsAdminState } from "../ops-db";
import { actorHeaders, opsRoomStub } from "../ops-room-client";
import { hasTrustedOrigin } from "../origin";
import { withPrivateHeaders } from "../private-response";

export async function handleActivateRiOpsSocket(
  request: Request,
  env: Env,
): Promise<Response> {
  if (request.method !== "GET" || request.headers.get("upgrade")?.toLowerCase() !== "websocket") {
    return privateJson({ ok: false, error: "WebSocket upgrade required" }, { status: 426 });
  }
  if (!hasTrustedOrigin(request, env)) {
    return privateJson({ ok: false, error: "Forbidden" }, { status: 403 });
  }

  const activator = await getActivatorSession(request, env);
  let headers: Headers;
  if (activator) {
    const access = await getOpsAccess(env, activator.activatorId);
    if (!access || access.membership.status === "banned") {
      return privateJson({ ok: false, error: "Ops Room access unavailable" }, { status: 403 });
    }
    if (access.effectiveRoomMode === "off") {
      return privateJson({ ok: false, error: "Ops Room unavailable" }, { status: 503 });
    }
    headers = actorHeaders({
      type: "activator",
      activatorId: activator.activatorId,
      label: activator.callsign,
    });
    headers.set("x-ops-membership-status", access.membership.status);
    headers.set("x-ops-room-mode", access.effectiveRoomMode);
  } else {
    const admin = await requireAccessIdentity(request, env);
    if (admin instanceof Response) {
      return withPrivateHeaders(admin);
    }
    headers = actorHeaders({
      type: "admin",
      key: `admin:${await tokenHash(admin.email.trim().toLowerCase())}`,
      label: "Organizer",
    });
    const state = await getOpsAdminState(env);
    const mode = state.hardDisabled ? "off" : state.settings?.room_mode ?? "off";
    headers.set("x-ops-room-mode", mode);
  }

  return opsRoomStub(env).fetch("https://ops.internal/socket", {
    headers: {
      ...Object.fromEntries(headers),
      upgrade: "websocket",
    },
  });
}

function privateJson(data: unknown, init: ResponseInit = {}): Response {
  return withPrivateHeaders(json(data, init));
}
