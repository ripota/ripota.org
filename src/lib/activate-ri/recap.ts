import historicalParks from "../../../public/data/activate-ri-2026/parks.json";
import type { PublicParkEvidence, PublicPotaParkStatusSnapshot } from "./pota-status-client";

export type RecapSummary = {
  totalParks: number;
  confirmedParks: number;
  observedParks: number;
  activationCount: number;
  callsigns: string[];
  qsoCredits: number;
  modes: { phone: number; cw: number; data: number };
  repeatParks: number;
};

/**
 * Summarize the historical event roster and dated evidence, independently of
 * today's park catalog, planned stops, and current on-air status. Activations
 * are qualifying park/callsign/UTC-date records, not outings. QSO credits include
 * attempts and remain separate across parks (including N-fers), so they are not
 * unique contacts. Callsigns are recorded station identities, not people.
 */
export function summarizeRecap(
  snapshot: PublicPotaParkStatusSnapshot,
  roster: readonly { reference: string }[] = historicalParks,
): RecapSummary {
  const parks = new Set(roster.map(({ reference }) => reference.trim().toUpperCase()).filter(Boolean));
  const observed = new Set<string>();
  const records = new Map<string, {
    reference: string;
    evidence: PublicParkEvidence;
    confirmation: boolean;
  }>();

  for (const park of snapshot.parks) {
    const reference = park.reference.trim().toUpperCase();
    // Later catalog additions are not part of this event. Missing historical
    // references still belong in the denominator while their evidence is absent.
    if (!parks.has(reference)) continue;

    if (park.lastObservation && inEventWindow(park.lastObservation.spotDate, snapshot)) {
      observed.add(reference);
    }

    for (const [rows, confirmation] of [
      [park.confirmations, true],
      [park.attempts, false],
    ] as const) {
      for (const row of rows) {
        const evidence = validEvidence(row, snapshot);
        if (!evidence) continue;
        const key = `${reference}:${evidence.activeCallsign}:${evidence.qsoDate}`;
        const previous = records.get(key);
        // Repeated public rows are one record. A confirmation supersedes an
        // attempt for the same key; equally authoritative duplicates keep first.
        if (!previous || (confirmation && !previous.confirmation)) {
          records.set(key, { reference, evidence, confirmation });
        }
      }
    }
  }

  const confirmations = new Map<string, number>();
  const callsigns = new Set<string>();
  const result: RecapSummary = {
    totalParks: parks.size,
    confirmedParks: 0,
    observedParks: 0,
    activationCount: 0,
    callsigns: [],
    qsoCredits: 0,
    modes: { phone: 0, cw: 0, data: 0 },
    repeatParks: 0,
  };

  for (const { reference, evidence, confirmation } of records.values()) {
    callsigns.add(evidence.activeCallsign);
    result.qsoCredits += evidence.totalQsos;
    result.modes.phone += evidence.qsosPhone;
    result.modes.cw += evidence.qsosCw;
    result.modes.data += evidence.qsosData;
    if (confirmation && evidence.totalQsos >= 10) {
      result.activationCount += 1;
      confirmations.set(reference, (confirmations.get(reference) ?? 0) + 1);
    } else {
      observed.add(reference);
    }
  }

  result.confirmedParks = confirmations.size;
  result.observedParks = [...observed].filter((reference) => !confirmations.has(reference)).length;
  result.callsigns = [...callsigns].sort();
  result.repeatParks = [...confirmations.values()].filter((count) => count > 1).length;
  return result;
}

function validEvidence(value: unknown, snapshot: PublicPotaParkStatusSnapshot): PublicParkEvidence | null {
  if (typeof value !== "object" || value === null) return null;
  const row = value as Record<string, unknown>;
  if (typeof row.activeCallsign !== "string" || typeof row.qsoDate !== "string" ||
    !/^\d{8}$/.test(row.qsoDate)) return null;
  const activeCallsign = row.activeCallsign.trim().toUpperCase();
  if (!/^[A-Z0-9/]{1,32}$/.test(activeCallsign)) return null;
  const date = `${row.qsoDate.slice(0, 4)}-${row.qsoDate.slice(4, 6)}-${row.qsoDate.slice(6)}`;
  if (!inEventWindow(date, snapshot)) return null;
  const { totalQsos, qsosPhone, qsosCw, qsosData } = row;
  if (!validCount(totalQsos) || !validCount(qsosPhone) || !validCount(qsosCw) || !validCount(qsosData)) {
    return null;
  }
  return { qsoDate: row.qsoDate, activeCallsign, totalQsos, qsosPhone, qsosCw, qsosData };
}

function validCount(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function inEventWindow(date: string, snapshot: PublicPotaParkStatusSnapshot): boolean {
  if (typeof date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
  const instant = Date.parse(`${date}T00:00:00.000Z`);
  return Number.isFinite(instant) && new Date(instant).toISOString().slice(0, 10) === date &&
    date >= snapshot.eventWindow?.startDate && date <= snapshot.eventWindow?.endDate;
}
