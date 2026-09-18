import type { Env } from "./env";

export type WidgetAction = "load" | "refresh" | "click";
type WidgetAnalyticsEnv = Pick<Env, "DB" | "ANALYTICS" | "REMOTE_DATA_READ_ONLY">;

export async function recordWidgetRequest(
  env: WidgetAnalyticsEnv,
  embedder: string,
  action: WidgetAction,
  at: string,
): Promise<void> {
  try {
    const results = await env.DB.batch([
      env.DB.prepare(`INSERT INTO analytics_widget_daily
        (day, scope, embedder, action, count, first_seen_at, last_seen_at)
        VALUES (?, 'on-air', ?, ?, 1, ?, ?)
        ON CONFLICT(day, scope, embedder, action) DO UPDATE SET
          count = count + 1,
          first_seen_at = MIN(first_seen_at, excluded.first_seen_at),
          last_seen_at = MAX(last_seen_at, excluded.last_seen_at)`)
        .bind(at.slice(0, 10), embedder, action, at, at),
      env.DB.prepare(`INSERT INTO analytics_collection_metadata(scope, stream, started_at)
        VALUES ('on-air', 'widget_requests', ?) ON CONFLICT(scope, stream) DO UPDATE
        SET started_at = MIN(started_at, excluded.started_at)`).bind(at),
    ]);
    if (results.some(result => !result.success)) throw new Error("Widget storage failed");
  } catch {
    console.error(JSON.stringify({ event: "widget-analytics-storage-failed", scope: "on-air" }));
    return;
  }

  // Same dataset, distinct stream: index1 identifies an embedder URL, never a browser.
  try {
    env.ANALYTICS?.writeDataPoint({
      indexes: [`widget:on-air:${embedder}`],
      blobs: ["on-air", "widget_request", "widget", "on_air_widget", action, "", "", "", "", "", "1", embedder],
      doubles: [1],
    });
  } catch {
    console.error(JSON.stringify({ event: "widget-analytics-mirror-failed", scope: "on-air" }));
  }
}

export async function captureWidgetRequest(
  request: Request,
  env: WidgetAnalyticsEnv,
  ctx: ExecutionContext | undefined,
  embedder: string,
  action: WidgetAction,
  at: string,
): Promise<void> {
  if (env.REMOTE_DATA_READ_ONLY === "true" || request.headers.get("sec-gpc") === "1" || request.headers.get("dnt") === "1") return;
  console.log(JSON.stringify({ event: "on-air-widget", action, embedder }));
  const capture = recordWidgetRequest(env, embedder, action, at);
  if (ctx) ctx.waitUntil(capture);
  else await capture;
}
