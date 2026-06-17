import { validateRouteSubmission } from "../../lib/activate-ri/validation";
import { routeRowsToPublicStops } from "../../lib/activate-ri/public-export";
import { requireAccessIdentity } from "../access";
import {
  approveRoute,
  cancelRouteByTokenHash,
  cancelStopByToken,
  findRouteForEditLinkResend,
  getRouteByTokenHash,
  insertPendingRoute,
  listActivityEvents,
  listPendingRoutes,
  listPublicStopRows,
  logActivityEvent,
  markEditLinkEmailEvent,
  updateRouteByTokenHash,
  updateStopByToken,
  type EditableRouteSubmission,
  type EditStopFields,
} from "../db";
import { sendActivatorEditLinkEmail, sendAdminActivityEmail } from "../email";
import { tokenHash } from "../edit-token";
import type { Env } from "../env";
import { json, readJson } from "../http";
import { verifyTurnstile } from "../turnstile";

const submissionReceivedMessage =
  "Submission received for organizer review.";
const resendLinkMessage =
  "If we found a matching signup, we sent the private edit link.";
const timePattern = /^([01]\d|2[0-3]):[0-5]\d$/;

export async function handleActivateRiApi(
  request: Request,
  env: Env,
): Promise<Response> {
  const url = new URL(request.url);

  if (
    request.method === "GET" &&
    url.pathname === "/api/activate-ri-2026/admin/routes"
  ) {
    const identity = await requireAccessIdentity(request, env);
    if (identity instanceof Response) {
      return identity;
    }

    return json({ ok: true, routes: await listPendingRoutes(env) });
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
    return json({
      ok: true,
      stops: routeRowsToPublicStops(await listPublicStopRows(env)),
      generatedAt: new Date().toISOString(),
    });
  }

  const approveMatch = url.pathname.match(
    /^\/api\/activate-ri-2026\/admin\/routes\/([^/]+)\/approve$/,
  );
  if (request.method === "POST" && approveMatch) {
    const identity = await requireAccessIdentity(request, env);
    if (identity instanceof Response) {
      return identity;
    }

    const result = await approveRoute(env, approveMatch[1], identity.email);
    if (!result.ok) {
      return json(
        { ok: false, error: result.error },
        { status: result.status },
      );
    }

    return json({ ok: true });
  }

  const editRouteMatch = url.pathname.match(
    /^\/api\/activate-ri-2026\/edit\/([^/]+)\/route$/,
  );
  if (request.method === "GET" && editRouteMatch) {
    return handleEditRouteLookup(env, editRouteMatch[1]);
  }
  if (request.method === "PATCH" && editRouteMatch) {
    return handleEditRouteUpdate(request, env, editRouteMatch[1]);
  }

  const cancelRouteMatch = url.pathname.match(
    /^\/api\/activate-ri-2026\/edit\/([^/]+)\/route\/cancel$/,
  );
  if (request.method === "POST" && cancelRouteMatch) {
    return handleCancelRoute(request, env, cancelRouteMatch[1]);
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
    url.pathname === "/api/activate-ri-2026/routes"
  ) {
    return handleRouteSubmission(request, env);
  }

  if (
    request.method === "POST" &&
    url.pathname === "/api/activate-ri-2026/resend-edit-link"
  ) {
    return handleResendEditLink(request, env);
  }

  return json({ ok: false, error: "Not found" }, { status: 404 });
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

  return json({ ok: true });
}

async function handleRouteSubmission(
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

  const validation = validateRouteSubmission(payload);
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

  const result = await insertPendingRoute(env, validation.value);
  const editUrl = absoluteEditUrl(request, result.editToken);
  const emailResult = await sendActivatorEditLinkEmail(
    env,
    {
      submitter_callsign: validation.value.submitterCallsign,
      submitter_name: validation.value.submitterName,
      submitter_email: validation.value.submitterEmail,
    },
    editUrl,
  );
  if (emailResult.ok) {
    await markEditLinkEmailEvent(
      env,
      result.routeId,
      validation.value.submitterEmail,
      "edit-link-sent",
      `Private edit link sent to ${validation.value.submitterEmail}.`,
    );
  } else {
    await markEditLinkEmailEvent(
      env,
      result.routeId,
      validation.value.submitterEmail,
      "edit-link-send-failed",
      `Private edit link email failed for ${validation.value.submitterEmail}.`,
      { error: emailResult.error },
    );
  }

  return json(
    {
      ok: true,
      message: submissionReceivedMessage,
    },
    { status: 202 },
  );
}

