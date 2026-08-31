import {
  normalizeBandList,
  normalizeModeList,
  validatePlanSubmission,
} from "../../lib/activate-ri/validation";
import { planRowsToPublicStops } from "../../lib/activate-ri/public-export";
import {
  activatorSessionCookie,
  clearActivatorSessionCookie,
  createActivatorSession,
  revokeCurrentActivatorSession,
  type ActivatorSessionIdentity,
} from "../activator-session";
import { requireActivator, requireAdmin } from "../auth/authorization";
import { getAuthConfig, isLegacyLinkIssuanceEnabled } from "../auth/config";
import { issueActivatorEmailLogin } from "../auth/email-login";
import { createUnifiedActivatorSession } from "../auth/legacy";
import { getAuthContext } from "../auth/session";
import { isActivatorMembershipConflict } from "../auth/db";
import {
  activatorSignupExists,
  approvePlan,
  cancelPlanByTokenHash,
  cancelPlanByActivatorId,
  cancelStopByToken,
  cancelStopByActivatorId,
  findActivatorForEditLinkResend,
  getPlanById,
  getPlanByActivatorId,
  getPlanByTokenHash,
  getPlansByActivatorId,
  getPlansByTokenHash,
  insertPendingPlan,
  listActivityEvents,
  listPendingPlans,
  listPublicStopRows,
  listSeenClubs,
  logActivityEvent,
  markEditLinkEmailEvent,
  markEditLinkSent,
  updatePlanByTokenHash,
  updatePlanByActivatorId,
  updateStopByToken,
  updateStopByActivatorId,
  type EditablePlanSubmission,
  type EditStopFields,
} from "../db";
import {
  sendActivatorApprovalEmail,
  sendActivatorEditLinkEmail,
  sendActivatorPlanCancelledEmail,
  sendActivatorPlanUpdatedEmail,
  sendAdminActivityEmail,
  sendAdminPendingPlanEmail,
} from "../email";
import { tokenHash } from "../edit-token";
import type { Env } from "../env";
import { json, readJson } from "../http";
import { hasTrustedOrigin, trustedSiteUrl } from "../origin";
import { withPrivateHeaders } from "../private-response";
import { verifyTurnstile } from "../turnstile";
import { handleActivateRiAdminOpsApi } from "./activate-ri-admin-ops";
import { handleActivateRiOpsApi } from "./activate-ri-ops";
import { handleActivateRiOpsSocket } from "./activate-ri-ops-socket";
import { handleAuthAdminApi } from "./auth-admin";
import {
  getPotaAdminStatus,
  getPublicPotaParkStatus,
  requestDeepPotaReconciliation,
  runPotaHistoryReconciliation,
} from "../pota-event";
import { logWorkerError } from "../logging";

const submissionReceivedMessage =
  "Submission received for organizer review.";
const resendLinkMessage =
  "If we found a matching signup, we sent a sign-in link.";
const timePattern = /^([01]\d|2[0-3]):[0-5]\d$/;
const publicJsonCacheControl =
  "public, max-age=60, s-maxage=60, stale-while-revalidate=300";
const publicJsonCacheHeaders = {
  "cache-control": publicJsonCacheControl,
};
type WorkerCacheStorage = CacheStorage & { default?: Cache };

