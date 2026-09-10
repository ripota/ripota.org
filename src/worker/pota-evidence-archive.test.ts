import { afterEach, describe, expect, it, vi } from "vitest";
import type { LivePotaSpot } from "../lib/pota/spots";
import { archiveEventSpotReports } from "./pota-evidence-archive";
import { cleanupPotaSpotHistory, persistPotaSpotHistory } from "./pota-spot-history";
import { syncPotaSpotHistories } from "./pota-spot-history-sync";
import { getRiPotaSpotsSnapshot } from "./routes/pota";
import { createMigratedSqliteD1 } from "./test-utils/sqlite-d1";

let cleanup: (() => void) | undefined;
afterEach(() => { cleanup?.(); cleanup = undefined; vi.restoreAllMocks(); });

function database(through?: string) {
  const db = createMigratedSqliteD1({ through });
  cleanup = db.close;
  return { ...db, ACTIVATE_RI_EVENT_ID: "activate-ri-2026" as const };
}

const report: LivePotaSpot = {
  id: "report-1", parkReference: "US-10542", parkName: "Camp Cronin Fishing Area",
  activatorCallsign: "K1NW", frequency: "14315", mode: "SSB", sourceBand: "20m",
  spotTime: "2026-09-11T12:00:00Z", spotterCallsign: "W1AW", comments: "calling CQ",
  sourceLabel: "POTA", upstreamCount: 3, locationDesc: "US-RI", expiresInSeconds: 600,
  parkUrl: "https://pota.app/#/park/US-10542", spotsUrl: "https://pota.app/",
};

