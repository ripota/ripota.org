import type { Env } from "./env";
import {
  activatorSessionCookie,
  createActivatorSession,
  getActivatorSession,
} from "./activator-session";
import { requireAccessIdentity } from "./access";
import { trustedSiteUrl } from "./origin";
import { withPrivateHeaders } from "./private-response";
import { json } from "./http";
import { handleActivateRiApi } from "./routes/activate-ri";
import {
  handleActivateRiEmbed,
  isActivateRiEmbedPath,
} from "./routes/activate-ri-embed";
import { handlePotaSpots } from "./routes/pota";
import { ActivateRiOpsRoom } from "./durable-objects/activate-ri-ops-room";
import {
  isHistoryReconciliationTime,
  isSpotCaptureTime,
} from "../lib/activate-ri/pota-event";
import {
  persistEventSpotObservations,
  runPotaHistoryReconciliation,
} from "./pota-event";
import { getRiPotaSpotsSnapshot } from "./routes/pota";

export { ActivateRiOpsRoom };

const activateRiAdminPathPattern = /^\/activate-ri-2026\/admin\/?$/;
const activateRiEditPathPattern = /^\/activate-ri-2026\/edit\/([^/]+)\/?$/;
const activateRiAccessPathPattern = /^\/activate-ri-2026\/access\/?$/;
const activateRiPortalPathPattern = /^\/activate-ri-2026\/activators(?:\/plan)?\/?$/;

export default {
  async fetch(
    request: Request,
    env: Env,
    ctx?: ExecutionContext,
  ): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/api/activate-ri-2026/health") {
      return json({ ok: true, eventId: env.ACTIVATE_RI_EVENT_ID });
    }

    if (url.pathname.startsWith("/api/activate-ri-2026/")) {
      return handleActivateRiApi(request, env, ctx);
    }

    if (
      request.method === "GET" &&
      url.pathname === "/api/pota/spots"
    ) {
      return handlePotaSpots(request, env, ctx);
    }

    if (url.pathname.startsWith("/api/")) {
      return json({ ok: false, error: "Not found" }, { status: 404 });
    }

    if (isActivateRiEmbedPath(url.pathname)) {
      return handleActivateRiEmbed(request, env);
    }

    if (
      (request.method === "GET" || request.method === "HEAD") &&
      activateRiAdminPathPattern.test(url.pathname)
    ) {
      const identity = await requireAccessIdentity(request, env);
      if (identity instanceof Response) {
        return identity;
      }

      return withPrivateHeaders(await env.ASSETS.fetch(request));
    }

    if (
      request.method === "GET" &&
      activateRiEditPathPattern.test(url.pathname)
    ) {
      const match = url.pathname.match(activateRiEditPathPattern);
      const token = match ? decodePathSegment(match[1]) : "";
      const session = token ? await createActivatorSession(env, token) : null;
      if (!session) {
        return withPrivateHeaders(
          new Response("Private access link not found.", { status: 404 }),
          "editor",
        );
      }

      const location = trustedSiteUrl(
        request,
        env,
        "/activate-ri-2026/activators/plan/",
      ).href;
      return withPrivateHeaders(
        new Response(null, {
          status: 303,
          headers: {
            location,
            "set-cookie": activatorSessionCookie(session.sessionToken),
          },
        }),
        "editor",
      );
    }

    if (
      (request.method === "GET" || request.method === "HEAD") &&
      activateRiAccessPathPattern.test(url.pathname)
    ) {
      return withPrivateHeaders(await env.ASSETS.fetch(request));
    }

    if (
      (request.method === "GET" || request.method === "HEAD") &&
      activateRiPortalPathPattern.test(url.pathname)
    ) {
      const identity = await getActivatorSession(request, env);
      if (!identity) {
        return withPrivateHeaders(
          new Response(null, {
            status: 303,
            headers: {
              location: trustedSiteUrl(
                request,
                env,
                "/activate-ri-2026/access/",
              ).href,
            },
          }),
          url.pathname.endsWith("/plan/") ? "editor" : "portal",
        );
      }

      return withPrivateHeaders(
        await fetchAssetWithoutRedirect(env, request),
        url.pathname.endsWith("/plan/") ? "editor" : "portal",
      );
    }

    return env.ASSETS.fetch(request);
  },

  scheduled(
    controller: ScheduledController,
    env: Env,
    ctx: ExecutionContext,
  ): void {
    ctx.waitUntil(runActivateRiPotaSchedule(controller, env));
  },
};

export async function runActivateRiPotaSchedule(
  controller: ScheduledController,
  env: Env,
): Promise<void> {
  const now = new Date(controller.scheduledTime);
  const outcome: Record<string, unknown> = {
    event: "activate-ri-pota-scheduled",
    scheduledAt: now.toISOString(),
  };
  if (isSpotCaptureTime(now)) {
    const spots = await getRiPotaSpotsSnapshot(env, { now: () => now });
    outcome.spotsAvailable = spots.ok;
    if (spots.ok) {
      outcome.observations = await persistEventSpotObservations(
        env,
        spots.snapshot.spots,
        now,
      );
    }
  }
  if (isHistoryReconciliationTime(now)) {
    outcome.history = await runPotaHistoryReconciliation(env, { now: () => now });
  }
  console.log(JSON.stringify(outcome));
}

async function fetchAssetWithoutRedirect(
  env: Env,
  request: Request,
): Promise<Response> {
  const response = await env.ASSETS.fetch(request);
  if (response.status < 300 || response.status >= 400) {
    return response;
  }

  const location = response.headers.get("location");
  if (!location) {
    return response;
  }

  const redirectedUrl = new URL(location, request.url);
  return env.ASSETS.fetch(new Request(redirectedUrl, request));
}

function decodePathSegment(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return "";
  }
}