export async function handleActivateRiApi(
  request: Request,
  env: Env,
  ctx?: ExecutionContext,
): Promise<Response> {
  const url = new URL(request.url);

  if (
    env.REMOTE_DATA_READ_ONLY === "true" &&
    request.method !== "GET" &&
    request.method !== "HEAD"
  ) {
    return json(
      {
        ok: false,
        error: "Remote production data is read-only in local development.",
      },
      { status: 403 },
    );
  }

  if (url.pathname.startsWith("/api/activate-ri-2026/admin/ops") ||
    /^\/api\/activate-ri-2026\/admin\/activators\/[^/]+\/(?:revoke-sessions|revoke-legacy-access|replace-secure-links)$/.test(url.pathname)) {
    return handleActivateRiAdminOpsApi(request, env, ctx);
  }

  if (url.pathname.startsWith("/api/activate-ri-2026/admin/accounts")) {
    return handleAuthAdminApi(request, env);
  }

  if (url.pathname === "/api/activate-ri-2026/ops/socket") {
    return handleActivateRiOpsSocket(request, env);
  }

  if (url.pathname.startsWith("/api/activate-ri-2026/ops/")) {
    return handleActivateRiOpsApi(request, env);
  }

  if (
    request.method === "GET" &&
    url.pathname === "/api/activate-ri-2026/admin/plans"
  ) {
    const identity = await requireAdmin(request, env);
    if (identity instanceof Response) {
      return identity;
    }

    return json({ ok: true, plans: await listPendingPlans(env) });
  }

  if (
    request.method === "GET" &&
    url.pathname === "/api/activate-ri-2026/admin/activity"
  ) {
    const identity = await requireAdmin(request, env);
    if (identity instanceof Response) {
      return identity;
    }

    return json({ ok: true, events: await listActivityEvents(env) });
  }

  if (
    request.method === "POST" &&
    url.pathname === "/api/activate-ri-2026/admin/publish"
  ) {
    const identity = await requireAdmin(request, env);
    if (identity instanceof Response) {
      return identity;
    }

    return json({
      ok: true,
      generatedAt: new Date().toISOString(),
      rows: await listPublicStopRows(env),
    });
  }

  if (
    request.method === "GET" &&
    url.pathname === "/api/activate-ri-2026/public/stops"
  ) {
    return handlePublicStops(request, env, ctx);
  }

  if (
    request.method === "GET" &&
    url.pathname === "/api/activate-ri-2026/public/park-status"
  ) {
    return json(
      await getPublicPotaParkStatus(env),
      { headers: publicJsonCacheHeaders },
    );
  }

  if (
    request.method === "GET" &&
    url.pathname === "/api/activate-ri-2026/admin/pota-status"
  ) {
    const identity = await requireAdmin(request, env);
    if (identity instanceof Response) return identity;
    return privateJson({ ok: true, status: await getPotaAdminStatus(env) });
  }

  if (
    request.method === "POST" &&
    url.pathname === "/api/activate-ri-2026/admin/pota-reconcile"
  ) {
    const identity = await requireAdmin(request, env);
    if (identity instanceof Response) return identity;
    if (!hasTrustedOrigin(request, env)) {
      return privateJson({ ok: false, error: "Forbidden" }, { status: 403 });
    }
    const deep = await requestedDeepReconciliation(request);
    if (deep) await requestDeepPotaReconciliation(env);
    const work = runPotaHistoryReconciliation(env, { force: true });
    if (ctx) {
      ctx.waitUntil(work.then((result) => {
        console.log(JSON.stringify({
          event: "activate-ri-pota-manual-reconciliation",
          requestedByRole: "admin",
          ...result,
        }));
      }));
    } else {
      await work;
    }
    return privateJson({
      ok: true,
      accepted: true,
      deep,
      message: deep
        ? "Deep POTA reconciliation started and will continue in scheduled batches."
        : "POTA reconciliation batch started.",
    }, { status: 202 });
  }

  if (
    request.method === "GET" &&
    url.pathname === "/api/activate-ri-2026/public/clubs"
  ) {
    return json(
      { ok: true, clubs: await listSeenClubs(env) },
      { headers: publicJsonCacheHeaders },
    );
  }

  if (url.pathname === "/api/activate-ri-2026/activator/session") {
    return handleActivatorSession(request, env);
  }

  if (
    request.method === "GET" &&
    url.pathname === "/api/activate-ri-2026/activator/plans"
  ) {
    return handleActivatorPlansLookup(request, env);
  }

  const activatorPlanMatch = url.pathname.match(
    /^\/api\/activate-ri-2026\/activator\/plans\/([^/]+)$/,
  );
  if (request.method === "PATCH" && activatorPlanMatch) {
    return handleActivatorPlanUpdate(request, env, activatorPlanMatch[1]);
  }

  const activatorPlanCancelMatch = url.pathname.match(
    /^\/api\/activate-ri-2026\/activator\/plans\/([^/]+)\/cancel$/,
  );
  if (request.method === "POST" && activatorPlanCancelMatch) {
    return handleActivatorPlanCancel(request, env, activatorPlanCancelMatch[1]);
  }

  const activatorStopMatch = url.pathname.match(
    /^\/api\/activate-ri-2026\/activator\/stops\/([^/]+)$/,
  );
  if (request.method === "PATCH" && activatorStopMatch) {
    return handleActivatorStopUpdate(request, env, activatorStopMatch[1]);
  }

  const activatorStopCancelMatch = url.pathname.match(
    /^\/api\/activate-ri-2026\/activator\/stops\/([^/]+)\/cancel$/,
  );
  if (request.method === "POST" && activatorStopCancelMatch) {
    return handleActivatorStopCancel(request, env, activatorStopCancelMatch[1]);
  }

  const approveMatch = url.pathname.match(
    /^\/api\/activate-ri-2026\/admin\/plans\/([^/]+)\/approve$/,
  );
  if (request.method === "POST" && approveMatch) {
    const identity = await requireAdmin(request, env);
    if (identity instanceof Response) {
      return identity;
    }

    const planId = decodePathSegment(approveMatch[1]);
    if (!planId) {
      return json({ ok: false, error: "Plan not found" }, { status: 404 });
    }

    const result = await approvePlan(env, planId, identity.email);
    if (!result.ok) {
      return json(
        { ok: false, error: result.error },
        { status: result.status },
      );
    }

    const plan = await getPlanById(env, planId);
    if (plan) {
      const emailResult = await sendActivatorApprovalEmail(
        env,
        plan,
        portalPlanUrl(request, env),
        absoluteHelpUrl(request, env),
        absoluteScheduleUrl(request, env),
      );
      if (emailResult.status !== "sent") {
        await logActivityEvent(env, {
          planId: plan.id,
          actorType: "system",
          actorEmail: plan.submitter_email,
          action: emailResult.status === "skipped"
            ? "approval-email-skipped"
            : "approval-email-failed",
          summary: emailResult.status === "skipped"
            ? `Approval email skipped for ${plan.submitter_email}.`
            : `Approval email failed for ${plan.submitter_email}.`,
          details: emailActivityDetails(emailResult),
        });
      }
    }

    return json({ ok: true });
  }

  const editPlanMatch = url.pathname.match(
    /^\/api\/activate-ri-2026\/edit\/([^/]+)\/plans$/,
  );
  if (request.method === "GET" && editPlanMatch) {
    return handleEditPlansLookup(env, editPlanMatch[1]);
  }

  const editPlanByIdMatch = url.pathname.match(
    /^\/api\/activate-ri-2026\/edit\/([^/]+)\/plans\/([^/]+)$/,
  );
  if (request.method === "PATCH" && editPlanByIdMatch) {
    return handleEditPlanUpdate(
      request,
      env,
      editPlanByIdMatch[1],
      editPlanByIdMatch[2],
    );
  }

  const cancelPlanMatch = url.pathname.match(
    /^\/api\/activate-ri-2026\/edit\/([^/]+)\/plans\/([^/]+)\/cancel$/,
  );
  if (request.method === "POST" && cancelPlanMatch) {
    return handleCancelPlan(request, env, cancelPlanMatch[1], cancelPlanMatch[2]);
  }

  const editStopMatch = url.pathname.match(
    /^\/api\/activate-ri-2026\/edit\/([^/]+)\/stops\/([^/]+)$/,
  );
  if (request.method === "PATCH" && editStopMatch) {
    return handleEditStop(request, env, editStopMatch[1], editStopMatch[2]);
  }

  const cancelStopMatch = url.pathname.match(
    /^\/api\/activate-ri-2026\/edit\/([^/]+)\/stops\/([^/]+)\/cancel$/,
  );
  if (request.method === "POST" && cancelStopMatch) {
    return handleCancelStop(
      request,
      env,
      cancelStopMatch[1],
      cancelStopMatch[2],
    );
  }

  if (
    request.method === "POST" &&
    url.pathname === "/api/activate-ri-2026/plans"
  ) {
    return handlePlanSubmission(request, env);
  }

  if (
    request.method === "POST" &&
    url.pathname === "/api/activate-ri-2026/resend-edit-link"
  ) {
    return handleResendEditLink(request, env);
  }

  if (
    request.method === "POST" &&
    url.pathname === "/api/activate-ri-2026/activation-lookup"
  ) {
    return handleActivationLookup(request, env);
  }

  return json({ ok: false, error: "Not found" }, { status: 404 });
}

async function requestedDeepReconciliation(request: Request): Promise<boolean> {
  try {
    const value: unknown = await request.json();
    return !isObject(value) || value.deep !== false;
  } catch {
    return true;
  }
}

