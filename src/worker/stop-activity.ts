import { stopTimeRangeToInstants } from "../lib/activate-ri/time";
import type { ActivationStopActivity } from "../lib/activate-ri/types";
import type { EditablePlanDto } from "./db";
import type { Env } from "./env";
import { sanitizeLogText } from "./logging";

type ActivityStop = {
  id: string;
  parkReference: string;
  plannedDate: string;
  startTime: string;
  endTime: string;
  activatorCallsign: string;
  status: string;
};

type ActivityRow = {
  park_reference: string;
  activator_callsign: string;
  activity_date: string;
};

export async function enrichPlanStopActivity<T extends Pick<EditablePlanDto, "submitter_callsign" | "stops">>(
  env: Pick<Env, "DB" | "ACTIVATE_RI_EVENT_ID">,
  plans: T[],
): Promise<T[]> {
  const stops = await enrichStopActivity(env, plans.flatMap((plan) => plan.stops.map((stop) => ({
    id: stop.id,
    parkReference: stop.park_reference,
    plannedDate: stop.planned_date,
    startTime: stop.start_time,
    endTime: stop.end_time,
    activatorCallsign: plan.submitter_callsign,
    status: stop.status,
  }))));
  const activityByStop = new Map(stops.map((stop) => [stop.id, stop.activity]));
  return plans.map((plan) => ({
    ...plan,
    stops: plan.stops.map((stop) => {
      const activity = activityByStop.get(stop.id);
      return activity ? { ...stop, activity } : stop;
    }),
  }));
}

export async function enrichStopActivity<T extends ActivityStop>(
  env: Pick<Env, "DB" | "ACTIVATE_RI_EVENT_ID">,
  stops: T[],
): Promise<Array<T & { activity?: ActivationStopActivity }>> {
  const datesByStop = new Map(stops.map((stop) => [stop.id, stopUtcDates(stop)]));
  const dates = [...datesByStop.values()].flat().sort();
  if (dates.length === 0) return stops;

  try {
    const [confirmations, observations] = await Promise.all([
      env.DB.prepare(
        `SELECT park_reference, activator_callsign, qso_date AS activity_date
         FROM activate_ri_pota_activation_evidence
         WHERE event_id = ? AND qualifying = 1 AND qso_date BETWEEN ? AND ?`,
      ).bind(env.ACTIVATE_RI_EVENT_ID, dates[0].replaceAll("-", ""), dates.at(-1)!.replaceAll("-", ""))
        .all<ActivityRow>(),
      env.DB.prepare(
        `SELECT park_reference, activator_callsign, spot_date AS activity_date
         FROM activate_ri_pota_spot_observations
         WHERE event_id = ? AND spot_date BETWEEN ? AND ?`,
      ).bind(env.ACTIVATE_RI_EVENT_ID, dates[0], dates.at(-1)!)
        .all<ActivityRow>(),
    ]);
    const confirmed = evidenceKeys(confirmations.results ?? []);
    const spotted = evidenceKeys(observations.results ?? []);

    return stops.map((stop) => {
      const keys = (datesByStop.get(stop.id) ?? []).map((date) =>
        evidenceKey(stop.parkReference, stop.activatorCallsign, date),
      );
      const activity = keys.some((key) => confirmed.has(key))
        ? "confirmed"
        : keys.some((key) => spotted.has(key)) ? "spotted" : undefined;
      return activity ? { ...stop, activity } : stop;
    });
  } catch (error) {
    console.warn(JSON.stringify({
      event: "stop_activity_unavailable",
      error: sanitizeLogText(error instanceof Error ? error.message : "POTA activity lookup failed."),
    }));
    return stops;
  }
}

function stopUtcDates(stop: ActivityStop): string[] {
  if (stop.status === "cancelled") return [];
  // The plan stores the Rhode Island event date with UTC clock times.
  const { startAt, endAt } = stopTimeRangeToInstants(
    stop.plannedDate,
    stop.startTime,
    stop.endTime,
    { utcDateOffset: stop.startTime < "04:00" ? 1 : 0 },
  );
  const firstDate = startAt.slice(0, 10);
  const lastDate = new Date(Date.parse(endAt) - 1).toISOString().slice(0, 10);
  return firstDate === lastDate ? [firstDate] : [firstDate, lastDate];
}

function evidenceKeys(rows: ActivityRow[]): Set<string> {
  return new Set(rows.map((row) =>
    evidenceKey(row.park_reference, row.activator_callsign, row.activity_date),
  ));
}

function evidenceKey(reference: string, callsign: string, date: string): string {
  return `${reference?.trim().toUpperCase()}:${callsign?.trim().toUpperCase()}:${date?.replaceAll("-", "")}`;
}
