import { validateOpsRoomMode } from "../../lib/activate-ri/ops-validation";
import { requireAccessIdentity } from "../access";
import type { Env } from "../env";
import { json, readJson } from "../http";
import { getOpsAdminState, updateOpsRoomMode } from "../ops-db";
import { hasTrustedOrigin } from "../origin";
import { withPrivateHeaders } from "../private-response";

export async function handleActivateRiAdminOpsApi(
  request: Request,
  env: Env,
): Promise<Response> {
  const identity = await requireAccessIdentity(request, env);
  if (identity instanceof Response) {
    return withPrivateHeaders(identity);
  }

  const url = new URL(request.url);
  if (request.method === "GET" && url.pathname === "/api/activate-ri-2026/admin/ops") {
    return privateJson({ ok: true, ...(await getOpsAdminState(env)) });
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
    const event = await updateOpsRoomMode(env, validation.value, identity.email);
    return privateJson({
      ok: true,
      event,
      hardDisabled: env.ACTIVATE_RI_OPS_HARD_DISABLED === "true",
    });
  }

  return privateJson({ ok: false, error: "Not found" }, { status: 404 });
}

function privateJson(data: unknown, init: ResponseInit = {}): Response {
  return withPrivateHeaders(json(data, init));
}