async function handlePublicStops(
  request: Request,
  env: Env,
  ctx?: ExecutionContext,
): Promise<Response> {
  const cache = (globalThis.caches as WorkerCacheStorage | undefined)?.default;
  const cacheKey = publicStopsCacheKey(request);
  const shouldBypassCache = publicStopsCacheBypassRequested(request);

  if (cache && !shouldBypassCache) {
    const cachedResponse = await cache.match(cacheKey);
    if (cachedResponse) {
      return cachedResponse;
    }
  }

  const response = json({
    ok: true,
    stops: planRowsToPublicStops(await listPublicStopRows(env)),
    generatedAt: new Date().toISOString(),
  }, { headers: publicJsonCacheHeaders });

  if (!cache || shouldBypassCache) {
    return response;
  }

  const cachePut = cache.put(cacheKey, response.clone());
  if (ctx) {
    ctx.waitUntil(cachePut);
  } else {
    await cachePut;
  }

  return response;
}

function publicStopsCacheBypassRequested(request: Request): boolean {
  const cacheControl = request.headers.get("cache-control")?.toLowerCase() ?? "";
  return cacheControl
    .split(",")
    .map((directive) => directive.trim())
    .some((directive) => directive === "no-cache" || directive === "no-store");
}

function publicStopsCacheKey(request: Request): Request {
  const url = new URL(request.url);
  url.search = "";

  return new Request(url, {
    method: "GET",
    headers: {
      accept: "application/json",
    },
  });
}

async function handleActivatorSession(
  request: Request,
  env: Env,
): Promise<Response> {
  if (request.method === "POST") {
    if (!hasTrustedOrigin(request, env)) {
      return privateJson({ ok: false, error: "Forbidden" }, { status: 403 });
    }

    const payloadResult = await readRequiredPayload(request);
    if (!payloadResult.ok) {
      return privateJson(
        { ok: false, errors: [payloadResult.error] },
        { status: payloadResult.status },
      );
    }

    const token = isObject(payloadResult.value) &&
        typeof payloadResult.value.token === "string"
      ? payloadResult.value.token.trim()
      : "";
    if (!token || token.length > 256) {
      return privateJson(
        { ok: false, error: "Access link not found" },
        { status: 404 },
      );
    }

    const session = await createActivatorSession(env, token);
    if (!session) {
      return privateJson(
        { ok: false, error: "Access link not found" },
        { status: 404 },
      );
    }

    const headers = new Headers();
    headers.append("set-cookie", activatorSessionCookie(session.sessionToken));
    if (getAuthConfig(env, request).activatorMode !== "legacy") {
      try {
        const unified = await createUnifiedActivatorSession(env, session.identity, "legacy-link");
        headers.append("set-cookie", unified.cookie);
      } catch (error) {
        logWorkerError("legacy-link-unified-upgrade-failed", error);
      }
    }
    return privateJson(
      {
        ok: true,
        activator: portalIdentity(session.identity),
        expiresAt: session.identity.expiresAt,
      },
      { headers },
    );
  }

  if (request.method === "GET") {
    const identity = await requireActivator(request, env);
    if (identity instanceof Response) {
      return identity;
    }

    return privateJson({
      ok: true,
      activator: portalIdentity(identity),
      expiresAt: identity.expiresAt,
    });
  }

  if (request.method === "DELETE") {
    if (!hasTrustedOrigin(request, env)) {
      return privateJson({ ok: false, error: "Forbidden" }, { status: 403 });
    }

    await revokeCurrentActivatorSession(request, env);
    return privateJson(
      { ok: true },
      { headers: { "set-cookie": clearActivatorSessionCookie() } },
    );
  }

  return privateJson(
    { ok: false, error: "Method not allowed" },
    { status: 405, headers: { allow: "GET, POST, DELETE" } },
  );
}

async function handleActivatorPlansLookup(
  request: Request,
  env: Env,
): Promise<Response> {
  const identity = await requireActivator(request, env);
  if (identity instanceof Response) {
    return identity;
  }

  const data = await getPlansByActivatorId(env, identity.activatorId);
  if (!data) {
    return privateJson({ ok: false, error: "Plans not found" }, { status: 404 });
  }

  return privateJson({ ok: true, activator: data.activator, plans: data.plans });
}

async function handleActivatorPlanUpdate(
  request: Request,
  env: Env,
  encodedPlanId: string,
): Promise<Response> {
  const identity = await requireMutationSession(request, env);
  if (identity instanceof Response) {
    return identity;
  }

  const planId = decodePathSegment(encodedPlanId);
  if (!planId) {
    return privateJson({ ok: false, error: "Plan not found" }, { status: 404 });
  }

  const payloadResult = await readRequiredPayload(request);
  if (!payloadResult.ok) {
    return privateJson(
      { ok: false, errors: [payloadResult.error] },
      { status: payloadResult.status },
    );
  }

  const validation = validateEditablePlanPayload(payloadResult.value);
  if (!validation.ok) {
    return privateJson({ ok: false, errors: validation.errors }, { status: 400 });
  }

  const turnstileToken = isObject(payloadResult.value)
    ? payloadResult.value.turnstileToken
    : undefined;
  if (!await verifyTurnstile(request, env, turnstileToken)) {
    return privateJson(
      { ok: false, errors: ["Turnstile verification failed."] },
      { status: 400 },
    );
  }

  const updateResult = await updatePlanByActivatorId(
    env,
    identity.activatorId,
    planId,
    validation.value,
  );
  if (!updateResult.ok) {
    return privateJson(
      { ok: false, error: updateResult.error },
      { status: updateResult.status },
    );
  }

  const plan = await getPlanByActivatorId(env, identity.activatorId, planId);
  if (plan) {
    await sendPlanUpdateNotifications(
      request,
      env,
      plan,
      updateResult.highImpactEvents,
      "plan update",
    );
  }

  return privateJson({ ok: true });
}

