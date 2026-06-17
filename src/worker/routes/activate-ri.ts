import {
  normalizeBandList,
  normalizeModeList,
  validatePlanSubmission,
} from "../../lib/activate-ri/validation";
import { planRowsToPublicStops } from "../../lib/activate-ri/public-export";
import { requireAccessIdentity } from "../access";
import {
  approvePlan,
  cancelPlanByTokenHash,
  cancelStopByToken,
  findActivatorForEditLinkResend,
  getPlanById,
  getPlanByTokenHash,
  getPlansByTokenHash,
  insertPendingPlan,
  listActivityEvents,
  listPendingPlans,
  listPublicStopRows,
  listSeenClubs,
  logActivityEvent,
  markEditLinkEmailEvent,
  updatePlanByTokenHash,
  updateStopByToken,
  type EditablePlanSubmission,
  type EditStopFields,
} from "../db";
import {
  sendActivatorApprovalEmail,
  sendActivatorEditLinkEmail,
  sendAdminActivityEmail,
  sendAdminPendingPlanEmail,
} from "../email";
import { tokenHash } from "../edit-token";
import type { Env } from "../env";
import { json, readJson } from "../http";
import { verifyTurnstile } from "../turnstile";

const submissionReceivedMessage =
  "Submission received for organizer review.";
const resendLinkMessage =
  "If we found a matching signup, we sent the private edit link.";
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

  if (
    request.method === "GET" &&
    url.pathname === "/api/activate-ri-2026/admin/plans"
  ) {
    const identity = await requireAccessIdentity(request, env);
    if (identity instanceof Response) {
      return identity;
    }

    return json({ ok: true, plans: await listPendingPlans(env) });
  }

  if (
    request.method === "GET" &&
    url.pathname === "/api/activate-ri-2026/admin/activity"
  ) {
    const identity = await requireAccessIdentity(request, env);
    if (identity instanceof Response) {
      return identity;
    }

    return json({ ok: true, events: await listActivityEvents(env) });
  }

  if (
    request.method === "POST" &&
    url.pathname === "/api/activate-ri-2026/admin/publish"
  ) {
    const identity = await requireAccessIdentity(request, env);
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
    url.pathname === "/api/activate-ri-2026/public/clubs"
  ) {
    return json(
      { ok: true, clubs: await listSeenClubs(env) },
      { headers: publicJsonCacheHeaders },
    );
  }

  const approveMatch = url.pathname.match(
    /^\/api\/activate-ri-2026\/admin\/plans\/([^/]+)\/approve$/,
  );
  if (request.method === "POST" && approveMatch) {
    const identity = await requireAccessIdentity(request, env);
    if (identity instanceof Response) {
      return identity;
    }

    const result = await approvePlan(env, approveMatch[1], identity.email);
    if (!result.ok) {
      return json(
        { ok: false, error: result.error },
        { status: result.status },
      );
    }

    const plan = await getPlanById(env, approveMatch[1]);
    if (plan) {
      const emailResult = await sendActivatorApprovalEmail(
        env,
        plan,
        absoluteHelpUrl(request),
        absoluteScheduleUrl(request),
      );
      await logActivityEvent(env, {
        planId: plan.id,
        actorType: "system",
        actorEmail: plan.submitter_email,
        action: emailResult.status === "sent"
          ? "approval-email-sent"
          : emailResult.status === "skipped"
            ? "approval-email-skipped"
            : "approval-email-failed",
        summary: emailResult.status === "sent"
          ? `Approval email sent to ${plan.submitter_email}.`
          : emailResult.status === "skipped"
            ? `Approval email skipped for ${plan.submitter_email}.`
            : `Approval email failed for ${plan.submitter_email}.`,
        details: emailActivityDetails(emailResult),
      });
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

  return json({ ok: false, error: "Not found" }, { status: 404 });
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
      details: emailActivityDetails(emailResult),
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

  const result = await insertPendingPlan(env, validation.value);
  const editUrl = absoluteEditUrl(request, result.editToken);
  const emailResult = await sendActivatorEditLinkEmail(
    env,
    {
      submitter_callsign: validation.value.submitterCallsign,
      submitter_name: validation.value.submitterName,
      submitter_email: validation.value.submitterEmail,
    },
    editUrl,
    absoluteHelpUrl(request),
  );
  if (emailResult.status === "sent") {
    await markEditLinkEmailEvent(
      env,
      result.planId,
      result.activatorId,
      validation.value.submitterEmail,
      "edit-link-sent",
      `Private edit link sent to ${validation.value.submitterEmail}.`,
    );
  } else {
    await markEditLinkEmailEvent(
      env,
      result.planId,
      result.activatorId,
      validation.value.submitterEmail,
      emailResult.status === "skipped"
        ? "edit-link-send-skipped"
        : "edit-link-send-failed",
      emailResult.status === "skipped"
        ? `Private edit link email skipped for ${validation.value.submitterEmail}.`
        : `Private edit link email failed for ${validation.value.submitterEmail}.`,
      emailActivityDetails(emailResult),
    );
  }

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
    details: emailActivityDetails(adminEmailResult),
  });

  return json(
    {
      ok: true,
      message: submissionReceivedMessage,
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

  if (updateResult.highImpactEvents.length > 0) {
    const plan = await getPlanByTokenHash(env, editTokenHash, planId);
    if (plan) {
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
        details: emailActivityDetails(emailResult),
      });
    }
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
  );
  if (!match) {
    return json({ ok: true, message: resendLinkMessage });
  }

  const emailResult = await sendActivatorEditLinkEmail(
    env,
    match.plan ?? {
      submitter_callsign: match.activator.primary_callsign,
      submitter_name: match.activator.name,
      submitter_email: match.activator.email_normalized,
    },
    absoluteEditUrl(request, match.editToken),
    absoluteHelpUrl(request),
  );
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

  const result = await cancelPlanByTokenHash(
    env,
    await tokenHash(token),
    planId,
    validation.cancelReason,
  );
  if (!result.ok) {
    return json(
      { ok: false, error: result.error },
      { status: result.status },
    );
  }

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
      details: emailActivityDetails(emailResult),
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

function absoluteEditUrl(request: Request, editToken: string): string {
  return new URL(
    `/activate-ri-2026/edit/${encodeURIComponent(editToken)}/`,
    request.url,
  ).href;
}

function absoluteHelpUrl(request: Request): string {
  return new URL("/activate-ri-2026/help/", request.url).href;
}

function absoluteScheduleUrl(request: Request): string {
  return new URL("/activate-ri-2026/schedule/", request.url).href;
}

type EmailActivityResult =
  | {
      ok: true;
      status: "sent";
      attemptId: string;
      recipientsCount: number;
      recipientHashes: string[];
    }
  | {
      ok: true;
      status: "skipped";
      attemptId: string;
      reason: string;
      recipientsCount: number;
      recipientHashes: string[];
    }
  | {
      ok: false;
      status: "failed";
      attemptId: string;
      error: string;
      recipientsCount: number;
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

function emailActivityDetails(
  result: EmailActivityResult,
): Record<string, unknown> {
  return {
    emailAttemptId: result.attemptId,
    status: result.status,
    recipientsCount: result.recipientsCount,
    recipientHashes: result.recipientHashes,
    ...(result.status === "skipped" ? { reason: result.reason } : {}),
    ...(result.status === "failed" ? { error: result.error } : {}),
  };
}
