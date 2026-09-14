import { afterEach, describe, expect, it, vi } from "vitest";
import type { LivePotaSpot } from "../lib/pota/spots";
import { eventReplayMaximumEventsPerPark, parseEventReplay } from "../lib/activate-ri/event-replay";
import type { Env } from "./env";
import { getPublicEventReplay } from "./event-replay";
import { archiveEventSpotReports } from "./pota-evidence-archive";
import { handleActivateRiApi } from "./routes/activate-ri";
import { createMigratedSqliteD1 } from "./test-utils/sqlite-d1";

let cleanup: (() => void) | undefined;
afterEach(() => { cleanup?.(); cleanup = undefined; vi.restoreAllMocks(); });

const report: LivePotaSpot = {
  id: "report-1", parkReference: "US-10542", parkName: "Camp Cronin Fishing Area",
  activatorCallsign: "K1NW", frequency: "14315", mode: "SSB",
  spotTime: "2026-09-11T12:00:00Z", spotterCallsign: "W1AW", comments: "calling CQ",
  sourceLabel: "POTA", upstreamCount: 3, locationDesc: "US-RI", expiresInSeconds: 600,
  parkUrl: "https://pota.app/#/park/US-10542", spotsUrl: "https://pota.app/",
};

function database(through?: string) {
  const db = createMigratedSqliteD1({ through });
  cleanup = db.close;
  return { ...db, ACTIVATE_RI_EVENT_ID: "activate-ri-2026" as const };
}

async function archive(env: Pick<Env, "DB" | "ACTIVATE_RI_EVENT_ID">, reports: LivePotaSpot[]) {
  await archiveEventSpotReports(env, reports, {
    observedAt: new Date("2026-09-20T14:00:00Z"), sourceFetchedAt: null, source: "history", stale: false,
  });
}

