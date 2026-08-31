import type { Env } from "./env";

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
  await env.DB.prepare(
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
  ).run();
}

export async function captureFeatureUsage(
  env: Env,
  ctx: ExecutionContext | undefined,
  usage: FeatureUsage,
): Promise<void> {
  const capture = recordFeatureUsage(env, usage).catch(() => {
    console.error(JSON.stringify({
      event: "analytics-feature-usage-failed",
      scope: usage.scope,
      feature: usage.feature,
    }));
  });

  if (ctx) {
    ctx.waitUntil(capture);
    return;
  }
  await capture;
}
