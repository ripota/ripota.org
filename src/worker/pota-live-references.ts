import { references } from "@ripota/parks";

import {
  potaSpotReferenceEvidence,
  type PotaSpotReferenceEvidence,
} from "../lib/pota/spots";
import type { Env } from "./env";

const riReferences = new Set(references.map((park) => park.reference));

type CacheRow = {
  payload_json: string | null;
  fetched_at: number | null;
};

type SyncRow = {
  activator_callsign: string;
  park_reference: string;
  declared_references_json: string;
};

export async function currentLivePotaReferences(
  env: Pick<Env, "DB">,
  now: Date,
): Promise<Map<string, PotaSpotReferenceEvidence["kind"]>> {
  const [cache, sync] = await Promise.all([
    env.DB.prepare(
      `SELECT payload_json, fetched_at
       FROM pota_spots_cache WHERE id = 'ri-live-spots'`,
    ).first<CacheRow>(),
    env.DB.prepare(
      `SELECT activator_callsign, park_reference, declared_references_json
       FROM pota_spot_history_sync WHERE active = 1`,
    ).all<SyncRow>(),
  ]);
  const live = liveCacheSpots(cache, now);
  const livePairs = new Set(live.map((spot) => pairKey(spot.activatorCallsign, spot.parkReference)));
  const result = new Map<string, PotaSpotReferenceEvidence["kind"]>();

  for (const spot of live) {
    for (const evidence of potaSpotReferenceEvidence(spot)) {
      addReference(result, evidence.parkReference, evidence.kind);
    }
  }
  for (const row of sync.results ?? []) {
    if (!livePairs.has(pairKey(row.activator_callsign, row.park_reference))) continue;
    for (const reference of parseReferenceList(row.declared_references_json)) {
      addReference(result, reference, "declared_nfer");
    }
  }
  return result;
}

function liveCacheSpots(cache: CacheRow | null, now: Date): Array<{
  activatorCallsign: string;
  parkReference: string;
  sourceLabel: string;
  comments: string;
}> {
  if (!cache?.payload_json || !cache.fetched_at) return [];
  let value: unknown;
  try {
    value = JSON.parse(cache.payload_json);
  } catch {
    return [];
  }
  if (!Array.isArray(value)) return [];
  const elapsedSeconds = Math.max(0, Math.floor((now.valueOf() - cache.fetched_at) / 1_000));
  return value.flatMap((candidate) => {
    if (!isRecord(candidate)) return [];
    const activatorCallsign = stringValue(candidate.activatorCallsign).trim().toUpperCase();
    const parkReference = stringValue(candidate.parkReference).trim().toUpperCase();
    const expiry = numberOrNull(candidate.expiresInSeconds);
    if (!activatorCallsign || !riReferences.has(parkReference)) return [];
    if (expiry !== null && expiry - elapsedSeconds <= 0) return [];
    return [{
      activatorCallsign,
      parkReference,
      sourceLabel: stringValue(candidate.sourceLabel),
      comments: stringValue(candidate.comments),
    }];
  });
}

function addReference(
  result: Map<string, PotaSpotReferenceEvidence["kind"]>,
  reference: string,
  kind: PotaSpotReferenceEvidence["kind"],
): void {
  if (!riReferences.has(reference)) return;
  if (kind === "structured_spot" || !result.has(reference)) result.set(reference, kind);
}

function parseReferenceList(value: string): string[] {
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed)
      ? parsed.filter((reference): reference is string =>
          typeof reference === "string" && riReferences.has(reference)
        )
      : [];
  } catch {
    return [];
  }
}

function pairKey(callsign: string, reference: string): string {
  return `${callsign}:${reference}`;
}

function numberOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
