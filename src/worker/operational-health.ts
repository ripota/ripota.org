import type { Env } from "./env";

export const operationalFailureCategories = [
  "browser_error", "browser_resource", "browser_unhandledrejection",
  "worker_exception", "worker_response_5xx", "scheduled_pota",
  "scheduled_archive", "scheduled_spot_cleanup", "auth_cleanup",
  "ops_email_delivery", "ops_email_drain", "legacy_auth_upgrade", "feature_analytics",
] as const;
export type OperationalFailureCategory = typeof operationalFailureCategories[number];

/** Count observed incidents, not affected users. Failure reporting cannot fail a feature. */
export async function recordOperationalFailure(
  env: Pick<Env, "DB">,
  category: OperationalFailureCategory,
  now = new Date(),
): Promise<void> {
  if (!(operationalFailureCategories as readonly string[]).includes(category)) return;
  try {
    const timestamp = now.toISOString();
    await env.DB.prepare(
      `INSERT INTO operational_health_daily (scope, day, category, count, first_seen_at, last_seen_at)
       VALUES ('activate-ri-2026', ?, ?, 1, ?, ?)
       ON CONFLICT(scope, day, category) DO UPDATE SET count = count + 1,
         first_seen_at = MIN(first_seen_at, excluded.first_seen_at),
         last_seen_at = MAX(last_seen_at, excluded.last_seen_at)`,
    ).bind(timestamp.slice(0, 10), category, timestamp, timestamp).run();
  } catch { /* The original error/response remains authoritative if D1 is unavailable. */ }
}

/** Expected authentication/validation responses and deliberate 503 availability states are excluded. */
export async function observeWorkerRequest(
  env: Pick<Env, "DB">,
  operation: () => Promise<Response>,
): Promise<Response> {
  try {
    const response = await operation();
    if ([500, 502, 504].includes(response.status)) {
      await recordOperationalFailure(env, "worker_response_5xx");
    }
    return response;
  } catch (error) {
    if (!(error instanceof Response) || [500, 502, 504].includes(error.status)) {
      await recordOperationalFailure(env, "worker_exception");
    }
    throw error;
  }
}

export async function observeWorkerTask<T>(
  env: Pick<Env, "DB">,
  category: OperationalFailureCategory,
  operation: Promise<T>,
): Promise<T> {
  try { return await operation; } catch (error) {
    await recordOperationalFailure(env, category);
    throw error;
  }
}