async function handleActivatorPlanCancel(
  request: Request,
  env: Env,
  encodedPlanId: string,
): Promise<Response> {
  const identity = await requireMutationSession(request, env);
  if (identity instanceof Response) {
    return identity;
  }

  const planId = decodePathSegment(encodedPlanId);
  if (!planId) {
    return privateJson({ ok: false, error: "Plan not found" }, { status: 404 });
  }

  const payloadResult = await readOptionalPayload(request);
  if (!payloadResult.ok) {
    return privateJson(
      { ok: false, errors: [payloadResult.error] },
      { status: payloadResult.status },
    );
  }
  const validation = validateCancelStopPayload(payloadResult.value);
  if (!validation.ok) {
    return privateJson({ ok: false, errors: validation.errors }, { status: 400 });
  }

  const turnstileToken = isObject(payloadResult.value)
    ? payloadResult.value.turnstileToken
    : undefined;
  if (!await verifyTurnstile(request, env, turnstileToken)) {
    return privateJson(
      { ok: false, errors: ["Turnstile verification failed."] },
      { status: 400 },
    );
  }

  const result = await cancelPlanByActivatorId(
    env,
    identity.activatorId,
    planId,
    validation.cancelReason,
  );
  if (!result.ok) {
    return privateJson({ ok: false, error: result.error }, { status: result.status });
  }

  const currentPlan = await getPlanByActivatorId(env, identity.activatorId, planId);
  const plan = currentPlan ?? result.plan;
  const emailResult = await sendActivatorPlanCancelledEmail(
    env,
    plan,
    portalPlanUrl(request, env),
  );
  await logActivityEvent(env, {
    planId: plan.id,
    actorType: "system",
    actorEmail: plan.submitter_email,
    action: activatorNotificationAction(emailResult),
    summary: activatorNotificationSummary(emailResult, "plan cancellation"),
    details: emailActivityDetails(emailResult),
  });

  if (result.highImpactEvents.length > 0) {
    const adminEmailResult = await sendAdminActivityEmail(
      env,
      result.plan,
      result.highImpactEvents,
    );
    await logActivityEvent(env, {
      planId: result.plan.id,
      actorType: "system",
      action: adminNotificationAction(adminEmailResult),
      summary: adminNotificationSummary(adminEmailResult, "plan cancellation"),
      details: emailActivityDetails(adminEmailResult, { includeRecipients: true }),
    });
  }

  return privateJson({ ok: true });
}

async function handleActivatorStopUpdate(
  request: Request,
  env: Env,
  encodedStopId: string,
): Promise<Response> {
  const identity = await requireMutationSession(request, env);
  if (identity instanceof Response) {
    return identity;
  }

  const stopId = decodePathSegment(encodedStopId);
  if (!stopId) {
    return privateJson({ ok: false, error: "Stop not found" }, { status: 404 });
  }

  const payloadResult = await readRequiredPayload(request);
  if (!payloadResult.ok) {
    return privateJson(
      { ok: false, errors: [payloadResult.error] },
      { status: payloadResult.status },
    );
  }
  const validation = validateEditStopPayload(payloadResult.value);
  if (!validation.ok) {
    return privateJson({ ok: false, errors: validation.errors }, { status: 400 });
  }

  const result = await updateStopByActivatorId(
    env,
    identity.activatorId,
    stopId,
    validation.value,
  );
  if (!result.ok) {
    return privateJson({ ok: false, error: result.error }, { status: result.status });
  }

  await sendStopUpdateNotification(request, env, result.plan, stopId, "stop update");
  return privateJson({ ok: true });
}

async function handleActivatorStopCancel(
  request: Request,
  env: Env,
  encodedStopId: string,
): Promise<Response> {
  const identity = await requireMutationSession(request, env);
  if (identity instanceof Response) {
    return identity;
  }

  const stopId = decodePathSegment(encodedStopId);
  if (!stopId) {
    return privateJson({ ok: false, error: "Stop not found" }, { status: 404 });
  }

  const payloadResult = await readOptionalPayload(request);
  if (!payloadResult.ok) {
    return privateJson(
      { ok: false, errors: [payloadResult.error] },
      { status: payloadResult.status },
    );
  }
  const validation = validateCancelStopPayload(payloadResult.value);
  if (!validation.ok) {
    return privateJson({ ok: false, errors: validation.errors }, { status: 400 });
  }

  const result = await cancelStopByActivatorId(
    env,
    identity.activatorId,
    stopId,
    validation.cancelReason,
  );
  if (!result.ok) {
    return privateJson({ ok: false, error: result.error }, { status: result.status });
  }

  await sendStopUpdateNotification(
    request,
    env,
    result.plan,
    stopId,
    "stop cancellation",
  );
  if (result.highImpactEvents.length > 0) {
    const emailResult = await sendAdminActivityEmail(
      env,
      result.plan,
      result.highImpactEvents,
    );
    await logActivityEvent(env, {
      planId: result.plan.id,
      stopId,
      actorType: "system",
      action: adminNotificationAction(emailResult),
      summary: adminNotificationSummary(emailResult, "stop cancellation"),
      details: emailActivityDetails(emailResult, { includeRecipients: true }),
    });
  }

  return privateJson({ ok: true });
}

async function requireMutationSession(
  request: Request,
  env: Env,
): Promise<ActivatorSessionIdentity | Response> {
  if (!hasTrustedOrigin(request, env)) {
    return privateJson({ ok: false, error: "Forbidden" }, { status: 403 });
  }

  return requireActivator(request, env);
}

async function sendPlanUpdateNotifications(
  request: Request,
  env: Env,
  plan: Awaited<ReturnType<typeof getPlanById>> & {},
  highImpactEvents: Parameters<typeof sendAdminActivityEmail>[2],
  label: string,
): Promise<void> {
  if (highImpactEvents.length > 0) {
    const adminResult = await sendAdminActivityEmail(env, plan, highImpactEvents);
    await logActivityEvent(env, {
      planId: plan.id,
      actorType: "system",
      action: adminNotificationAction(adminResult),
      summary: adminNotificationSummary(adminResult, "high-impact edit"),
      details: emailActivityDetails(adminResult, { includeRecipients: true }),
    });
  }

  const activatorResult = await sendActivatorPlanUpdatedEmail(
    env,
    plan,
    portalPlanUrl(request, env),
  );
  await logActivityEvent(env, {
    planId: plan.id,
    actorType: "system",
    actorEmail: plan.submitter_email,
    action: activatorNotificationAction(activatorResult),
    summary: activatorNotificationSummary(activatorResult, label),
    details: emailActivityDetails(activatorResult),
  });
}

