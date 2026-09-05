import { references } from "@ripota/parks";

import {
  activateRiPotaEndDate,
  activateRiPotaStartDate,
  activateRiPotaEventId,
} from "../lib/activate-ri/pota-event";
import { deriveSpotCoverage, spotCoveragePriority, type CoverageStop, type SpotCoverage } from "../lib/activate-ri/spot-coverage";
import { listPublicStopRows } from "./db";
import {
  potaSpotReferenceEvidence,
  type PotaSpotReferenceEvidence,
} from "../lib/pota/spots";
import type { Env } from "./env";
import { currentLivePotaReferences } from "./pota-live-references";
import { potaSpotRetentionMilliseconds } from "./pota-spot-history";

const eventStart = Date.parse(`${activateRiPotaStartDate}T00:00:00.000Z`);
const eventEndExclusive = Date.parse(`${activateRiPotaEndDate}T00:00:00.000Z`) + 24 * 60 * 60_000;
const parkByReference = new Map(references.map((park) => [park.reference, park]));

type ObservationRow = {
  source_spot_id: string;
  park_reference: string;
  activator_callsign: string;
  spot_time: string;
  frequency: string;
  mode: string;
  source_label: string;
  spotter_callsign: string;
  comments: string;
};

type ProjectedObservationRow = ObservationRow & {
  projected_reference: string;
  evidence_kind: PotaSpotReferenceEvidence["kind"];
  declared_by_reference: string | null;
};

type CollectionStateRow = {
  last_collection_at: number | null;
  last_cleanup_at: number | null;
};

export type PublicPotaSpotActivity = {
  ok: true;
  generatedAt: string;
  scope: "recent" | "event";
  window: { start: string; end: string };
  lastCollectedAt: string | null;
  lastCleanupAt: string | null;
  retainedSpotCount: number;
  summary: {
    totalParks: number;
    unspottedParks: number;
    parks: number;
    activators: number;
    modes: number;
    bands: number;
    spots: number;
    rbnSpots: number;
    nonRbnSpots: number;
    nonRbnSpotters: number;
  };
  parks: PublicPotaSpotActivityPark[];
  unspottedParks: PublicPotaSpotActivityPark[];
};

export type PublicPotaSpotActivityPark = {
  reference: string;
  name: string;
  potaUrl: string;
  firstSpottedAt: string | null;
  lastSpottedAt: string | null;
  live: boolean;
  spotCount: number;
  structuredSpotCount: number;
  declaredNferSpotCount: number;
  rbnSpotCount: number;
  nonRbnSpotCount: number;
  nonRbnSpotters: string[];
  declaredByReferences: string[];
  activators: string[];
  modes: string[];
  bands: string[];
  coverage?: SpotCoverage;
  confirmation?: { activatorCallsign: string; totalQsos: number; qsoDate: string } | null;
  retainedEventEvidence?: boolean;
};

