import parks from "../../public/data/activate-ri-2026/parks.json";
import {
  eventReplayMaximumEventsPerPark,
  eventReplayWindow,
  type EventReplay,
} from "../lib/activate-ri/event-replay";
import type { Env } from "./env";
import { json } from "./http";
import { logWorkerError } from "./logging";

type ReplayRow = {
  park_reference: string;
  spot_time: string;
  activator_callsign: string;
  mode: string;
  frequency: string;
  report_count: number;
};

export async function getPublicEventReplay(
  env: Pick<Env, "DB" | "ACTIVATE_RI_EVENT_ID">,
  now = new Date(),
): Promise<EventReplay> {
  // Revisions are edits to a source report, not additional activity. Use the
  // latest positive revision (including corrected timestamps/references), and
  // retain it if a later QRT revision merely ends that reported activity.
  // Dates, callsigns and frequencies come only from the upstream spot report;
  // collection time and official daily QSO totals cannot establish on-air time.
  const rows = await env.DB.prepare(`
    WITH positive_revisions AS (
      SELECT spot_key, park_reference, spot_time, activator_callsign, mode, frequency,
        provenance_json,
        ROW_NUMBER() OVER (PARTITION BY spot_key ORDER BY revision DESC) AS revision_rank
      FROM activate_ri_pota_spot_archive
      WHERE event_id = ? AND report_kind = 'spot'
    ), latest AS (
      SELECT * FROM positive_revisions WHERE revision_rank = 1
    ), projected AS (
      SELECT spot_key, park_reference, spot_time, activator_callsign, mode, frequency FROM latest
      UNION
      SELECT latest.spot_key, json_extract(evidence.value, '$.parkReference'),
        latest.spot_time, latest.activator_callsign, latest.mode, latest.frequency
      FROM latest, json_each(CASE WHEN json_valid(latest.provenance_json)
        THEN latest.provenance_json ELSE '[]' END) AS evidence
      WHERE json_extract(evidence.value, '$.kind') = 'declared_nfer'
        AND json_extract(evidence.value, '$.declaredByReference') = latest.park_reference
    ), ranked AS (
      SELECT *, ROW_NUMBER() OVER (
          PARTITION BY park_reference ORDER BY spot_time, spot_key
        ) AS report_rank,
        COUNT(*) OVER (PARTITION BY park_reference) AS report_count
      FROM projected
      WHERE park_reference IN (${parks.map(() => "?").join(", ")})
        AND spot_time >= ? AND spot_time < ?
        AND activator_callsign <> '' AND LENGTH(activator_callsign) <= 32
        AND activator_callsign NOT GLOB '*[^A-Z0-9/]*'
    ), sampled AS (
      SELECT *, ROW_NUMBER() OVER (
        PARTITION BY park_reference,
          CASE WHEN report_count <= ? THEN report_rank
            ELSE CAST((report_rank - 1) * (? - 1) / (report_count - 1) AS INTEGER) END
        ORDER BY report_rank
      ) AS sample_rank
      FROM ranked
    )
    SELECT park_reference, spot_time, activator_callsign, mode, frequency, report_count
    FROM sampled WHERE sample_rank = 1
    ORDER BY spot_time, park_reference, spot_key
  `).bind(
    env.ACTIVATE_RI_EVENT_ID,
    ...parks.map((park) => park.reference),
    eventReplayWindow.start, eventReplayWindow.end,
    eventReplayMaximumEventsPerPark, eventReplayMaximumEventsPerPark,
  ).all<ReplayRow>();

  if (!rows.success) throw new Error("Event replay archive could not be read.");
  return {
    ok: true, eventId: env.ACTIVATE_RI_EVENT_ID, generatedAt: now.toISOString(),
    window: { ...eventReplayWindow }, source: "pota-spot-archive", totalParks: parks.length,
    truncated: rows.results.some((row) => row.report_count > eventReplayMaximumEventsPerPark),
    events: rows.results.map((row) => ({
      at: row.spot_time, parkReference: row.park_reference,
      activatorCallsign: row.activator_callsign,
      mode: row.mode.trim().toUpperCase().slice(0, 24), frequency: row.frequency.trim().slice(0, 32),
    })),
  };
}

export async function handlePublicEventReplay(env: Pick<Env, "DB" | "ACTIVATE_RI_EVENT_ID">): Promise<Response> {
  try {
    return json(await getPublicEventReplay(env), {
      headers: { "cache-control": "public, max-age=60, s-maxage=60, stale-while-revalidate=300" },
    });
  } catch (error) {
    logWorkerError("activate-ri-event-replay", error);
    return json({ ok: false, error: "Event replay is temporarily unavailable." }, {
      status: 503, headers: { "cache-control": "no-store", "retry-after": "60" },
    });
  }
}
