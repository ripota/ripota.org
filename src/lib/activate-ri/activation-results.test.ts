import { describe, expect, it } from "vitest";
import historicalParks from "../../../public/data/activate-ri-2026/parks.json";
import {
  activationRecords, defaultActivationResultView, filterActivationRecords,
  readActivationResultView, writeActivationResultView,
} from "./activation-results";
import type { PublicParkEvidence, PublicParkPotaStatus, PublicPotaParkStatusSnapshot } from "./pota-status-client";

const roster = [{ reference: "US-0001", name: "Alpha Park" }, { reference: "US-0002", name: "Beta Park" }];

describe("recorded event activations", () => {
  it("uses historical parks and names and does not turn plans, spots, or missing logs into records", () => {
    const first = historicalParks[0];
    const rows = activationRecords(snapshot([
      park(first.reference, { name: "Later name", confirmations: [evidence("N1LOG", 10)] }),
      park("US-999999", { confirmations: [evidence("N1NEW", 20)] }),
      park(historicalParks[1].reference, { live: true, scheduled: true, observed: true }),
    ]));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ parkReference: first.reference, parkName: first.name, callsign: "N1LOG" });
    expect(activationRecords(snapshot([]))).toEqual([]);
  });

  it("keeps partial and zero attempts alongside qualifying logs, with explicit UTC dates and modes", () => {
    const rows = activationRecords(snapshot([park("US-0001", {
      confirmations: [evidence(" n1aaa ", 20, { qsoDate: "20260910", qsosCw: 5, qsosPhone: 12, qsosData: 3 })],
      attempts: [evidence("N1SMALL", 3), evidence("N1ZERO", 0)],
    })]), roster);
    expect(rows).toMatchObject([
      { callsign: "N1AAA", qsoDate: "2026-09-10", qualifying: true, totalQsos: 20, cw: 5, phone: 12, data: 3 },
      { callsign: "N1SMALL", qualifying: false, totalQsos: 3 },
      { callsign: "N1ZERO", qualifying: false, totalQsos: 0 },
    ]);
  });

  it("deduplicates park/callsign/day, prefers confirmations, and retains separate multi-park credits", () => {
    const rows = activationRecords(snapshot([
      park("us-0001", { attempts: [evidence(" n1aaa ", 8)] }),
      park("US-0001", { confirmations: [evidence("N1AAA", 12), evidence(" n1aaa ", 12), evidence("N1AAA", 15, { qsoDate: "20260913" })] }),
      park("US-0002", { confirmations: [evidence("N1AAA", 12)] }),
    ]), roster);
    expect(rows).toHaveLength(3);
    expect(rows.map(({ totalQsos }) => totalQsos)).toEqual([12, 15, 12]);
    expect(new Set(rows.map(({ id }) => id)).size).toBe(3);
  });

  it("requires a confirmation of at least ten QSOs and ignores out-of-window or malformed identities", () => {
    const rows = activationRecords(snapshot([park("US-0001", {
      confirmations: [evidence("N1NINE", 9), evidence("N1BEFORE", 100, { qsoDate: "20260909" }), evidence("N1AFTER", 100, { qsoDate: "20260914" }), evidence("BAD CALL", 10), evidence("N1BAD", 10, { qsoDate: "20260911junk" })],
      attempts: [evidence("N1TEN", 10)],
    })]), roster);
    expect(rows.map(({ callsign, qualifying }) => [callsign, qualifying])).toEqual([["N1NINE", false], ["N1TEN", false]]);
  });

  it.each([Number.NaN, Number.POSITIVE_INFINITY, -1, 1.5, Number.MAX_SAFE_INTEGER + 1])("rejects invalid counts (%s) in any numeric field", (invalid) => {
    for (const field of ["totalQsos", "qsosCw", "qsosPhone", "qsosData"]) {
      expect(activationRecords(snapshot([park("US-0001", { confirmations: [evidence("N1BAD", 10, { [field]: invalid })] })]), roster)).toEqual([]);
    }
  });
});