async function handleEditRouteLookup(
  env: Env,
  encodedToken: string,
): Promise<Response> {
  const token = decodePathSegment(encodedToken);
  if (!token) {
    return json({ ok: false, error: "Route not found" }, { status: 404 });
  }

  const route = await getRouteByTokenHash(env, await tokenHash(token));
  if (!route) {
    return json({ ok: false, error: "Route not found" }, { status: 404 });
  }

  return json({ ok: true, route });
}

async function handleEditRouteUpdate(
  request: Request,
  env: Env,
  encodedToken: string,
): Promise<Response> {
  const token = decodePathSegment(encodedToken);
  if (!token) {
    return json({ ok: false, error: "Route not found" }, { status: 404 });
  }

  const payloadResult = await readRequiredPayload(request);
  if (!payloadResult.ok) {
    return json(
      { ok: false, errors: [payloadResult.error] },
      { status: payloadResult.status },
    );
  }

  const validation = validateEditableRoutePayload(payloadResult.value);
  if (!validation.ok) {
    return json({ ok: false, errors: validation.errors }, { status: 400 });
  }

  const editTokenHash = await tokenHash(token);
  const updateResult = await updateRouteByTokenHash(
    env,
    editTokenHash,
    validation.value,
  );
  if (!updateResult.ok) {
    return json(
      { ok: false, error: updateResult.error },
      { status: updateResult.status },
    );
  }

  if (updateResult.highImpactEvents.length > 0) {
    const route = await getRouteByTokenHash(env, editTokenHash);
    if (route) {
      const emailResult = await sendAdminActivityEmail(
        env,
        route,
        updateResult.highImpactEvents,
      );
      await logActivityEvent(env, {
        routeId: route.id,
        actorType: "system",
        action: emailResult.ok
          ? "admin-notification-sent"
          : "admin-notification-failed",
        summary: emailResult.ok
          ? "Admin notification sent for high-impact edit."
          : "Admin notification failed for high-impact edit.",
        details: emailResult.ok ? {} : { error: emailResult.error },
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

  const match = await findRouteForEditLinkResend(
    env,
    validation.callsign,
    validation.email,
  );
  if (!match) {
    return json({ ok: true, message: resendLinkMessage });
  }

  const emailResult = await sendActivatorEditLinkEmail(
    env,
    match.route,
    absoluteEditUrl(request, match.editToken),
  );
  await markEditLinkEmailEvent(
    env,
    match.route.id,
    validation.email,
    emailResult.ok ? "edit-link-resent" : "edit-link-send-failed",
    emailResult.ok
      ? `Private edit link resent to ${validation.email}.`
      : `Private edit link resend failed for ${validation.email}.`,
    emailResult.ok ? {} : { error: emailResult.error },
  );

  return json({ ok: true, message: resendLinkMessage });
}

async function handleCancelRoute(
  request: Request,
  env: Env,
  encodedToken: string,
): Promise<Response> {
  const token = decodePathSegment(encodedToken);
  if (!token) {
    return json({ ok: false, error: "Route not found" }, { status: 404 });
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

  const result = await cancelRouteByTokenHash(
    env,
    await tokenHash(token),
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
      result.route,
      result.highImpactEvents,
    );
    await logActivityEvent(env, {
      routeId: result.route.id,
      actorType: "system",
      action: emailResult.ok
        ? "admin-notification-sent"
        : "admin-notification-failed",
      summary: emailResult.ok
        ? "Admin notification sent for route cancellation."
        : "Admin notification failed for route cancellation.",
      details: emailResult.ok ? {} : { error: emailResult.error },
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

type EditableRouteValidation =
  | { ok: true; value: EditableRouteSubmission }
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
  const bands = cleanStringArrayField(payload, "bands", errors);
  const modes = cleanStringArrayField(payload, "modes", errors).map((mode) =>
    mode.toUpperCase(),
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

function validateEditableRoutePayload(payload: unknown): EditableRouteValidation {
  const validation = validateRouteSubmission(payload);
  if (!validation.ok) {
    return validation;
  }

  if (!isObject(payload) || !Array.isArray(payload.stops)) {
    return { ok: false, errors: ["Enter a valid route submission."] };
  }

  return {
    ok: true,
    value: {
      ...validation.value,
      stops: validation.value.stops.map((stop, index) => {
        const inputStop = payload.stops[index];
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