async function sendStopUpdateNotification(
  request: Request,
  env: Env,
  plan: NonNullable<Awaited<ReturnType<typeof getPlanById>>>,
  stopId: string,
  label: string,
): Promise<void> {
  const result = await sendActivatorPlanUpdatedEmail(
    env,
    plan,
    portalPlanUrl(request, env),
  );
  await logActivityEvent(env, {
    planId: plan.id,
    stopId,
    actorType: "system",
    actorEmail: plan.submitter_email,
    action: activatorNotificationAction(result),
    summary: activatorNotificationSummary(result, label),
    details: emailActivityDetails(result),
  });
}

function portalIdentity(identity: ActivatorSessionIdentity) {
  return {
    id: identity.activatorId,
    callsign: identity.callsign,
    name: identity.name,
    status: identity.status,
  };
}

function portalPlanUrl(request: Request, env: Env): string {
  return trustedSiteUrl(request, env, "/activate-ri-2026/activator/plan/").href;
}

function privateJson(data: unknown, init: ResponseInit = {}): Response {
  return withPrivateHeaders(json(data, init));
}

async function handleEditStop(
  request: Request,
  env: Env,
  encodedToken: string,
  encodedStopId: string,
): Promise<Response> {
  const token = decodePathSegment(encodedToken);
  const stopId = decodePathSegment(encodedStopId);
  if (!token || !stopId) {
    return json({ ok: false, error: "Stop not found" }, { status: 404 });
  }

  const payloadResult = await readRequiredPayload(request);
  if (!payloadResult.ok) {
    return json(
      { ok: false, errors: [payloadResult.error] },
      { status: payloadResult.status },
    );
  }

  const validation = validateEditStopPayload(payloadResult.value);
  if (!validation.ok) {
    return json({ ok: false, errors: validation.errors }, { status: 400 });
  }

  const result = await updateStopByToken(
    env,
    await tokenHash(token),
    stopId,
    validation.value,
  );
  if (!result.ok) {
    return json(
      { ok: false, error: result.error },
      { status: result.status },
    );
  }

  const activatorEmailResult = await sendActivatorPlanUpdatedEmail(
    env,
    result.plan,
    portalPlanUrl(request, env),
  );
  await logActivityEvent(env, {
    planId: result.plan.id,
    stopId,
    actorType: "system",
    actorEmail: result.plan.submitter_email,
    action: activatorNotificationAction(activatorEmailResult),
    summary: activatorNotificationSummary(activatorEmailResult, "stop update"),
    details: emailActivityDetails(activatorEmailResult),
  });

  return json({ ok: true });
}

async function handleCancelStop(
  request: Request,
  env: Env,
  encodedToken: string,
  encodedStopId: string,
): Promise<Response> {
  const token = decodePathSegment(encodedToken);
  const stopId = decodePathSegment(encodedStopId);
  if (!token || !stopId) {
    return json({ ok: false, error: "Stop not found" }, { status: 404 });
  }

  const payloadResult = await readOptionalPayload(request);
  if (!payloadResult.ok) {
    return json(
      { ok: false, errors: [payloadResult.error] },
      { status: payloadResult.status },
    );
  }

  const validation = validateCancelStopPayload(payloadResult.value);
  if (!validation.ok) {
    return json({ ok: false, errors: validation.errors }, { status: 400 });
  }

  const result = await cancelStopByToken(
    env,
    await tokenHash(token),
    stopId,
    validation.cancelReason,
  );
  if (!result.ok) {
    return json(
      { ok: false, error: result.error },
      { status: result.status },
    );
  }

  const activatorEmailResult = await sendActivatorPlanUpdatedEmail(
    env,
    result.plan,
    portalPlanUrl(request, env),
  );
  await logActivityEvent(env, {
    planId: result.plan.id,
    stopId,
    actorType: "system",
    actorEmail: result.plan.submitter_email,
    action: activatorNotificationAction(activatorEmailResult),
    summary: activatorNotificationSummary(activatorEmailResult, "stop cancellation"),
    details: emailActivityDetails(activatorEmailResult),
  });

  if (result.highImpactEvents.length > 0) {
    const emailResult = await sendAdminActivityEmail(
      env,
      result.plan,
      result.highImpactEvents,
    );
    await logActivityEvent(env, {
      planId: result.plan.id,
      stopId,
      actorType: "system",
      action: adminNotificationAction(emailResult),
      summary: adminNotificationSummary(emailResult, "stop cancellation"),
      details: emailActivityDetails(emailResult, { includeRecipients: true }),
    });
  }

  return json({ ok: true });
}