export async function getPublicPotaSpotActivity(
  env: Pick<Env, "DB"> & Partial<Pick<Env, "ACTIVATE_RI_EVENT_ID">>,
  now = new Date(),
): Promise<PublicPotaSpotActivity> {
  const scope = now.valueOf() < eventStart ? "recent" : "event";
  const windowStart = scope === "recent"
    ? now.valueOf() - potaSpotRetentionMilliseconds
    : eventStart;
  const windowEnd = scope === "recent" ? now.valueOf() : eventEndExclusive;
  const eventEnv = { DB: env.DB, ACTIVATE_RI_EVENT_ID: env.ACTIVATE_RI_EVENT_ID ?? activateRiPotaEventId };
  const [observations, state, retained, liveReferences, stopRows, confirmations, eventObservations] = await Promise.all([
    env.DB.prepare(
      scope === "recent"
        ? `SELECT source_spot_id, park_reference, activator_callsign, spot_time,
            frequency, mode, source_label, spotter_callsign, comments
           FROM pota_spot_observations
           WHERE spot_time >= ? AND spot_time <= ?
           ORDER BY spot_time DESC`
        : `SELECT source_spot_id, park_reference, activator_callsign, spot_time,
            frequency, mode, source_label, spotter_callsign, comments
           FROM pota_spot_observations
           WHERE spot_time >= ? AND spot_time < ?
           ORDER BY spot_time DESC`,
    ).bind(
      new Date(windowStart).toISOString(),
      new Date(windowEnd).toISOString(),
    ).all<ObservationRow>(),
    env.DB.prepare(
      `SELECT last_collection_at, last_cleanup_at
       FROM pota_spot_collection_state
       WHERE id = 'ri-live-spots'`,
    ).first<CollectionStateRow>(),
    env.DB.prepare("SELECT COUNT(*) AS count FROM pota_spot_observations")
      .first<{ count: number }>(),
    currentLivePotaReferences(env, now),
    listPublicStopRows(eventEnv),
    env.DB.prepare(
      `SELECT park_reference, activator_callsign, total_qsos, qso_date
       FROM activate_ri_pota_activation_evidence
       WHERE event_id = ? AND qualifying = 1
       ORDER BY qso_date DESC, total_qsos DESC`,
    ).bind(eventEnv.ACTIVATE_RI_EVENT_ID).all<{
      park_reference: string; activator_callsign: string; total_qsos: number; qso_date: string;
    }>(),
    env.DB.prepare(
      `SELECT park_reference, MAX(last_spot_time) AS last_spot_time
       FROM activate_ri_pota_spot_observations
       WHERE event_id = ? AND ? = 'event'
       GROUP BY park_reference`,
    ).bind(eventEnv.ACTIVATE_RI_EVENT_ID, scope).all<{ park_reference: string; last_spot_time: string }>(),
  ]);

  const observationRows = observations.results ?? [];
  const parks = summarizeParks(observationRows, liveReferences);
  const spotted = new Map(parks.map(park => [park.reference, park]));
  const observedDuringEvent = new Map(eventObservations.results.map(row => [row.park_reference, row.last_spot_time]));
  const stopsByPark = new Map<string, CoverageStop[]>();
  for (const stop of stopRows) {
    const stops = stopsByPark.get(stop.park_reference) ?? [];
    stops.push({
      parkReference: stop.park_reference, activatorCallsign: stop.submitter_callsign,
      startAt: stop.start_at, endAt: stop.end_at, status: stop.status,
    });
    stopsByPark.set(stop.park_reference, stops);
  }
  const unspottedParks: PublicPotaSpotActivityPark[] = [];
  for (const reference of references) {
    const park: PublicPotaSpotActivityPark = spotted.get(reference.reference) ?? {
      reference: reference.reference, name: reference.name, potaUrl: reference.potaUrl,
      firstSpottedAt: null, lastSpottedAt: null, live: false,
      spotCount: 0, structuredSpotCount: 0, declaredNferSpotCount: 0,
      rbnSpotCount: 0, nonRbnSpotCount: 0, nonRbnSpotters: [], declaredByReferences: [],
      activators: [], modes: [], bands: [],
    };
    const confirmation = scope === "event"
      ? confirmations.results.find(row => row.park_reference === reference.reference)
      : undefined;
    const retainedObservation = observedDuringEvent.get(park.reference);
    if (retainedObservation && !spotted.has(park.reference)) {
      park.retainedEventEvidence = true;
      park.lastSpottedAt = retainedObservation;
      spotted.set(park.reference, park);
      parks.push(park);
    }
    park.confirmation = confirmation ? {
      activatorCallsign: confirmation.activator_callsign,
      totalQsos: confirmation.total_qsos, qsoDate: confirmation.qso_date,
    } : null;
    park.coverage = deriveSpotCoverage(spotted.has(park.reference), Boolean(confirmation), stopsByPark.get(park.reference) ?? [], now);
    if (!spotted.has(reference.reference)) unspottedParks.push(park);
  }
  unspottedParks.sort((a, b) =>
    spotCoveragePriority[a.coverage!.status] - spotCoveragePriority[b.coverage!.status] ||
    a.name.localeCompare(b.name),
  );
  const activators = new Set(parks.flatMap((park) => park.activators));
  const modes = new Set(parks.flatMap((park) => park.modes));
  const bands = new Set(parks.flatMap((park) => park.bands));
  const nonRbnSpotters = new Set(parks.flatMap((park) => park.nonRbnSpotters));
  return {
    ok: true,
    generatedAt: now.toISOString(),
    scope,
    window: {
      start: new Date(windowStart).toISOString(),
      end: new Date(windowEnd).toISOString(),
    },
    lastCollectedAt: millisecondsToIso(state?.last_collection_at),
    lastCleanupAt: millisecondsToIso(state?.last_cleanup_at),
    retainedSpotCount: retained?.count ?? 0,
    summary: {
      totalParks: references.length,
      unspottedParks: unspottedParks.length,
      parks: parks.length,
      activators: activators.size,
      modes: modes.size,
      bands: bands.size,
      spots: observationRows.length,
      rbnSpots: observationRows.filter(isRbn).length,
      nonRbnSpots: observationRows.filter((row) => !isRbn(row)).length,
      nonRbnSpotters: nonRbnSpotters.size,
    },
    parks,
    unspottedParks,
  };
}

