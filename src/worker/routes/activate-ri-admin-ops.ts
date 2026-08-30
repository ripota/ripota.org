import {
  validateOpsMessage,
  validateModerationReason,
  validateOpsAnnouncement,
  validateOpsMembershipPatch,
  validateOpsRoomMode,
} from "../../lib/activate-ri/ops-validation";
import { requireAdmin } from "../auth/authorization";
import {
  replaceActivatorSecureLinks,
  revokeActivatorSessions,
} from "../db";
import { sendActivatorSecureLinksReplacedEmail } from "../email";
import { tokenHash } from "../edit-token";
import type { Env } from "../env";
import { json, readJson } from "../http";
import { getOpsAdminState, listOpsEvents } from "../ops-db";
import {
  disconnectOpsMember,
  getOpsRoomStats,
  moderateOpsMessageThroughRoom,
  postAdminOpsMessageThroughRoom,
  postOpsAnnouncementThroughRoom,
  updateOpsMemberThroughRoom,
  updateOpsModeThroughRoom,
} from "../ops-room-client";
import { createOpsEmailBroadcast, sendOpsEmailBroadcast } from "../ops-email";
import { hasTrustedOrigin } from "../origin";
import { trustedSiteUrl } from "../origin";
import { withPrivateHeaders } from "../private-response";