async function handlePlanSubmission(
  request: Request,
  env: Env,
): Promise<Response> {
  let payload: unknown;

  try {
    payload = await readJson(request);
  } catch (error) {
    if (error instanceof Response) {
      return json(
        { ok: false, errors: ["Expected application/json."] },
        { status: 415 },
      );
    }

    return json(
      { ok: false, errors: ["Expected valid JSON."] },
      { status: 400 },
    );
  }

  const validation = validatePlanSubmission(payload);
  if (!validation.ok) {
    return json({ ok: false, errors: validation.errors }, { status: 400 });
  }

  const turnstileToken = isObject(payload) ? payload.turnstileToken : undefined;
  const turnstileValid = await verifyTurnstile(request, env, turnstileToken);
  if (!turnstileValid) {
    return json(
      { ok: false, errors: ["Turnstile verification failed."] },
      { status: 400 },
    );
  }

  const legacyLinkIssuanceEnabled = isLegacyLinkIssuanceEnabled(env);
  if (!legacyLinkIssuanceEnabled && env.AUTH_EMAIL_LOGIN_ENABLED !== "true") {
    return json({ ok: false, errors: ["Activator email sign-in is temporarily unavailable."] }, { status: 503 });
  }
  const signedIn = await getAuthContext(request, env);
  const linkUserId =
    signedIn?.session.purpose === "authenticated" &&
    signedIn.user.primaryEmail === validation.value.submitterEmail.trim().toLowerCase()
      ? signedIn.user.id
      : undefined;
  let result: Awaited<ReturnType<typeof insertPendingPlan>>;
  try {
    result = await insertPendingPlan(
      env,
      validation.value,
      undefined,
      {
        issueEditToken: legacyLinkIssuanceEnabled,
        linkUserId,
      },
    );
  } catch (error) {
    if (linkUserId && isActivatorMembershipConflict(error)) {
      logWorkerError("signed-in-volunteer-membership-conflict", error);
      return privateJson({
        ok: false,
        error: "We couldn't safely associate this submission with your account. Contact an organizer for help.",
      }, { status: 409 });
    }
    throw error;
  }
  const editUrl = result.editToken
    ? absoluteEditUrl(request, env, result.editToken)
    : null;
  const savedPlan = await getPlanById(env, result.planId);
  const emailResult = editUrl
    ? await sendActivatorEditLinkEmail(
        env,
        savedPlan ?? {
          submitter_callsign: validation.value.submitterCallsign,
          submitter_name: validation.value.submitterName,
          submitter_email: validation.value.submitterEmail,
          status: result.requiresAdminApproval ? "pending" : "approved",
          stops: [],
        },
        editUrl,
        absoluteHelpUrl(request, env),
        { requiresAdminApproval: result.requiresAdminApproval },
      )
    : await issueActivatorEmailLogin(request, env, {
        email: validation.value.submitterEmail,
        activatorId: result.activatorId,
        purpose: "activator-submission",
      });
  if (editUrl && emailResult?.status === "sent") {
    await markEditLinkSent(env, result.activatorId);
  }
  await logActivityEvent(env, {
    planId: result.planId,
    actorType: "activator",
    actorEmail: validation.value.submitterEmail,
    action: "plan-created",
    summary: `${validation.value.submitterCallsign} submitted ${validation.value.stops.length} activation stop${validation.value.stops.length === 1 ? "" : "s"}.`,
    details: {
      submitterCallsign: validation.value.submitterCallsign,
      submitterEmail: validation.value.submitterEmail,
      stopCount: validation.value.stops.length,
      accessEmail: emailResult ? emailActivityDetails(emailResult) : { status: "not-sent" },
      accessMethod: editUrl ? "legacy-link" : "single-use-email",
    },
  });

  if (result.requiresAdminApproval) {
    const adminEmailResult = await sendAdminPendingPlanEmail(env, {
      submitter_callsign: validation.value.submitterCallsign,
      submitter_name: validation.value.submitterName,
      submitter_email: validation.value.submitterEmail,
    });
    await logActivityEvent(env, {
      planId: result.planId,
      actorType: "system",
      action: adminNotificationAction(adminEmailResult),
      summary: adminNotificationSummary(adminEmailResult, "pending submission"),
      details: emailActivityDetails(adminEmailResult, { includeRecipients: true }),
    });
  }

  return json(
    {
      ok: true,
      message: submissionReceivedMessage,
      ...(env.ALLOW_LOCAL_ADMIN_AUTH === "true" && editUrl ? { editUrl } : {}),
    },
    { status: 202 },
  );
}

async function handleEditPlansLookup(
  env: Env,
  encodedToken: string,
): Promise<Response> {
  const token = decodePathSegment(encodedToken);
  if (!token) {
    return json({ ok: false, error: "Plans not found" }, { status: 404 });
  }

  const data = await getPlansByTokenHash(env, await tokenHash(token));
  if (!data) {
    return json({ ok: false, error: "Plans not found" }, { status: 404 });
  }

  return json({ ok: true, activator: data.activator, plans: data.plans });
}

async function handleEditPlanUpdate(
  request: Request,
  env: Env,
  encodedToken: string,
  encodedPlanId: string,
): Promise<Response> {
  const token = decodePathSegment(encodedToken);
  const planId = decodePathSegment(encodedPlanId);
  if (!token || !planId) {
    return json({ ok: false, error: "Plan not found" }, { status: 404 });
  }

  const payloadResult = await readRequiredPayload(request);
  if (!payloadResult.ok) {
    return json(
      { ok: false, errors: [payloadResult.error] },
      { status: payloadResult.status },
    );
  }

  const validation = validateEditablePlanPayload(payloadResult.value);
  if (!validation.ok) {
    return json({ ok: false, errors: validation.errors }, { status: 400 });
  }

  const turnstileToken = isObject(payloadResult.value)
    ? payloadResult.value.turnstileToken
    : undefined;
  const turnstileValid = await verifyTurnstile(request, env, turnstileToken);
  if (!turnstileValid) {
    return json(
      { ok: false, errors: ["Turnstile verification failed."] },
      { status: 400 },
    );
  }

  const editTokenHash = await tokenHash(token);
  const updateResult = await updatePlanByTokenHash(
    env,
    editTokenHash,
    planId,
    validation.value,
  );
  if (!updateResult.ok) {
    return json(
      { ok: false, error: updateResult.error },
      { status: updateResult.status },
    );
  }

  const plan = await getPlanByTokenHash(env, editTokenHash, planId);
  if (plan) {
    if (updateResult.highImpactEvents.length > 0) {
      const emailResult = await sendAdminActivityEmail(
        env,
        plan,
        updateResult.highImpactEvents,
      );
      await logActivityEvent(env, {
        planId: plan.id,
        actorType: "system",
        action: adminNotificationAction(emailResult),
        summary: adminNotificationSummary(emailResult, "high-impact edit"),
        details: emailActivityDetails(emailResult, { includeRecipients: true }),
      });
    }

    const emailResult = await sendActivatorPlanUpdatedEmail(
      env,
      plan,
      portalPlanUrl(request, env),
    );
    await logActivityEvent(env, {
      planId: plan.id,
      actorType: "system",
      actorEmail: plan.submitter_email,
      action: activatorNotificationAction(emailResult),
      summary: activatorNotificationSummary(emailResult, "plan update"),
      details: emailActivityDetails(emailResult),
    });
  }

  return json({ ok: true });
}