describe("event evidence archive", () => {
  it("keeps source expiry fixed when the same raw report is observed again from a stale snapshot", async () => {
    const env = database();
    const fetchedAt = Date.parse("2026-09-11T12:00:00Z");
    for (const elapsed of [0, 120_000, 300_000]) {
      await archiveEventSpotReports(env, [report], {
        observedAt: new Date(fetchedAt + elapsed), sourceFetchedAt: fetchedAt,
        source: "live", stale: elapsed > 0,
      });
    }
    expect((await env.DB.prepare(
      `SELECT revision, source_fetched_at, reported_expires_at, last_observed_at, stale
       FROM activate_ri_pota_spot_archive`,
    ).all()).results).toEqual([{
      revision: 1, source_fetched_at: fetchedAt, reported_expires_at: fetchedAt + 600_000,
      last_observed_at: fetchedAt + 300_000, stale: 1,
    }]);
  });

  it("preserves report revisions, deduplicates repeat observations and survives all rolling cleanup", async () => {
    const env = database();
    const started = Date.parse("2026-09-11T12:00:10Z");
    const archive = (value: LivePotaSpot, minutes: number) => archiveEventSpotReports(env, [value], {
      observedAt: new Date(started + minutes * 60_000), sourceFetchedAt: started + minutes * 60_000,
      source: "live", stale: false, runId: `run-${minutes}`,
    });
    await persistPotaSpotHistory(env, [report], new Date(started));
    await archive(report, 0);
    await archive(report, 1);
    await archive({ ...report, comments: "QRT", frequency: "14062", mode: "CW" }, 2);
    await archive(report, 3);
    await cleanupPotaSpotHistory(env, new Date("2027-02-01T00:00:00Z"));

    expect(await env.DB.prepare("SELECT COUNT(*) AS count FROM pota_spot_observations").first()).toEqual({ count: 0 });
    const rows = (await env.DB.prepare(
      `SELECT revision, report_kind, comments, first_observed_at, last_observed_at,
        source_band, upstream_count, source_fetched_at, collection_run_id, retain_until
       FROM activate_ri_pota_spot_archive ORDER BY revision`,
    ).all()).results;
    expect(rows).toHaveLength(3);
    expect(rows[0]).toMatchObject({ revision: 1, report_kind: "spot", comments: "calling CQ",
      first_observed_at: started, last_observed_at: started + 60_000,
      source_band: "20m", upstream_count: 3, retain_until: "2027-01-01T00:00:00.000Z" });
    expect(rows[1]).toMatchObject({ revision: 2, report_kind: "qrt", comments: "QRT" });
    expect(rows[2]).toMatchObject({ revision: 3, source_fetched_at: started + 180_000, collection_run_id: "run-3" });
  });

  it("backfills existing event reports without inventing missing fetch metadata", async () => {
    const env = database("0025_ops_message_edits.sql");
    await persistPotaSpotHistory(env, [report, { ...report, id: "outside", spotTime: "2026-09-15T12:00:00Z" }],
      new Date("2026-09-15T12:01:00Z"));
    env.applyMigrationFile("0026_event_evidence_archive.sql");
    expect((await env.DB.prepare(
      `SELECT spot_key, collection_source, normalizer_version, source_fetched_at, stale
       FROM activate_ri_pota_spot_archive`,
    ).all()).results).toEqual([{
      spot_key: "report-1", collection_source: "legacy_backfill", normalizer_version: "legacy-rolling-v1",
      source_fetched_at: null, stale: null,
    }]);
  });

  it("archives live QRT and source band while excluding them from the live snapshot", async () => {
    const env = database();
    const fetchedAt = new Date("2026-09-11T12:05:00Z");
    const snapshot = await getRiPotaSpotsSnapshot(env, {
      now: () => fetchedAt,
      fetcher: vi.fn(async () => Response.json([{
        spotId: 100, reference: "US-10542", activator: "K1NW", frequency: "14315", mode: "SSB",
        spotTime: "2026-09-11T12:04:00", comments: "QRT thanks", expire: 0,
        source: "POTA", band: "20m", locationDesc: "US-RI",
      }])),
    });
    expect(snapshot).toMatchObject({ ok: true, snapshot: { spots: [] } });
    expect(await env.DB.prepare(
      "SELECT report_kind, source_band, source_fetched_at FROM activate_ri_pota_spot_archive",
    ).first()).toEqual({ report_kind: "qrt", source_band: "20m", source_fetched_at: fetchedAt.valueOf() });
  });

  it("archives late history and QRT after capture closes, with actual fetch time", async () => {
    const env = database();
    await env.DB.prepare(
      `INSERT INTO pota_spot_history_sync (activator_callsign, park_reference, first_seen_at, last_seen_at, active)
       VALUES ('K1NW', 'US-10542', 0, 0, 0)`,
    ).run();
    let time = Date.parse("2026-09-15T12:00:00Z");
    await syncPotaSpotHistories(env, [], { now: () => new Date(time), fetcher: vi.fn(async () => {
      time += 2_000;
      return Response.json([
        { spotId: 1, spotTime: "2026-09-13T22:00:00Z", frequency: "14315", mode: "SSB", band: "20m" },
        { spotId: 2, spotTime: "2026-09-13T22:05:00Z", comments: "QRT", band: "20m" },
      ]);
    }) });
    expect((await env.DB.prepare(
      "SELECT report_kind, source_fetched_at, first_observed_at FROM activate_ri_pota_spot_archive ORDER BY spot_key",
    ).all()).results).toEqual([
      { report_kind: "spot", source_fetched_at: time, first_observed_at: time },
      { report_kind: "qrt", source_fetched_at: time, first_observed_at: time },
    ]);
    expect(await env.DB.prepare("SELECT COUNT(*) AS count FROM activate_ri_pota_spot_observations").first()).toEqual({ count: 1 });
    expect(await env.DB.prepare("SELECT COUNT(*) AS count FROM pota_spot_observations").first()).toEqual({ count: 1 });
  });

  it("discovers a bounded number of officially evidenced pairs never seen in live spots", async () => {
    const env = database();
    for (const callsign of ["N1AAA", "N1BBB", "N1CCC"]) {
      await env.DB.prepare(
        `INSERT INTO activate_ri_pota_activation_evidence
         (event_id, park_reference, location_desc, qso_date, activator_callsign, total_qsos,
          qsos_cw, qsos_data, qsos_phone, qualifying, source_version, first_seen_at, last_verified_at, created_at, updated_at)
         VALUES ('activate-ri-2026', 'US-10542', 'US-RI', '20260911', ?, 10, 0, 0, 10, 1, 'test', '', '', '', '')`,
      ).bind(callsign).run();
    }
    const fetcher = vi.fn(async () => Response.json([]));
    await expect(syncPotaSpotHistories(env, [], { now: () => new Date("2026-09-15T00:00:00Z"), fetcher }))
      .resolves.toMatchObject({ attempted: 2, backfillAttempted: 2 });
    await expect(syncPotaSpotHistories(env, [], { now: () => new Date("2026-09-15T00:01:00Z"), fetcher }))
      .resolves.toMatchObject({ attempted: 1, backfillAttempted: 1 });
    expect(fetcher).toHaveBeenCalledTimes(3);
  });
});
