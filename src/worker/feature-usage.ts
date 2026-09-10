import type { Env } from "./env";
import { recordOperationalFailure } from "./operational-health";

export type AuthenticatedFeature =
  | "account_security"
  | "ops_room"
  | "plan_editor";

type FeatureUsage = {
  scope: string;
  subjectType: "activator" | "user";
  subjectId: string;
  feature: AuthenticatedFeature;
};

export async function recordFeatureUsage(
  env: Env,
  usage: FeatureUsage,
  now = new Date(),
): Promise<void> {
  const usedAt = now.toISOString();
  await env.DB.batch([env.DB.prepare(
    `INSERT INTO analytics_feature_usage (
       scope, subject_type, subject_id, feature,
       first_used_at, last_used_at, use_count
     ) VALUES (?, ?, ?, ?, ?, ?, 1)
     ON CONFLICT(scope, subject_type, subject_id, feature) DO UPDATE SET
       last_used_at = excluded.last_used_at,
       use_count = analytics_feature_usage.use_count + 1`,
  ).bind(
    usage.scope,
    usage.subjectType,
    usage.subjectId,
    usage.feature,
    usedAt,
    usedAt,
  ), env.DB.prepare(
    `INSERT INTO analytics_feature_events
       (id, scope, subject_type, subject_id, feature, occurred_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).bind(crypto.randomUUID(), usage.scope, usage.subjectType, usage.subjectId, usage.feature, usedAt),
  env.DB.prepare(`INSERT INTO analytics_collection_metadata (scope, stream, started_at)
    VALUES (?, 'authenticated_events', ?) ON CONFLICT(scope, stream) DO UPDATE SET
    started_at = MIN(started_at, excluded.started_at)`).bind(usage.scope, usedAt)]);
}

export async function captureFeatureUsage(
  env: Env,
  ctx: ExecutionContext | undefined,
  usage: FeatureUsage,
): Promise<void> {
  const capture = recordFeatureUsage(env, usage).catch(async () => {
    console.error(JSON.stringify({
      event: "analytics-feature-usage-failed",
      scope: usage.scope,
      feature: usage.feature,
    }));
    await recordOperationalFailure(env, "feature_analytics");
  });

  if (ctx) {
    ctx.waitUntil(capture);
    return;
  }
  await capture;
}