async function handleResendEditLink(
  request: Request,
  env: Env,
): Promise<Response> {
  const payloadResult = await readRequiredPayload(request);
  if (!payloadResult.ok) {
    return json(
      { ok: false, errors: [payloadResult.error] },
      { status: payloadResult.status },
    );
  }

  const validation = validateResendPayload(payloadResult.value);
  if (!validation.ok) {
    return json({ ok: false, errors: validation.errors }, { status: 400 });
  }

  const match = await findActivatorForEditLinkResend(
    env,
    validation.callsign,
    validation.email,
    { issueEditToken: isLegacyLinkIssuanceEnabled(env) },
  );
  if (!match) {
    return json({ ok: true, message: resendLinkMessage });
  }

  const emailResult = match.editToken
    ? await sendActivatorEditLinkEmail(
        env,
        match.plan ?? {
          submitter_callsign: match.activator.primary_callsign,
          submitter_name: match.activator.name,
          submitter_email: match.activator.email_normalized,
        },
        absoluteEditUrl(request, env, match.editToken),
        absoluteHelpUrl(request, env),
        { requiresAdminApproval: match.plan?.status !== "approved" },
      )
    : await issueActivatorEmailLogin(request, env, {
        email: validation.email,
        activatorId: match.activator.id,
        rateLimit: true,
      });
  if (!match.editToken) {
    await logActivityEvent(env, {
      planId: match.plan?.id ?? match.activator.id,
      actorType: "system",
      actorEmail: validation.email,
      action: emailResult?.status === "sent" ? "email-login-sent" : "email-login-not-sent",
      summary: emailResult?.status === "sent"
        ? `Single-use sign-in link sent to ${validation.email}.`
        : `Single-use sign-in request did not send for ${validation.email}.`,
      details: emailResult ? emailActivityDetails(emailResult) : { status: "not-sent" },
    });
    return json({ ok: true, message: resendLinkMessage });
  }
  if (!emailResult) {
    return json({ ok: true, message: resendLinkMessage });
  }
  await markEditLinkEmailEvent(
    env,
    match.plan?.id,
    match.activator.id,
    validation.email,
    emailResult.status === "sent"
      ? "edit-link-resent"
      : emailResult.status === "skipped"
        ? "edit-link-send-skipped"
        : "edit-link-send-failed",
    emailResult.status === "sent"
      ? `Private edit link resent to ${validation.email}.`
      : emailResult.status === "skipped"
        ? `Private edit link resend skipped for ${validation.email}.`
        : `Private edit link resend failed for ${validation.email}.`,
    emailActivityDetails(emailResult),
  );

  return json({ ok: true, message: resendLinkMessage });
}

async function handleActivationLookup(
  request: Request,
  env: Env,
): Promise<Response> {
  const payloadResult = await readRequiredPayload(request);
  if (!payloadResult.ok) {
    return json(
      { ok: false, errors: [payloadResult.error] },
      { status: payloadResult.status },
    );
  }

  const validation = validateResendPayload(payloadResult.value);
  if (!validation.ok) {
    return json({ ok: false, errors: validation.errors }, { status: 400 });
  }

  return json({
    ok: true,
    exists: await activatorSignupExists(
      env,
      validation.callsign,
      validation.email,
    ),
  });
}

async function handleCancelPlan(
  request: Request,
  env: Env,
  encodedToken: string,
  encodedPlanId: string,
): Promise<Response> {
  const token = decodePathSegment(encodedToken);
  const planId = decodePathSegment(encodedPlanId);
  if (!token || !planId) {
    return json({ ok: false, error: "Plan not found" }, { status: 404 });
  }

  const payloadResult = await readOptionalPayload(request);
  if (!payloadResult.ok) {
    return json(
      { ok: false, errors: [payloadResult.error] },
      { status: payloadResult.status },
    );
  }

  const validation = validateCancelStopPayload(payloadResult.value);
  if (!validation.ok) {
    return json({ ok: false, errors: validation.errors }, { status: 400 });
  }

  const turnstileToken = isObject(payloadResult.value)
    ? payloadResult.value.turnstileToken
    : undefined;
  const turnstileValid = await verifyTurnstile(request, env, turnstileToken);
  if (!turnstileValid) {
    return json(
      { ok: false, errors: ["Turnstile verification failed."] },
      { status: 400 },
    );
  }

  const editTokenHash = await tokenHash(token);
  const result = await cancelPlanByTokenHash(
    env,
    editTokenHash,
    planId,
    validation.cancelReason,
  );
  if (!result.ok) {
    return json(
      { ok: false, error: result.error },
      { status: result.status },
    );
  }

  const currentPlan = await getPlanByTokenHash(env, editTokenHash, planId);
  const activatorEmailPlan = currentPlan ?? result.plan;
  const activatorEmailResult = await sendActivatorPlanCancelledEmail(
    env,
    activatorEmailPlan,
    portalPlanUrl(request, env),
  );
  await logActivityEvent(env, {
    planId: activatorEmailPlan.id,
    actorType: "system",
    actorEmail: activatorEmailPlan.submitter_email,
    action: activatorNotificationAction(activatorEmailResult),
    summary: activatorNotificationSummary(activatorEmailResult, "plan cancellation"),
    details: emailActivityDetails(activatorEmailResult),
  });

  if (result.highImpactEvents.length > 0) {
    const emailResult = await sendAdminActivityEmail(
      env,
      result.plan,
      result.highImpactEvents,
    );
    await logActivityEvent(env, {
      planId: result.plan.id,
      actorType: "system",
      action: adminNotificationAction(emailResult),
      summary: adminNotificationSummary(emailResult, "plan cancellation"),
      details: emailActivityDetails(emailResult, { includeRecipients: true }),
    });
  }

  return json({ ok: true });
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

type PayloadResult =
  | { ok: true; value: unknown }
  | { ok: false; status: 400 | 415; error: string };

type EditStopValidation =
  | { ok: true; value: EditStopFields }
  | { ok: false; errors: string[] };

type CancelStopValidation =
  | { ok: true; cancelReason: string }
  | { ok: false; errors: string[] };

type EditablePlanValidation =
  | { ok: true; value: EditablePlanSubmission }
  | { ok: false; errors: string[] };

type ResendValidation =
  | { ok: true; callsign: string; email: string }
  | { ok: false; errors: string[] };

async function readRequiredPayload(request: Request): Promise<PayloadResult> {
  try {
    return { ok: true, value: await readJson(request) };
  } catch (error) {
    if (error instanceof Response) {
      return { ok: false, status: 415, error: "Expected application/json." };
    }

    return { ok: false, status: 400, error: "Expected valid JSON." };
  }
}

async function readOptionalPayload(request: Request): Promise<PayloadResult> {
  if (!request.body) {
    return { ok: true, value: {} };
  }

  return readRequiredPayload(request);
}

function validateEditStopPayload(payload: unknown): EditStopValidation {
  if (!isObject(payload)) {
    return { ok: false, errors: ["Enter valid stop updates."] };
  }

  const errors: string[] = [];
  const startTime = stringField(payload, "startTime", errors).trim();
  const endTime = stringField(payload, "endTime", errors).trim();
  const publicNotes = optionalStringField(payload, "publicNotes", errors).trim();
  const bands = normalizeBandList(
    cleanStringArrayField(payload, "bands", errors),
    "Bands",
    errors,
  );
  const modes = normalizeModeList(
    cleanStringArrayField(payload, "modes", errors),
    "Modes",
    errors,
  );

  if (!timePattern.test(startTime)) {
    errors.push("Enter startTime in HH:MM 24-hour format.");
  }

  if (!timePattern.test(endTime)) {
    errors.push("Enter endTime in HH:MM 24-hour format.");
  }

  if (
    timePattern.test(startTime) &&
    timePattern.test(endTime) &&
    endTime <= startTime
  ) {
    errors.push("Enter endTime after startTime.");
  }

  if (bands.length === 0) {
    errors.push("Enter at least one band.");
  }

  if (modes.length === 0) {
    errors.push("Enter at least one mode.");
  }

  if (errors.length > 0) {
    return { ok: false, errors };
  }

  return {
    ok: true,
    value: {
      startTime,
      endTime,
      bands,
      modes,
      publicNotes,
    },
  };
}

function validateCancelStopPayload(payload: unknown): CancelStopValidation {
  if (!isObject(payload)) {
    return { ok: false, errors: ["Enter valid cancellation details."] };
  }

  const value = payload.cancelReason;
  if (value === undefined || value === null) {
    return { ok: true, cancelReason: "" };
  }

  if (typeof value !== "string") {
    return { ok: false, errors: ["Enter cancellation notes as text."] };
  }

  return { ok: true, cancelReason: value };
}

function validateEditablePlanPayload(payload: unknown): EditablePlanValidation {
  const validation = validatePlanSubmission(payload);
  if (!validation.ok) {
    return validation;
  }

  if (!isObject(payload) || !Array.isArray(payload.stops)) {
    return { ok: false, errors: ["Enter a valid plan submission."] };
  }
  const payloadStops = payload.stops;

  return {
    ok: true,
    value: {
      ...validation.value,
      stops: validation.value.stops.map((stop, index) => {
        const inputStop = payloadStops[index];
        const id =
          isObject(inputStop) && typeof inputStop.id === "string"
            ? inputStop.id.trim()
            : "";

        return id ? { ...stop, id } : stop;
      }),
    },
  };
}

function validateResendPayload(payload: unknown): ResendValidation {
  if (!isObject(payload)) {
    return { ok: false, errors: ["Enter a valid resend request."] };
  }

  const errors: string[] = [];
  const callsign = optionalStringField(payload, "callsign", errors)
    .trim()
    .toUpperCase();
  const email = optionalStringField(payload, "email", errors)
    .trim()
    .toLowerCase();

  if (!callsign) {
    errors.push("Enter your callsign.");
  }

  if (!email.includes("@")) {
    errors.push("Enter a valid email address.");
  }

  return errors.length > 0
    ? { ok: false, errors }
    : { ok: true, callsign, email };
}

function stringField(
  payload: Record<string, unknown>,
  key: string,
  errors: string[],
): string {
  const value = payload[key];
  if (typeof value !== "string") {
    errors.push(`Enter ${key} as text.`);
    return "";
  }

  return value;
}

function optionalStringField(
  payload: Record<string, unknown>,
  key: string,
  errors: string[],
): string {
  const value = payload[key];
  if (value === undefined || value === null) {
    return "";
  }

  if (typeof value !== "string") {
    errors.push(`Enter ${key} as text.`);
    return "";
  }

  return value;
}

function cleanStringArrayField(
  payload: Record<string, unknown>,
  key: string,
  errors: string[],
): string[] {
  const value = payload[key];
  if (!Array.isArray(value)) {
    errors.push(`Enter ${key} as a list of text values.`);
    return [];
  }

  if (value.some((item) => typeof item !== "string")) {
    errors.push(`Enter ${key} as a list of text values.`);
  }

  return value
    .filter((item) => typeof item === "string")
    .map((item) => item.trim())
    .filter(Boolean);
}

function decodePathSegment(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return "";
  }
}

