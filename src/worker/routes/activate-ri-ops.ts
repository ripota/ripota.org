import { validateOpsMessage } from "../../lib/activate-ri/ops-validation";
import { requireActivatorSession } from "../activator-session";
import type { Env } from "../env";
import { json, readJson } from "../http";
import {
  acceptOpsRules,
  createOpsMessage,
  getOpsAccess,
  getOpsBootstrap,
  listOpsEvents,
  removeOwnOpsMessage,
  setOwnOpsMessageResolved,
} from "../ops-db";
import { hasTrustedOrigin } from "../origin";
import { withPrivateHeaders } from "../private-response";

export async function handleActivateRiOpsApi(
  request: Request,
  env: Env,
): Promise<Response> {
  const identity = await requireActivatorSession(request, env);
  if (identity instanceof Response) {
    return identity;
  }

  const access = await getOpsAccess(env, identity.activatorId);
  if (!access || access.membership.status === "banned") {
    return privateJson({ ok: false, error: "Ops Room access unavailable" }, { status: 403 });
  }
  if (access.effectiveRoomMode === "off") {
    return privateJson({ ok: false, error: "Ops Room unavailable" }, { status: 503 });
  }

  const url = new URL(request.url);
  if (request.method === "GET" && url.pathname === "/api/activate-ri-2026/ops/bootstrap") {
    const bootstrap = await getOpsBootstrap(env, identity.activatorId);
    return bootstrap
      ? privateJson({ ok: true, ...bootstrap })
      : privateJson({ ok: false, error: "Ops Room access unavailable" }, { status: 403 });
  }

  if (request.method === "GET" && url.pathname === "/api/activate-ri-2026/ops/events") {
    const query = eventQuery(url);
    if (!query.ok) {
      return privateJson({ ok: false, errors: query.errors }, { status: 400 });
    }
    return privateJson({ ok: true, ...(await listOpsEvents(env, query.after, query.through, query.limit)) });
  }

  if (request.method === "POST" && url.pathname === "/api/activate-ri-2026/ops/rules/accept") {
    if (!hasTrustedOrigin(request, env)) {
      return privateJson({ ok: false, error: "Forbidden" }, { status: 403 });
    }
    const accepted = await acceptOpsRules(env, identity.activatorId);
    return accepted
      ? privateJson({ ok: true, rulesVersion: access.settings.rules_version })
      : privateJson({ ok: false, error: "Ops Room access unavailable" }, { status: 403 });
  }

  if (request.method === "POST" && url.pathname === "/api/activate-ri-2026/ops/messages") {
    if (!hasTrustedOrigin(request, env)) {
      return privateJson({ ok: false, error: "Forbidden" }, { status: 403 });
    }
    if (access.membership.status !== "active") {
      return privateJson({ ok: false, error: "Posting is unavailable" }, { status: 403 });
    }
    if (access.effectiveRoomMode !== "full") {
      return privateJson({ ok: false, error: "Announcements only" }, { status: 403 });
    }
    if (access.membership.accepted_rules_version !== access.settings.rules_version) {
      return privateJson({ ok: false, error: "Accept the current room rules first" }, { status: 409 });
    }

    let payload: unknown;
    try {
      payload = await readJson(request);
    } catch (error) {
      return error instanceof Response
        ? privateJson({ ok: false, errors: ["Expected application/json."] }, { status: 415 })
        : privateJson({ ok: false, errors: ["Expected valid JSON."] }, { status: 400 });
    }
    const validation = validateOpsMessage(payload);
    if (!validation.ok) {
      return privateJson({ ok: false, errors: validation.errors }, { status: 400 });
    }
    const event = await createOpsMessage(env, {
      type: "activator",
      activatorId: identity.activatorId,
      label: identity.callsign,
    }, validation.value);
    return event
      ? privateJson({ ok: true, event })
      : privateJson({ ok: false, error: "Message could not be posted" }, { status: 403 });
  }

  const messageMutation = url.pathname.match(
    /^\/api\/activate-ri-2026\/ops\/messages\/([^/]+)\/(remove|resolve|reopen)$/,
  );
  if (request.method === "POST" && messageMutation) {
    if (!hasTrustedOrigin(request, env)) {
      return privateJson({ ok: false, error: "Forbidden" }, { status: 403 });
    }
    if (access.membership.status !== "active" || access.effectiveRoomMode !== "full") {
      return privateJson({ ok: false, error: "Posting is unavailable" }, { status: 403 });
    }
    if (access.membership.accepted_rules_version !== access.settings.rules_version) {
      return privateJson({ ok: false, error: "Accept the current room rules first" }, { status: 409 });
    }
    const messageId = decodePathSegment(messageMutation[1]);
    const action = messageMutation[2];
    const event = action === "remove"
      ? await removeOwnOpsMessage(env, identity.activatorId, messageId)
      : await setOwnOpsMessageResolved(
          env,
          identity.activatorId,
          messageId,
          action === "resolve",
        );
    return event
      ? privateJson({ ok: true, event })
      : privateJson({ ok: false, error: "Message not found" }, { status: 404 });
  }

  return privateJson({ ok: false, error: "Not found" }, { status: 404 });
}

function eventQuery(url: URL):
  | { ok: true; after: number; through: number; limit: number }
  | { ok: false; errors: string[] } {
  const after = nonNegativeInteger(url.searchParams.get("after"));
  const through = nonNegativeInteger(url.searchParams.get("through"));
  const requestedLimit = nonNegativeInteger(url.searchParams.get("limit") ?? "250");
  if (after === null || through === null || requestedLimit === null || requestedLimit < 1) {
    return { ok: false, errors: ["Use non-negative integer cursors and a positive limit."] };
  }
  if (through < after) {
    return { ok: false, errors: ["The through cursor must not precede the after cursor."] };
  }
  return { ok: true, after, through, limit: Math.min(requestedLimit, 250) };
}

function nonNegativeInteger(value: string | null): number | null {
  if (value === null || !/^\d+$/.test(value)) {
    return null;
  }
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

function privateJson(data: unknown, init: ResponseInit = {}): Response {
  return withPrivateHeaders(json(data, init), "portal");
}

function decodePathSegment(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return "";
  }
}
