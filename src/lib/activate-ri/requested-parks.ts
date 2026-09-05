import { scheduleVisibleStops } from "./listing";
import { stopTimeRangeToInstants } from "./time";
import type { PublicActivationStop } from "./types";

type KnownReference = string | { reference: string };

export type RequestedReferences = {
  references: string[];
  invalid: string[];
  unknown: string[];
};

const referencePattern = /^[A-Z]{1,4}-\d{4,6}$/;
const publicScheduleFilters = ["q", "activator", "mode", "band", "timeline", "county", "timezone"];

export function parseRequestedReferences(
  input: string,
  knownReferences: readonly KnownReference[],
): RequestedReferences {
  const known = new Set(knownReferences.map((item) =>
    (typeof item === "string" ? item : item.reference).trim().toUpperCase(),
  ));
  const result: RequestedReferences = { references: [], invalid: [], unknown: [] };
  const tokens = [...new Set(input.split(/[\s,;]+/).filter(Boolean).map((token) => token.toUpperCase()))].sort();
  for (const token of tokens) {
    if (!referencePattern.test(token)) result.invalid.push(token);
    else if (!known.has(token)) result.unknown.push(token);
    else result.references.push(token);
  }
  return result;
}

/** Build a portable agenda after validating the references against the current catalog. */
export function buildRequestedAgendaUrl(
  origin: string,
  references: readonly string[],
  filters = new URLSearchParams(),
): string {
  const normalized = [...new Set(references.map((reference) => reference.trim().toUpperCase()))].sort();
  if (normalized.some((reference) => !referencePattern.test(reference))) {
    throw new Error("Requested agenda references must be valid park reference IDs.");
  }
  const url = new URL("/activate-ri-2026/schedule/", origin);
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error("Requested agendas need an HTTP or HTTPS origin.");
  }
  url.username = "";
  url.password = "";
  url.searchParams.set("parks", normalized.join(","));
  for (const key of publicScheduleFilters) {
    const value = filters.get(key);
    if (value) url.searchParams.set(key, value);
  }
  return url.toString();
}

export function requestedAgendaStops(
  requestedRefs: readonly string[],
  stops: PublicActivationStop[],
): PublicActivationStop[] {
  const requested = new Set(requestedRefs.map((reference) => reference.trim().toUpperCase()));
  return scheduleVisibleStops(stops)
    .filter((stop) => requested.has(stop.parkReference))
    .map((stop) => ({
      stop,
      startAt: stopTimeRangeToInstants(stop.plannedDate, stop.startTime, stop.endTime, {
        utcDateOffset: stop.startTime < "04:00" ? 1 : 0,
      }).startAt,
    }))
    .sort((left, right) =>
      left.startAt.localeCompare(right.startAt) ||
      left.stop.parkReference.localeCompare(right.stop.parkReference) ||
      left.stop.activatorCallsign.localeCompare(right.stop.activatorCallsign) ||
      left.stop.id.localeCompare(right.stop.id),
    )
    .map(({ stop }) => stop);
}