function absoluteEditUrl(request: Request, env: Env, editToken: string): string {
  const url = trustedSiteUrl(request, env, "/activate-ri-2026/access/");
  url.hash = editToken;
  return url.href;
}

function absoluteHelpUrl(request: Request, env: Env): string {
  return trustedSiteUrl(request, env, "/activate-ri-2026/help/").href;
}

function absoluteScheduleUrl(request: Request, env: Env): string {
  return trustedSiteUrl(request, env, "/activate-ri-2026/schedule/").href;
}

type EmailActivityResult =
  | {
      ok: true;
      status: "sent";
      attemptId: string;
      recipientsCount: number;
      recipients: string[];
      recipientHashes: string[];
    }
  | {
      ok: true;
      status: "skipped";
      attemptId: string;
      reason: string;
      recipientsCount: number;
      recipients: string[];
      recipientHashes: string[];
    }
  | {
      ok: false;
      status: "failed";
      attemptId: string;
      error: string;
      recipientsCount: number;
      recipients: string[];
      recipientHashes: string[];
    };

function adminNotificationAction(result: EmailActivityResult): string {
  if (result.status === "sent") {
    return "admin-notification-sent";
  }

  if (result.status === "skipped") {
    return "admin-notification-skipped";
  }

  return "admin-notification-failed";
}

function adminNotificationSummary(
  result: EmailActivityResult,
  reason: string,
): string {
  if (result.status === "sent") {
    return `Admin notification sent for ${reason}.`;
  }

  if (result.status === "skipped") {
    return `Admin notification skipped for ${reason}.`;
  }

  return `Admin notification failed for ${reason}.`;
}

function activatorNotificationAction(result: EmailActivityResult): string {
  if (result.status === "sent") {
    return "activator-notification-sent";
  }

  if (result.status === "skipped") {
    return "activator-notification-skipped";
  }

  return "activator-notification-failed";
}

function activatorNotificationSummary(
  result: EmailActivityResult,
  reason: string,
): string {
  if (result.status === "sent") {
    return `Activator notification sent for ${reason}.`;
  }

  if (result.status === "skipped") {
    return `Activator notification skipped for ${reason}.`;
  }

  return `Activator notification failed for ${reason}.`;
}

function emailActivityDetails(
  result: EmailActivityResult,
  options: { includeRecipients?: boolean } = {},
): Record<string, unknown> {
  return {
    emailAttemptId: result.attemptId,
    status: result.status,
    recipientsCount: result.recipientsCount,
    ...(options.includeRecipients
      ? { recipients: result.recipients }
      : { recipientHashes: result.recipientHashes }),
    ...(result.status === "skipped" ? { reason: result.reason } : {}),
    ...(result.status === "failed" ? { error: result.error } : {}),
  };
}