export function frequencyToAmateurBand(value: string): string | null {
  const parsed = Number(value.replaceAll(",", "").trim());
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  const kilohertz = parsed < 1_000 ? parsed * 1_000 : parsed;
  const ranges: ReadonlyArray<readonly [number, number, string]> = [
    [1_800, 2_000, "160m"], [3_500, 4_000, "80m"], [5_300, 5_500, "60m"],
    [7_000, 7_300, "40m"], [10_100, 10_150, "30m"], [14_000, 14_350, "20m"],
    [18_068, 18_168, "17m"], [21_000, 21_450, "15m"], [24_890, 24_990, "12m"],
    [28_000, 29_700, "10m"], [50_000, 54_000, "6m"], [144_000, 148_000, "2m"],
    [222_000, 225_000, "1.25m"], [420_000, 450_000, "70cm"],
  ];
  return ranges.find(([minimum, maximum]) => kilohertz >= minimum && kilohertz <= maximum)?.[2] ?? null;
}

function summarizeParks(
  rows: readonly ObservationRow[],
  liveReferences: ReadonlyMap<string, PotaSpotReferenceEvidence["kind"]>,
): PublicPotaSpotActivityPark[] {
  const grouped = new Map<string, ProjectedObservationRow[]>();
  for (const row of projectReferences(rows)) {
    const parkRows = grouped.get(row.projected_reference) ?? [];
    parkRows.push(row);
    grouped.set(row.projected_reference, parkRows);
  }
  return [...grouped.entries()].flatMap(([reference, parkRows]) => {
    const park = parkByReference.get(reference);
    if (!park) return [];
    const times = parkRows.map((row) => row.spot_time).sort();
    const modes = uniqueSorted(parkRows.map((row) => row.mode.trim().toUpperCase()).filter(Boolean));
    const bands = uniqueSorted(parkRows.flatMap((row) => {
      const band = frequencyToAmateurBand(row.frequency);
      return band ? [band] : [];
    }));
    return [{
      reference,
      name: park.name,
      potaUrl: park.potaUrl,
      firstSpottedAt: times[0],
      lastSpottedAt: times[times.length - 1],
      live: liveReferences.has(reference),
      spotCount: parkRows.length,
      structuredSpotCount: parkRows.filter((row) => row.evidence_kind === "structured_spot").length,
      declaredNferSpotCount: parkRows.filter((row) => row.evidence_kind === "declared_nfer").length,
      rbnSpotCount: parkRows.filter(isRbn).length,
      nonRbnSpotCount: parkRows.filter((row) => !isRbn(row)).length,
      nonRbnSpotters: uniqueSorted(parkRows
        .filter((row) => !isRbn(row))
        .map((row) => row.spotter_callsign)
        .filter(Boolean)),
      declaredByReferences: uniqueSorted(parkRows
        .map((row) => row.declared_by_reference)
        .filter((reference): reference is string => Boolean(reference))),
      activators: uniqueSorted(parkRows.map((row) => row.activator_callsign)),
      modes,
      bands,
    }];
  }).sort((left, right) => (right.lastSpottedAt ?? "").localeCompare(left.lastSpottedAt ?? ""));
}

function projectReferences(rows: readonly ObservationRow[]): ProjectedObservationRow[] {
  return rows.flatMap((row) => potaSpotReferenceEvidence({
    parkReference: row.park_reference,
    sourceLabel: row.source_label,
    comments: row.comments,
  }).flatMap((evidence) => parkByReference.has(evidence.parkReference)
    ? [{
        ...row,
        projected_reference: evidence.parkReference,
        evidence_kind: evidence.kind,
        declared_by_reference: evidence.declaredByReference,
      }]
    : []));
}

function isRbn(row: Pick<ObservationRow, "source_label">): boolean {
  return row.source_label.trim().toUpperCase() === "RBN";
}

function uniqueSorted(values: readonly string[]): string[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

function millisecondsToIso(value: number | null | undefined): string | null {
  return Number.isFinite(value) ? new Date(value as number).toISOString() : null;
}
