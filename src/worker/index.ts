import type { Env } from "./env";
import {
  activatorSessionCookie,
  createActivatorSession,
} from "./activator-session";
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
import { handleAuthApi } from "./routes/auth";
import { requireActivator, requireAdmin } from "./auth/authorization";
import { getAuthConfig } from "./auth/config";
import { createUnifiedActivatorSession } from "./auth/legacy";
import { cleanupAuthData } from "./auth/cleanup";
import { requireAccessIdentity } from "./access";
import { handleClientErrorReport } from "./routes/client-errors";
import { logWorkerError } from "./logging";
import { handleAnalyticsEvent } from "./routes/analytics";
import { captureFeatureUsage, type AuthenticatedFeature } from "./feature-usage";
import {
  cleanupPotaSpotHistory,
  persistPotaSpotHistory,
} from "./pota-spot-history";

export { ActivateRiOpsRoom };

const activateRiAdminPathPattern = /^\/activate-ri-2026\/admin\/?$/;
const activateRiAdminRecoveryPathPattern = /^\/activate-ri-2026\/admin\/recovery\/?$/;
const activateRiEditPathPattern = /^\/activate-ri-2026\/edit\/([^/]+)\/?$/;
const activateRiAccessPathPattern = /^\/activate-ri-2026\/access\/?$/;
const activateRiPortalPathPattern = /^\/activate-ri-2026\/activator(?:\/(?:plan|account))?\/?$/;
const accountPathPattern = /^\/account\/(?:sign-in|access|security)\/?$/;
const potaSpotCleanupCron = "17 5 * * *";

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

    if (url.pathname === "/api/client-errors") {
      return handleClientErrorReport(request, env);
    }

    if (
      url.pathname.startsWith("/api/auth/") ||
      url.pathname === "/api/activate-ri-2026/admin/auth/access-bootstrap/start"
    ) {
      return handleAuthApi(request, env);
    }

    if (url.pathname === "/api/analytics/events") {
      return handleAnalyticsEvent(request, env);
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
      accountPathPattern.test(url.pathname)
    ) {
      return withPrivateHeaders(await env.ASSETS.fetch(request), "editor");
    }

    if (
      (request.method === "GET" || request.method === "HEAD") &&
      activateRiAdminRecoveryPathPattern.test(url.pathname)
    ) {
      const identity = await requireAccessIdentity(request, env);
      if (identity instanceof Response) return identity;
      return withPrivateHeaders(await env.ASSETS.fetch(request), "editor");
    }

    if (
      (request.method === "GET" || request.method === "HEAD") &&
      activateRiAdminPathPattern.test(url.pathname)
    ) {
      const identity = await requireAdmin(request, env, { navigation: true });
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
        "/activate-ri-2026/activator/plan/",
      ).href;
      const headers = new Headers({ location });
      headers.append("set-cookie", activatorSessionCookie(session.sessionToken));
      if (getAuthConfig(env, request).activatorMode !== "legacy") {
        try {
          const unified = await createUnifiedActivatorSession(env, session.identity, "legacy-link");
          headers.append("set-cookie", unified.cookie);
        } catch (error) {
          logWorkerError("legacy-edit-route-unified-upgrade-failed", error);
        }
      }
      return withPrivateHeaders(
        new Response(null, {
          status: 303,
          headers,
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
      const identity = await requireActivator(request, env);
      if (identity instanceof Response) {
        const accessPath = getAuthConfig(env, request).activatorMode === "legacy"
          ? "/activate-ri-2026/access/"
          : "/account/sign-in/?returnTo=%2Factivate-ri-2026%2Factivator%2F";
        return withPrivateHeaders(
          new Response(null, {
            status: 303,
            headers: {
              location: trustedSiteUrl(
                request,
                env,
                accessPath,
              ).href,
            },
          }),
          url.pathname.endsWith("/plan/") || url.pathname.endsWith("/account/") ? "editor" : "portal",
        );
      }

      const feature = authenticatedPortalFeature(url.pathname);
      if (feature) {
        await captureFeatureUsage(env, ctx, {
          scope: env.ACTIVATE_RI_EVENT_ID,
          subjectType: "activator",
          subjectId: identity.activatorId,
          feature,
        });
      }

      return withPrivateHeaders(
        await fetchAssetWithoutRedirect(env, request),
        url.pathname.endsWith("/plan/") || url.pathname.endsWith("/account/") ? "editor" : "portal",
      );
    }

    return env.ASSETS.fetch(request);
  },

  scheduled(
    controller: ScheduledController,
    env: Env,
    ctx: ExecutionContext,
  ): void {
    if (controller.cron === potaSpotCleanupCron) {
      ctx.waitUntil(runPotaSpotCleanupSchedule(controller, env));
      return;
    }
    ctx.waitUntil(runActivateRiPotaSchedule(controller, env));
    ctx.waitUntil(cleanupAuthData(env).then((result) => {
      console.log(JSON.stringify({ event: "auth-cleanup", ...result }));
    }).catch((error) => {
      logWorkerError("auth-cleanup-failed", error, { category: "database" });
    }));
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
  const spots = await getRiPotaSpotsSnapshot(env, { now: () => now });
  outcome.spotsAvailable = spots.ok;
  if (spots.ok) {
    outcome.rollingObservations = await persistPotaSpotHistory(
      env,
      spots.snapshot.spots,
      now,
    );
    if (isSpotCaptureTime(now)) {
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

export async function runPotaSpotCleanupSchedule(
  controller: ScheduledController,
  env: Env,
): Promise<void> {
  const now = new Date(controller.scheduledTime);
  const result = await cleanupPotaSpotHistory(env, now);
  console.log(JSON.stringify({
    event: "pota-spot-history-cleanup",
    scheduledAt: now.toISOString(),
    ...result,
  }));
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

function authenticatedPortalFeature(pathname: string): AuthenticatedFeature | null {
  if (pathname.endsWith("/plan") || pathname.endsWith("/plan/")) {
    return "plan_editor";
  }
  if (pathname.endsWith("/account") || pathname.endsWith("/account/")) {
    return "account_security";
  }
  return null;
}
