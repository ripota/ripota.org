import { references } from "@ripota/parks";

import {
  potaSpotReferenceEvidence,
  type LivePotaSpot,
  type PotaSpotReferenceEvidence,
} from "../pota/spots";

export const activateRiPotaEventId = "activate-ri-2026";
export const activateRiPotaStartDate = "2026-09-10";
export const activateRiPotaEndDate = "2026-09-13";
export const activateRiPotaReconciliationEnd = "2026-10-14T00:00:00.000Z";
export const qualifyingActivationQsos = 10;
const riReferences = new Set(references.map((park) => park.reference));

export type PotaActivationEvidence = {
  parkReference: string;
  locationDesc: "US-RI";
  qsoDate: string;
  activatorCallsign: string;
  totalQsos: number;
  qsosCw: number;
  qsosData: number;
  qsosPhone: number;
  qualifying: boolean;
};

export type PotaSpotObservation = {
  parkReference: string;
  spotDate: string;
  activatorCallsign: string;
  locationDesc: "US-RI";
  sourceSpotId: string | null;
  observedAt: string;
  spotTime: string;
  frequency: string;
  mode: string;
  sourceLabel: string;
  spotterCallsign: string;
  comments: string;
  observationKind: PotaSpotReferenceEvidence["kind"];
  declaredByReference: string | null;
};

export type ParkPotaPrimaryStatus = "confirmed" | "observed" | "scheduled" | "needed";

export type ParkPotaFacts = {
  scheduled: boolean;
  live: boolean;
  observations: PotaSpotObservation[];
  activations: PotaActivationEvidence[];
};

export type ParkPotaDerivedStatus = {
  status: ParkPotaPrimaryStatus;
  scheduled: boolean;
  live: boolean;
  observed: boolean;
  attemptRecorded: boolean;
  confirmed: boolean;
};

export function normalizePotaActivationHistory(
  value: unknown,
  parkReference: string,
): PotaActivationEvidence[] {
  if (!Array.isArray(value)) throw new Error("POTA activation history was not an array.");
  const normalizedReference = normalizeReference(parkReference);
  if (!normalizedReference) throw new Error("POTA activation history reference was invalid.");

  const evidence = new Map<string, PotaActivationEvidence>();
  for (const candidate of value) {
    if (!isRecord(candidate)) continue;
    const qsoDate = stringValue(candidate.qso_date).trim();
    const locationDesc = normalizeLocationDesc(candidate.locationDesc);
    const activatorCallsign = normalizeCallsign(candidate.activeCallsign);
    const totalQsos = nonnegativeInteger(candidate.totalQSOs);
    const qsosCw = nonnegativeInteger(candidate.qsosCW);
    const qsosData = nonnegativeInteger(candidate.qsosDATA);
    const qsosPhone = nonnegativeInteger(candidate.qsosPHONE);

    if (
      !eventQsoDate(qsoDate) || locationDesc !== "US-RI" || !activatorCallsign ||
      totalQsos === null || qsosCw === null || qsosData === null || qsosPhone === null
    ) continue;

    const row = {
      parkReference: normalizedReference,
      locationDesc,
      qsoDate,
      activatorCallsign,
      totalQsos,
      qsosCw,
      qsosData,
      qsosPhone,
      qualifying: totalQsos >= qualifyingActivationQsos,
    } satisfies PotaActivationEvidence;
    evidence.set(`${qsoDate}:${activatorCallsign}`, row);
  }
  return [...evidence.values()].sort((left, right) =>
    right.qsoDate.localeCompare(left.qsoDate) ||
    right.totalQsos - left.totalQsos ||
    left.activatorCallsign.localeCompare(right.activatorCallsign),
  );
}

export function spotToEventObservation(
  spot: LivePotaSpot,
  observedAt: Date,
): PotaSpotObservation | null {
  return spotToEventObservations(spot, observedAt)[0] ?? null;
}

