import { isSpotCaptureTime } from "../lib/activate-ri/pota-event";
import type { Env } from "./env";
import { logWorkerError } from "./logging";
import { persistEventSpotObservations, runPotaHistoryReconciliation } from "./pota-event";
import { persistPotaSpotHistory } from "./pota-spot-history";
import { syncPotaSpotHistories } from "./pota-spot-history-sync";
import { getRiPotaSpotsSnapshot } from "./routes/pota";

export async function runPotaCollection(
  controller: ScheduledController,
  env: Env,
  options: { now?: () => Date } = {},
): Promise<void> {
  const now = options.now ?? (() => new Date());
  const id = crypto.randomUUID();
  await env.DB.prepare(
    `INSERT INTO activate_ri_pota_collection_runs
      (id, event_id, scheduled_at, started_at, status) VALUES (?, ?, ?, ?, 'running')`,
  ).bind(id, env.ACTIVATE_RI_EVENT_ID, controller.scheduledTime, now().valueOf()).run();

  let sourceFetchedAt: number | null = null;
  let stale: number | null = null;
  let liveReportCount: number | null = null;
  let history = { attempted: 0, succeeded: 0, failed: 0, observations: 0 };
  let reconciliation = { attempted: 0, succeeded: 0, failed: 0 };
  const errors: string[] = [];
  try {
    const spots = await getRiPotaSpotsSnapshot(env, { now, collectionRunId: id });
    if (!spots.ok) {
      errors.push("live_unavailable");
    } else {
      sourceFetchedAt = spots.fetchedAt;
      stale = spots.snapshot.stale ? 1 : 0;
      liveReportCount = spots.snapshot.spots.length;
      if (stale) errors.push("live_stale");
      // Source fetch time and actual observation time are separate from cron's
      // scheduled time, including after a delayed invocation or a slow fetch.
      const observedAt = new Date(spots.observedAt);
      await persistPotaSpotHistory(env, spots.snapshot.spots, observedAt);
      if (isSpotCaptureTime(observedAt)) {
        await persistEventSpotObservations(env, spots.snapshot.spots, observedAt);
      }
      history = await syncPotaSpotHistories(env, spots.snapshot.spots, { now, collectionRunId: id });
      if (history.failed) errors.push("spot_history_failed");
    }
  } catch (error) {
    errors.push("spot_collection_failed");
    logWorkerError("pota-spot-collection-failed", error, { collectionRunId: id });
  }
  // Keep log reconciliation independent of a failure in live-spot collection.
  try {
    reconciliation = await runPotaHistoryReconciliation(env, { now });
    if (reconciliation.failed) errors.push("activation_history_failed");
  } catch (error) {
    errors.push("activation_collection_failed");
    logWorkerError("pota-activation-collection-failed", error, { collectionRunId: id });
  }
  const status = errors.length === 0 ? "success"
    : liveReportCount !== null || history.succeeded > 0 || reconciliation.succeeded > 0 ? "partial" : "failed";
  await env.DB.prepare(
    `UPDATE activate_ri_pota_collection_runs SET finished_at = ?, status = ?,
      source_fetched_at = ?, stale = ?, live_report_count = ?,
      history_attempted = ?, history_succeeded = ?, history_failed = ?, history_report_count = ?,
      reconciliation_attempted = ?, reconciliation_succeeded = ?, reconciliation_failed = ?, error_category = ?
     WHERE id = ?`,
  ).bind(now().valueOf(), status, sourceFetchedAt, stale, liveReportCount,
    history.attempted, history.succeeded, history.failed, history.observations,
    reconciliation.attempted, reconciliation.succeeded, reconciliation.failed,
    errors.length ? errors.join(",") : null, id).run();
  console.log(JSON.stringify({
    event: "activate-ri-pota-scheduled", collectionRunId: id,
    scheduledAt: new Date(controller.scheduledTime).toISOString(), status,
    sourceFetchedAt, stale, liveReportCount, spotHistory: history, history: reconciliation,
    errors,
  }));
}