describe("activation record filters", () => {
  const rows = activationRecords(snapshot([
    park("US-0001", { confirmations: [evidence("N1ZED", 40, { qsoDate: "20260913", qsosCw: 5 }), evidence("N1ALPHA", 30, { qsoDate: "20260910", qsosData: 10 })] }),
    park("US-0002", { confirmations: [evidence("N1ALPHA", 15, { qsosCw: 15, qsosPhone: 0 })], attempts: [evidence("N1TRY", 2)] }),
  ]), roster);

  it("combines case-insensitive park/callsign terms with exact UTC date, mode and result filters", () => {
    const view = { ...defaultActivationResultView, query: "beta n1alpha", date: "2026-09-11", mode: "cw" as const, outcome: "qualifying" as const };
    expect(filterActivationRecords(rows, view).map(({ callsign }) => callsign)).toEqual(["N1ALPHA"]);
    expect(filterActivationRecords(rows, { ...view, mode: "phone" })).toEqual([]);
    expect(filterActivationRecords(rows, { ...defaultActivationResultView, outcome: "attempts" }).map(({ callsign }) => callsign)).toEqual(["N1TRY"]);
  });

  it("sorts deterministically without mutating the source", () => {
    const original = rows.map(({ id }) => id);
    expect(filterActivationRecords(rows, defaultActivationResultView).map(({ totalQsos }) => totalQsos)).toEqual([40, 15, 2, 30]);
    expect(filterActivationRecords(rows, { ...defaultActivationResultView, sort: "date-asc" }).map(({ totalQsos }) => totalQsos)).toEqual([30, 15, 2, 40]);
    expect(filterActivationRecords(rows, { ...defaultActivationResultView, sort: "qsos-desc" }).map(({ totalQsos }) => totalQsos)).toEqual([40, 30, 15, 2]);
    expect(filterActivationRecords(rows, { ...defaultActivationResultView, sort: "park" }).map(({ parkName }) => parkName)).toEqual(["Alpha Park", "Alpha Park", "Beta Park", "Beta Park"]);
    expect(filterActivationRecords(rows, { ...defaultActivationResultView, sort: "callsign" }).map(({ callsign }) => callsign)).toEqual(["N1ALPHA", "N1ALPHA", "N1TRY", "N1ZED"]);
    expect(rows.map(({ id }) => id)).toEqual(original);
  });

  it("round trips all controls while preserving unrelated parameters and anchors", () => {
    const view = { query: " N1ALPHA ", date: "2026-09-11", mode: "cw" as const, outcome: "qualifying" as const, sort: "qsos-desc" as const };
    const url = writeActivationResultView(new URL("https://example.test/parks/?source=recap&mode=SSB&band=40m#park-results"), view);
    expect(readActivationResultView(url)).toEqual({ ...view, query: "N1ALPHA" });
    expect(url.searchParams.get("mode")).toBe("SSB");
    expect(url.searchParams.get("band")).toBe("40m");
    expect(url.searchParams.get("source")).toBe("recap");
    expect(url.hash).toBe("#park-results");
    expect(writeActivationResultView(url, defaultActivationResultView).search).toBe("?source=recap&mode=SSB&band=40m");
  });

  it("migrates old park searches, gives explicit results search precedence, and normalizes invalid defaults", () => {
    for (const alias of ["q", "progress-q"]) {
      const url = new URL(`https://example.test/?${alias}=US-0001&results-mode=SSB&results-date=2026-09-14&results-sort=oops&results-outcome=oops`);
      const view = readActivationResultView(url);
      expect(view).toEqual({ ...defaultActivationResultView, query: "US-0001" });
      expect(writeActivationResultView(url, view).search).toBe("?results-q=US-0001");
    }
    expect(readActivationResultView(new URL("https://example.test/?results-q=&q=old&progress-q=older"))).toEqual(defaultActivationResultView);
    expect(readActivationResultView(new URL("https://example.test/?results-q=new&q=old"))).toMatchObject({ query: "new" });
  });
});

function evidence(activeCallsign: string, totalQsos: number, overrides: Partial<PublicParkEvidence> = {}): PublicParkEvidence {
  return { activeCallsign, totalQsos, qsoDate: "20260911", qsosPhone: totalQsos, qsosCw: 0, qsosData: 0, ...overrides };
}
function park(reference: string, overrides: Partial<PublicParkPotaStatus> = {}): PublicParkPotaStatus {
  return { reference, name: "Current catalog name", potaUrl: "https://pota.app/", status: "needed", live: false, scheduled: false, observed: false, attemptRecorded: false, confirmation: null, confirmations: [], attempts: [], lastObservation: null, ...overrides };
}
function snapshot(parks: PublicParkPotaStatus[]): PublicPotaParkStatusSnapshot {
  return { generatedAt: "2026-09-15T12:00:00Z", lastPotaSyncAt: null, lastSpotIngestAt: null, stale: false, warning: null, eventWindow: { startDate: "2026-09-10", endDate: "2026-09-13", timezone: "UTC" }, summary: { total: 61, confirmed: 0, observedNotConfirmed: 0, scheduledNotConfirmed: 0, stillNeeded: 61, withoutConfirmation: 61 }, parks };
}