export function spotToEventObservations(
  spot: LivePotaSpot,
  observedAt: Date,
): PotaSpotObservation[] {
  const spotTime = new Date(spot.spotTime);
  if (!Number.isFinite(spotTime.valueOf()) || spot.locationDesc !== "US-RI") return [];
  const spotDate = spotTime.toISOString().slice(0, 10);
  if (spotDate < activateRiPotaStartDate || spotDate > activateRiPotaEndDate) return [];
  const callsign = normalizeCallsign(spot.activatorCallsign);
  if (!callsign) return [];

  const base = {
    spotDate,
    activatorCallsign: callsign,
    locationDesc: "US-RI" as const,
    sourceSpotId: spot.id.trim() || null,
    observedAt: observedAt.toISOString(),
    spotTime: spotTime.toISOString(),
    frequency: spot.frequency.trim().slice(0, 32),
    mode: spot.mode.trim().toUpperCase().slice(0, 24),
    sourceLabel: spot.sourceLabel.trim().slice(0, 64),
    spotterCallsign: normalizeCallsign(spot.spotterCallsign),
    comments: spot.comments.trim().slice(0, 500),
  };
  return potaSpotReferenceEvidence(spot).flatMap((evidence) => {
    const parkReference = normalizeReference(evidence.parkReference);
    if (!parkReference || !riReferences.has(parkReference)) return [];
    return [{
      ...base,
      parkReference,
      observationKind: evidence.kind,
      declaredByReference: evidence.declaredByReference,
    }];
  });
}

export function deriveParkPotaStatus(facts: ParkPotaFacts): ParkPotaDerivedStatus {
  const confirmed = facts.activations.some((activation) => activation.qualifying);
  const attemptRecorded = facts.activations.some((activation) => !activation.qualifying);
  const observed = facts.observations.length > 0;
  return {
    status: confirmed
      ? "confirmed"
      : observed || attemptRecorded
        ? "observed"
        : facts.scheduled
          ? "scheduled"
          : "needed",
    scheduled: facts.scheduled,
    live: facts.live,
    observed,
    attemptRecorded,
    confirmed,
  };
}

export function summarizeParkPotaStatuses(
  statuses: readonly ParkPotaDerivedStatus[],
): {
  total: number;
  confirmed: number;
  observedNotConfirmed: number;
  scheduledNotConfirmed: number;
  stillNeeded: number;
  withoutConfirmation: number;
} {
  return {
    total: statuses.length,
    confirmed: statuses.filter((status) => status.confirmed).length,
    observedNotConfirmed: statuses.filter((status) => status.status === "observed").length,
    scheduledNotConfirmed: statuses.filter((status) => status.status === "scheduled").length,
    stillNeeded: statuses.filter((status) => status.status === "needed").length,
    withoutConfirmation: statuses.filter((status) => !status.confirmed).length,
  };
}

export function isSpotCaptureTime(now: Date): boolean {
  const value = now.valueOf();
  return value >= Date.parse(`${activateRiPotaStartDate}T00:00:00.000Z`) &&
    value < Date.parse("2026-09-14T00:15:00.000Z");
}

export function isHistoryReconciliationTime(now: Date): boolean {
  const value = now.valueOf();
  return value >= Date.parse(`${activateRiPotaStartDate}T00:00:00.000Z`) &&
    value < Date.parse(activateRiPotaReconciliationEnd);
}

function eventQsoDate(value: string): boolean {
  return /^\d{8}$/.test(value) &&
    value >= activateRiPotaStartDate.replaceAll("-", "") &&
    value <= activateRiPotaEndDate.replaceAll("-", "");
}

function normalizeLocationDesc(value: unknown): string {
  return stringValue(value).trim().toUpperCase().replaceAll("_", "-");
}

function normalizeCallsign(value: unknown): string {
  const normalized = stringValue(value).trim().toUpperCase();
  return /^[A-Z0-9/]{1,32}$/.test(normalized) ? normalized : "";
}

function normalizeReference(value: unknown): string {
  const normalized = stringValue(value).trim().toUpperCase();
  return /^[A-Z]{1,4}-\d{4,6}$/.test(normalized) ? normalized : "";
}

function nonnegativeInteger(value: unknown): number | null {
  const number = typeof value === "number"
    ? value
    : typeof value === "string" && value.trim() !== ""
      ? Number(value)
      : Number.NaN;
  return Number.isSafeInteger(number) && number >= 0 ? number : null;
}

function stringValue(value: unknown): string {
  return typeof value === "string" || typeof value === "number" ? String(value) : "";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
