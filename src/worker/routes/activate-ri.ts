import { validateRouteSubmission } from "../../lib/activate-ri/validation";
import { requireAccessIdentity } from "../access";
import { approveRoute, insertPendingRoute, listPendingRoutes } from "../db";
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
    const identity = requireAccessIdentity(request);
    if (identity instanceof Response) {
      return identity;
    }

    return json({ ok: true, routes: await listPendingRoutes(env) });
  }

  const approveMatch = url.pathname.match(
    /^\/api\/activate-ri-2026\/admin\/routes\/([^/]+)\/approve$/,
  );
  if (request.method === "POST" && approveMatch) {
    const identity = requireAccessIdentity(request);
    if (identity instanceof Response) {
      return identity;
    }

    await approveRoute(env, approveMatch[1], identity.email);
    return json({ ok: true });
  }

  if (
    request.method === "POST" &&
    url.pathname === "/api/activate-ri-2026/routes"
  ) {
    return handleRouteSubmission(request, env);
  }

  return json({ ok: false, error: "Not found" }, { status: 404 });
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
