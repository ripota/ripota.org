import historicalParks from "../../../public/data/activate-ri-2026/parks.json";
import { timelineOptions } from "./listing";
import type { PublicPotaParkStatusSnapshot } from "./pota-status-client";

export const activationResultDates = timelineOptions.filter(({ value }) => value === "all" || /^2026-09-1[0-3]$/.test(value));
export type ActivationResultMode = "all" | "cw" | "phone" | "data";
export type ActivationResultSort = "date-desc" | "date-asc" | "park" | "callsign" | "qsos-desc";
export type ActivationResultView = {
  query: string;
  date: string;
  mode: ActivationResultMode;
  outcome: "all" | "qualifying" | "attempts";
  sort: ActivationResultSort;
};

export type ActivationRecord = {
  id: string;
  parkReference: string;
  parkName: string;
  qsoDate: string;
  callsign: string;
  qualifying: boolean;
  totalQsos: number;
  cw: number;
  phone: number;
  data: number;
};

export const defaultActivationResultView: ActivationResultView = {
  query: "", date: "all", mode: "all", outcome: "all", sort: "date-desc",
};

/** One public POTA record per historical park, normalized callsign, and UTC day.
 * Multi-park credits remain separate; these are neither outings nor unique QSOs.
 * Plans, spots, live state, and current catalog additions do not create rows.
 */
export function activationRecords(
  snapshot: PublicPotaParkStatusSnapshot,
  roster: readonly { reference: string; name: string }[] = historicalParks,
): ActivationRecord[] {
  const names = new Map(roster.map(({ reference, name }) => [reference.trim().toUpperCase(), name]));
  const records = new Map<string, { record: ActivationRecord; confirmation: boolean }>();
  for (const park of snapshot.parks) {
    const parkReference = park.reference.trim().toUpperCase();
    const parkName = names.get(parkReference);
    if (!parkName) continue;
    for (const [evidence, confirmation] of [[park.confirmations, true], [park.attempts, false]] as const) {
      for (const value of evidence) {
        if (!isRecord(value)) continue;
        const row = value;
        if (typeof row.activeCallsign !== "string" || typeof row.qsoDate !== "string" || !/^2026091[0-3]$/.test(row.qsoDate)) continue;
        const callsign = row.activeCallsign.trim().toUpperCase();
        if (!/^[A-Z0-9/]{1,32}$/.test(callsign)) continue;
        const { totalQsos, qsosCw: cw, qsosPhone: phone, qsosData: data } = row;
        if (!validCount(totalQsos) || !validCount(cw) || !validCount(phone) || !validCount(data)) continue;
        const qsoDate = `${row.qsoDate.slice(0, 4)}-${row.qsoDate.slice(4, 6)}-${row.qsoDate.slice(6)}`;
        const id = `${parkReference}:${callsign}:${qsoDate}`;
        const previous = records.get(id);
        if (!previous || (confirmation && !previous.confirmation)) {
          records.set(id, {
            confirmation,
            record: { id, parkReference, parkName, qsoDate, callsign, totalQsos, cw, phone, data, qualifying: confirmation && totalQsos >= 10 },
          });
        }
      }
    }
  }
  return [...records.values()].map(({ record }) => record);
}

export function readActivationResultView(url: URL): ActivationResultView {
  const params = url.searchParams;
  const date = params.get("results-date");
  const mode = params.get("results-mode");
  const outcome = params.get("results-outcome");
  const sort = params.get("results-sort");
  return {
    // Keep bookmarked park searches useful without interpreting old planned
    // modes/bands as evidence filters. An explicit results-q always wins.
    query: (params.get("results-q") ?? params.get("q") ?? params.get("progress-q") ?? "").trim(),
    date: activationResultDates.some(({ value }) => value === date) ? date! : "all",
    mode: mode === "cw" || mode === "phone" || mode === "data" ? mode : "all",
    outcome: outcome === "qualifying" || outcome === "attempts" ? outcome : "all",
    sort: sort === "date-asc" || sort === "park" || sort === "callsign" || sort === "qsos-desc" ? sort : "date-desc",
  };
}

export function writeActivationResultView(url: URL, view: ActivationResultView): URL {
  const result = new URL(url.href);
  // These are earlier names for this park-search intention, not independent filters.
  result.searchParams.delete("q");
  result.searchParams.delete("progress-q");
  for (const [key, value, defaultValue] of [
    ["q", view.query.trim(), ""], ["date", view.date, "all"], ["mode", view.mode, "all"],
    ["outcome", view.outcome, "all"], ["sort", view.sort, "date-desc"],
  ]) {
    if (value === defaultValue) result.searchParams.delete(`results-${key}`);
    else result.searchParams.set(`results-${key}`, value);
  }
  return result;
}

export function filterActivationRecords(records: readonly ActivationRecord[], view: ActivationResultView): ActivationRecord[] {
  const terms = view.query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const filtered = records.filter((record) => {
    const searchable = `${record.parkReference} ${record.parkName} ${record.callsign}`.toLowerCase();
    return terms.every((term) => searchable.includes(term)) &&
      (view.date === "all" || record.qsoDate === view.date) &&
      (view.mode === "all" || record[view.mode] > 0) &&
      (view.outcome === "all" || (view.outcome === "qualifying" ? record.qualifying : !record.qualifying));
  });
  return filtered.sort((left, right) => {
    const tie = left.qsoDate.localeCompare(right.qsoDate) * -1 ||
      left.parkReference.localeCompare(right.parkReference) || left.callsign.localeCompare(right.callsign);
    switch (view.sort) {
      case "date-asc": return left.qsoDate.localeCompare(right.qsoDate) || tie;
      case "park": return left.parkName.localeCompare(right.parkName) || tie;
      case "callsign": return left.callsign.localeCompare(right.callsign) || tie;
      case "qsos-desc": return right.totalQsos - left.totalQsos || tie;
      default: return tie;
    }
  });
}

function validCount(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