export async function handleActivateRiAdminOpsApi(
  request: Request,
  env: Env,
  ctx?: ExecutionContext,
): Promise<Response> {
  const identity = await requireAdmin(request, env);
  if (identity instanceof Response) {
    return withPrivateHeaders(identity);
  }

  const url = new URL(request.url);
  if (request.method === "GET" && url.pathname === "/api/activate-ri-2026/admin/ops") {
    const [state, stats] = await Promise.all([
      getOpsAdminState(env),
      getOpsRoomStats(env),
    ]);
    return privateJson({ ok: true, ...state, ...stats });
  }

  if (request.method === "GET" && url.pathname === "/api/activate-ri-2026/admin/ops/events") {
    const after = integerQuery(url.searchParams.get("after"));
    const through = integerQuery(url.searchParams.get("through"));
    if (after === null || through === null || through < after) {
      return privateJson({ ok: false, errors: ["Use valid event cursors."] }, { status: 400 });
    }
    return privateJson({ ok: true, ...(await listOpsEvents(env, after, through, 250)) });
  }

  if (request.method === "POST" && url.pathname === "/api/activate-ri-2026/admin/ops/messages") {
    const payload = await mutationPayload(request, env);
    if (payload instanceof Response) return payload;
    const validation = validateOpsMessage(payload);
    if (!validation.ok || !["chat", "access-note"].includes(validation.ok ? validation.value.kind : "")) {
      return privateJson(
        { ok: false, errors: validation.ok ? ["Organizers may post general or park access updates here."] : validation.errors },
        { status: 400 },
      );
    }
    const normalizedEmail = identity.email.trim().toLowerCase();
    const actorKey = `admin:${await tokenHash(normalizedEmail)}`;
    const localPart = normalizedEmail.split("@")[0] || "organizer";
    return withPrivateHeaders(await postAdminOpsMessageThroughRoom(
      env,
      actorKey,
      `Organizer (${localPart})`,
      identity.email,
      validation.value,
    ));
  }

  if (request.method === "PATCH" && url.pathname === "/api/activate-ri-2026/admin/ops/settings") {
    if (!hasTrustedOrigin(request, env)) {
      return privateJson({ ok: false, error: "Forbidden" }, { status: 403 });
    }
    let payload: unknown;
    try {
      payload = await readJson(request);
    } catch (error) {
      return error instanceof Response
        ? privateJson({ ok: false, errors: ["Expected application/json."] }, { status: 415 })
        : privateJson({ ok: false, errors: ["Expected valid JSON."] }, { status: 400 });
    }
    const validation = validateOpsRoomMode(payload);
    if (!validation.ok) {
      return privateJson({ ok: false, errors: validation.errors }, { status: 400 });
    }
    return withPrivateHeaders(
      await updateOpsModeThroughRoom(env, validation.value, identity.email),
    );
  }

  if (request.method === "POST" && url.pathname === "/api/activate-ri-2026/admin/ops/announcements") {
    const payload = await mutationPayload(request, env);
    if (payload instanceof Response) return payload;
    const validation = validateOpsAnnouncement(payload);
    if (!validation.ok) return privateJson({ ok: false, errors: validation.errors }, { status: 400 });
    const actorKey = `admin:${await tokenHash(identity.email.trim().toLowerCase())}`;
    const roomResponse = await postOpsAnnouncementThroughRoom(
      env,
      actorKey,
      identity.email,
      validation.value,
    );
    const body = await roomResponse.json() as {
      ok?: boolean;
      event?: { message?: { id?: string } };
      events?: unknown[];
      error?: string;
    };
    if (!roomResponse.ok || !body.event?.message?.id) {
      return privateJson(body, { status: roomResponse.status });
    }
    let broadcast: { id: string; recipientCount: number } | undefined;
    if (validation.value.emailEligibleActivators) {
      broadcast = await createOpsEmailBroadcast(
        env,
        body.event.message.id,
        identity.email,
      );
      const send = sendOpsEmailBroadcast(env, broadcast.id);
      if (ctx) ctx.waitUntil(send); else await send;
    }
    return privateJson({ ...body, ...(broadcast ? { broadcast } : {}) });
  }

  const moderation = url.pathname.match(
    /^\/api\/activate-ri-2026\/admin\/ops\/messages\/([^/]+)\/(remove|resolve|reopen)$/,
  );
  if (request.method === "POST" && moderation) {
    const payload = await mutationPayload(request, env);
    if (payload instanceof Response) return payload;
    const validation = validateModerationReason(payload);
    if (!validation.ok) return privateJson({ ok: false, errors: validation.errors }, { status: 400 });
    return withPrivateHeaders(await moderateOpsMessageThroughRoom(
      env,
      identity.email,
      decodePathSegment(moderation[1]),
      moderation[2] as "remove" | "resolve" | "reopen",
      validation.value,
    ));
  }

  const memberPatch = url.pathname.match(
    /^\/api\/activate-ri-2026\/admin\/ops\/members\/([^/]+)$/,
  );
  if (request.method === "PATCH" && memberPatch) {
    const payload = await mutationPayload(request, env);
    if (payload instanceof Response) return payload;
    const validation = validateOpsMembershipPatch(payload);
    if (!validation.ok) return privateJson({ ok: false, errors: validation.errors }, { status: 400 });
    return withPrivateHeaders(await updateOpsMemberThroughRoom(
      env,
      identity.email,
      decodePathSegment(memberPatch[1]),
      validation.value.status,
      validation.value.reason,
    ));
  }

  const disconnect = url.pathname.match(
    /^\/api\/activate-ri-2026\/admin\/ops\/members\/([^/]+)\/disconnect$/,
  );
  if (request.method === "POST" && disconnect) {
    const originError = requireMutationOrigin(request, env);
    if (originError) return originError;
    return withPrivateHeaders(
      await disconnectOpsMember(env, decodePathSegment(disconnect[1])),
    );
  }

  const retry = url.pathname.match(
    /^\/api\/activate-ri-2026\/admin\/ops\/broadcasts\/([^/]+)\/retry$/,
  );
  if (request.method === "POST" && retry) {
    const originError = requireMutationOrigin(request, env);
    if (originError) return originError;
    const send = sendOpsEmailBroadcast(env, decodePathSegment(retry[1]), true);
    if (ctx) ctx.waitUntil(send); else await send;
    return privateJson({ ok: true });
  }

  const revokeSessions = url.pathname.match(
    /^\/api\/activate-ri-2026\/admin\/activators\/([^/]+)\/revoke-sessions$/,
  );
  if (request.method === "POST" && revokeSessions) {
    const originError = requireMutationOrigin(request, env);
    if (originError) return originError;
    const activatorId = decodePathSegment(revokeSessions[1]);
    const updated = await revokeActivatorSessions(env, activatorId, identity.email);
    return updated
      ? privateJson({ ok: true })
      : privateJson({ ok: false, error: "Activator not found" }, { status: 404 });
  }

  const replaceLinks = url.pathname.match(
    /^\/api\/activate-ri-2026\/admin\/activators\/([^/]+)\/replace-secure-links$/,
  );
  if (request.method === "POST" && replaceLinks) {
    const originError = requireMutationOrigin(request, env);
    if (originError) return originError;
    const result = await replaceActivatorSecureLinks(
      env,
      decodePathSegment(replaceLinks[1]),
      identity.email,
    );
    if (!result) return privateJson({ ok: false, error: "Activator not found" }, { status: 404 });
    const editUrl = trustedSiteUrl(request, env, "/activate-ri-2026/access/");
    editUrl.hash = result.editToken;
    const emailResult = await sendActivatorSecureLinksReplacedEmail(
      env,
      result.plan,
      editUrl.href,
      trustedSiteUrl(request, env, "/activate-ri-2026/help/").href,
    );
    return privateJson({ ok: true, emailStatus: emailResult.status });
  }

  return privateJson({ ok: false, error: "Not found" }, { status: 404 });
}

async function mutationPayload(request: Request, env: Env): Promise<unknown | Response> {
  const originError = requireMutationOrigin(request, env);
  if (originError) return originError;
  try {
    return await readJson(request);
  } catch (error) {
    return error instanceof Response
      ? privateJson({ ok: false, errors: ["Expected application/json."] }, { status: 415 })
      : privateJson({ ok: false, errors: ["Expected valid JSON."] }, { status: 400 });
  }
}

function requireMutationOrigin(request: Request, env: Env): Response | null {
  return hasTrustedOrigin(request, env)
    ? null
    : privateJson({ ok: false, error: "Forbidden" }, { status: 403 });
}

function decodePathSegment(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return "";
  }
}

function integerQuery(value: string | null): number | null {
  if (value === null || !/^\d+$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

function privateJson(data: unknown, init: ResponseInit = {}): Response {
  return withPrivateHeaders(json(data, init));
}
