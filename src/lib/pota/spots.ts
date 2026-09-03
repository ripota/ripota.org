import { normalizePotaReference, officialPotaParkUrl } from "./references";

export const officialPotaSpotsUrl = "https://pota.app/";

export type LivePotaSpot = {
  id: string;
  parkReference: string;
  parkName: string;
  activatorCallsign: string;
  frequency: string;
  mode: string;
  spotTime: string;
  spotterCallsign: string;
  comments: string;
  sourceLabel: string;
  locationDesc: "US-RI";
  expiresInSeconds: number | null;
  parkUrl: string;
  spotsUrl: string;
};

export type NormalizePotaSpotsOptions = {
  parkNames: ReadonlyMap<string, string>;
  parkLocations: ReadonlyMap<string, string>;
};

export function normalizeRiPotaSpots(
  value: unknown,
  { parkNames, parkLocations }: NormalizePotaSpotsOptions,
): LivePotaSpot[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .flatMap((candidate, index) => {
      const spot = normalizeRiPotaSpot(candidate, index, parkNames, parkLocations);
      return spot ? [spot] : [];
    })
    .sort((left, right) => right.spotTime.localeCompare(left.spotTime));
}

function normalizeRiPotaSpot(
  value: unknown,
  index: number,
  parkNames: ReadonlyMap<string, string>,
  parkLocations: ReadonlyMap<string, string>,
): LivePotaSpot | null {
  if (!isRecord(value)) {
    return null;
  }

  const parkReference = normalizePotaReference(stringValue(value.reference));
  const activatorCallsign = stringValue(value.activator).trim().toUpperCase();
  const frequency = stringValue(value.frequency).trim();
  const mode = stringValue(value.mode).trim().toUpperCase();
  const spotTime = stringValue(value.spotTime).trim();
  const comments = stringValue(value.comments).trim();
  const expiresInSeconds = numberOrNull(value.expire);
  const locationDesc = riSpotLocation(value.locationDesc, parkLocations.get(parkReference));

  if (
    !parkNames.has(parkReference) ||
    !activatorCallsign ||
    !spotTime ||
    !locationDesc ||
    isInvalidSpot(value.invalid) ||
    (expiresInSeconds !== null && expiresInSeconds <= 0) ||
    /\bQRT\b/i.test(comments)
  ) {
    return null;
  }

  const sourceId = stringValue(value.spotId).trim();

  return {
    id: sourceId || `${parkReference}:${activatorCallsign}:${spotTime}:${index}`,
    parkReference,
    parkName: stringValue(value.name).trim() || parkNames.get(parkReference) || parkReference,
    activatorCallsign,
    frequency,
    mode,
    spotTime,
    spotterCallsign: stringValue(value.spotter).trim().toUpperCase(),
    comments,
    sourceLabel: stringValue(value.source).trim(),
    locationDesc,
    expiresInSeconds,
    parkUrl: officialPotaParkUrl(parkReference),
    spotsUrl: officialPotaSpotsUrl,
  };
}

function riSpotLocation(value: unknown, catalogLocation: string | undefined): "US-RI" | null {
  if (value !== undefined && value !== null && value !== "") {
    if (typeof value !== "string") return null;
    const selected = locationCodes(value);
    return selected.length === 1 && selected[0] === "US-RI" ? "US-RI" : null;
  }

  const catalog = locationCodes(catalogLocation ?? "");
  return catalog.length === 1 && catalog[0] === "US-RI" ? "US-RI" : null;
}

function locationCodes(value: string): string[] {
  return [...new Set(value
    .split(",")
    .map((code) => code.trim().toUpperCase().replaceAll("_", "-"))
    .filter((code) => /^US-[A-Z]{2}$/.test(code)))];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringValue(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }

  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }

  return "";
}

function numberOrNull(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
}

function isInvalidSpot(value: unknown): boolean {
  return value !== undefined && value !== null && value !== false && value !== "";
}
