import { validateRouteSubmission } from "../../lib/activate-ri/validation";
import { requireAccessIdentity } from "../access";
import {
  approveRoute,
  cancelStopByToken,
  insertPendingRoute,
  listPendingRoutes,
  updateStopByToken,
  type EditStopFields,
} from "../db";
import { tokenHash } from "../edit-token";
import type { Env } from "../env";
import { json, readJson } from "../http";
import { verifyTurnstile } from "../turnstile";

const submissionReceivedMessage =
  "Submission received for organizer review.";

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

    return json({
      ok: true,
      editUrl: `/activate-ri-2026/edit/${encodeURIComponent(result.editToken)}/`,
    });
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

  const turnstileToken = isObject(payload) ? payload.turnstileToken : undefined;
  const turnstileValid = await verifyTurnstile(request, env, turnstileToken);
  if (!turnstileValid) {
    return json(
      { ok: false, errors: ["Turnstile verification failed."] },
      { status: 400 },
    );
  }

  const validation = validateRouteSubmission(payload);
  if (!validation.ok) {
    return json({ ok: false, errors: validation.errors }, { status: 400 });
  }

  await insertPendingRoute(env, validation.value);

  return json(
    {
      ok: true,
      message: submissionReceivedMessage,
    },
    { status: 202 },
  );
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
  const startTime = stringField(payload, "startTime", errors);
  const endTime = stringField(payload, "endTime", errors);
  const publicNotes = stringField(payload, "publicNotes", errors);
  const bands = stringArrayField(payload, "bands", errors);
  const modes = stringArrayField(payload, "modes", errors);

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

function stringArrayField(
  payload: Record<string, unknown>,
  key: string,
  errors: string[],
): string[] {
  const value = payload[key];
  if (
    !Array.isArray(value) ||
    value.some((item) => typeof item !== "string")
  ) {
    errors.push(`Enter ${key} as a list of text values.`);
    return [];
  }

  return value;
}

function decodePathSegment(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return "";
  }
}