describe("public event replay", () => {
  it("uses reported times in chronological order, not late collection time, and publishes only allowed fields", async () => {
    const env = database();
    await archive(env, [
      { ...report, id: "last", spotTime: "2026-09-13T23:59:59Z" },
      { ...report, id: "first", spotTime: "2026-09-10T00:00:00Z" },
      { ...report, id: "middle", spotTime: "2026-09-12T15:00:00Z", mode: " cw " },
      { ...report, id: "before", spotTime: "2026-09-09T23:59:59Z" },
      { ...report, id: "after", spotTime: "2026-09-14T00:00:00Z" },
      { ...report, id: "outside", parkReference: "US-99999" },
    ]);
    const replay = await getPublicEventReplay(env, new Date("2026-09-22T00:00:00Z"));
    expect(replay).toMatchObject({
      ok: true, source: "pota-spot-archive", totalParks: 61, truncated: false,
      window: { start: "2026-09-10T00:00:00.000Z", end: "2026-09-14T00:00:00.000Z" },
    });
    expect(replay.events).toEqual([
      { at: "2026-09-10T00:00:00.000Z", parkReference: "US-10542", activatorCallsign: "K1NW", mode: "SSB", frequency: "14315" },
      { at: "2026-09-12T15:00:00.000Z", parkReference: "US-10542", activatorCallsign: "K1NW", mode: "CW", frequency: "14315" },
      { at: "2026-09-13T23:59:59.000Z", parkReference: "US-10542", activatorCallsign: "K1NW", mode: "SSB", frequency: "14315" },
    ]);
    expect(parseEventReplay(replay)).toEqual(replay);
    expect(JSON.stringify(replay)).not.toContain("calling CQ");
    expect(JSON.stringify(replay)).not.toContain("W1AW");
  });

  it("collapses revisions, applies corrected times and parks, and retains prior positive evidence when a report becomes QRT", async () => {
    const env = database();
    await archive(env, [report]);
    await archive(env, [report]);
    const corrected = { ...report, spotTime: "2026-09-11T13:00:00Z", parkReference: "US-2873", mode: "CW" };
    await archive(env, [corrected]);
    await archive(env, [{ ...corrected, spotTime: "2026-09-11T13:30:00Z", comments: "QRT thanks" }]);
    await archive(env, [{ ...report, id: "qrt-only", comments: "QRT" }]);
    await archive(env, [{ ...report, id: "later", spotTime: "2026-09-12T13:00:00Z" }]);
    const replay = await getPublicEventReplay(env);
    expect(replay.events).toHaveLength(2);
    expect(replay.events[0]).toMatchObject({ at: "2026-09-11T13:00:00.000Z", parkReference: "US-2873", mode: "CW" });
    expect(replay.events[1]).toMatchObject({ at: "2026-09-12T13:00:00.000Z", parkReference: "US-10542" });
  });

  it("projects retained declared park evidence only into the public catalog", async () => {
    const env = database();
    await archive(env, [{
      ...report, sourceLabel: "Ham2K Portable Logger", comments: "3-fer: US-10542 US-2873 US-99999",
    }]);
    const replay = await getPublicEventReplay(env);
    expect(replay.events.map((event) => event.parkReference)).toEqual(["US-10542", "US-2873"]);
  });

  it("replaces a corrected report's declared parks without retaining superseded N-fer claims", async () => {
    const env = database();
    await archive(env, [{
      ...report, sourceLabel: "Ham2K Portable Logger", comments: "2-fer: US-10542 US-2873",
    }]);
    await archive(env, [{
      ...report, parkReference: "US-2874", spotTime: "2026-09-11T13:00:00Z",
      sourceLabel: "Ham2K Portable Logger", comments: "2-fer: US-2874 US-2875",
    }]);
    // Other events can reuse a source key without changing this event's replay.
    await archive(env, [{ ...report, id: "other-event-report", parkReference: "US-2876" }]);
    await env.DB.prepare(`UPDATE activate_ri_pota_spot_archive
      SET event_id = 'another-event', spot_key = ? WHERE spot_key = 'other-event-report'`)
      .bind(report.id).run();
    const replay = await getPublicEventReplay(env);
    expect(replay.events.map((event) => event.parkReference)).toEqual(["US-2874", "US-2875"]);
    expect(replay.events.every((event) => event.at === "2026-09-11T13:00:00.000Z")).toBe(true);
  });

  it("samples dense activity across the event while preserving every park's first and last report", async () => {
    const env = database();
    await archive(env, [{ ...report, id: "seed", spotTime: "2026-09-10T00:00:00Z" }]);
    // Generate 400 reports over the four days, exceeding the per-park budget.
    await env.DB.prepare(`
      WITH RECURSIVE sequence(n) AS (SELECT 1 UNION ALL SELECT n + 1 FROM sequence WHERE n < 399)
      INSERT INTO activate_ri_pota_spot_archive
        (event_id, spot_key, revision, source_spot_id, park_reference, park_name, activator_callsign,
        spot_time, frequency, mode, report_kind, source_label, spotter_callsign, comments, provenance_json,
        normalizer_version, content_hash, first_observed_at, last_observed_at, last_collected_at, collection_source)
      SELECT event_id, 'sample-' || n, revision, 'sample-' || n, park_reference, park_name, activator_callsign,
        strftime('%Y-%m-%dT%H:%M:%fZ', '2026-09-10T00:00:00Z', '+' || (n * 14) || ' minutes'),
        frequency, mode, report_kind, source_label, spotter_callsign, comments, provenance_json,
        normalizer_version, content_hash, first_observed_at, last_observed_at, last_collected_at, collection_source
      FROM activate_ri_pota_spot_archive, sequence WHERE spot_key = 'seed'
    `).run();
    await archive(env, [{ ...report, id: "late-park", parkReference: "US-2873", spotTime: "2026-09-13T23:59:59Z" }]);
    const replay = await getPublicEventReplay(env);
    expect(replay.truncated).toBe(true);
    const densePark = replay.events.filter((event) => event.parkReference === "US-10542");
    expect(densePark).toHaveLength(eventReplayMaximumEventsPerPark);
    expect(densePark[0].at).toBe("2026-09-10T00:00:00.000Z");
    expect(densePark.at(-1)?.at).toBe("2026-09-13T21:06:00.000Z");
    expect(replay.events.at(-1)).toMatchObject({ parkReference: "US-2873", at: "2026-09-13T23:59:59.000Z" });
    expect(parseEventReplay(replay)).toEqual(replay);
  });

  it("distinguishes an empty readable archive from an unavailable archive through the public route", async () => {
    const env = database();
    const routeEnv: Env = {
      ...env,
      ASSETS: {
        fetch: vi.fn(async () => new Response("unused")),
        connect: vi.fn(() => { throw new Error("Unexpected asset socket connection"); }),
      },
    };
    const request = new Request("https://ripota.org/api/activate-ri-2026/public/event-replay");
    const response = await handleActivateRiApi(request, routeEnv);
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("max-age=60");
    await expect(response.json()).resolves.toMatchObject({ ok: true, events: [] });
    await env.DB.prepare("DROP TABLE activate_ri_pota_spot_archive").run();
    vi.spyOn(console, "error").mockImplementation(() => {});
    const unavailable = await handleActivateRiApi(request, routeEnv);
    expect(unavailable.status).toBe(503);
    expect(unavailable.headers.get("cache-control")).toBe("no-store");
    await expect(unavailable.json()).resolves.toEqual({ ok: false, error: "Event replay is temporarily unavailable." });
  });
});
