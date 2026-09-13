import { describe, expect, it } from "vitest";
import type { PublicParkEvidence, PublicParkPotaStatus, PublicPotaParkStatusSnapshot } from "./pota-status-client";
import { summarizeRecap } from "./recap";

describe("event recap evidence", () => {
  it("defaults to the 61-park 2026 roster even when API parks are missing or added later", () => {
    expect(summarizeRecap(snapshot([]))).toMatchObject({
      totalParks: 61, confirmedParks: 0, observedParks: 0, activationCount: 0,
    });
    const result = summarizeRecap(snapshot([
      park("US-0513", { confirmations: [evidence("N1EVENT", 10)] }),
      park("US-999999", {
        confirmations: [evidence("N1LATER", 500)],
        observed: true, lastObservation: observation("2026-09-11"),
      }),
    ]));
    expect(result).toEqual({
      totalParks: 61, confirmedParks: 1, observedParks: 0, activationCount: 1,
      callsigns: ["N1EVENT"], qsoCredits: 10,
      modes: { phone: 10, cw: 0, data: 0 }, repeatParks: 0,
    });
  });

  it("counts observed coverage only for historical parks with event-dated evidence", () => {
    const result = summarizeRecap(snapshot([
      park("US-0513", { observed: true, lastObservation: observation("2026-09-14") }),
      park("US-999999", { observed: true, lastObservation: observation("2026-09-11") }),
    ]));
    expect(result).toMatchObject({ totalParks: 61, confirmedParks: 0, observedParks: 0 });
    expect(summarizeRecap(snapshot([
      park("US-0513", { observed: true, lastObservation: observation("2026-09-11") }),
    ]))).toMatchObject({ totalParks: 61, confirmedParks: 0, observedParks: 1 });
  });

  it("keeps a zero result for missing evidence and uses an explicit historical roster", () => {
    expect(summarizeFixture(snapshot([]))).toEqual({
      totalParks: 0, confirmedParks: 0, observedParks: 0, activationCount: 0,
      callsigns: [], qsoCredits: 0, modes: { phone: 0, cw: 0, data: 0 }, repeatParks: 0,
    });
    expect(summarizeFixture(snapshot([
      park("US-0001", { status: "scheduled", scheduled: true, live: true }),
      park("US-0002", { status: "confirmed", attemptRecorded: true }),
    ]))).toMatchObject({ totalParks: 2, confirmedParks: 0, observedParks: 0, activationCount: 0 });
  });

  it("counts partial uploaded results without treating attempts or observed parks as confirmations", () => {
    const result = summarizeFixture(snapshot([
      park("US-0001", {
        confirmations: [evidence(" n1bbb ", 20, { qsosCw: 5, qsosData: 3, qsosPhone: 12 })],
        observed: true, lastObservation: observation("2026-09-11"),
      }),
      park("US-0002", { attempts: [evidence("N1AAA", 4)] }),
      park("US-0003", { observed: true, lastObservation: observation("2026-09-12") }),
      park("US-0004"),
    ]));
    expect(result).toEqual({
      totalParks: 4, confirmedParks: 1, observedParks: 2, activationCount: 1,
      callsigns: ["N1AAA", "N1BBB"], qsoCredits: 24,
      modes: { phone: 16, cw: 5, data: 3 }, repeatParks: 0,
    });
  });

  it("retains N-fer credits across parks and counts repeat qualifying park/date records", () => {
    const result = summarizeFixture(snapshot([
      park("US-0001", { confirmations: [evidence("N1AAA", 10), evidence("N1AAA", 15, { qsoDate: "20260912" })] }),
      park("US-0002", { confirmations: [evidence("N1AAA", 10)] }),
    ]));
    expect(result).toMatchObject({
      confirmedParks: 2, activationCount: 3, callsigns: ["N1AAA"], qsoCredits: 35, repeatParks: 1,
    });
  });

  it("deduplicates normalized park/callsign/date records and prefers a confirmation to an attempt", () => {
    const result = summarizeFixture(snapshot([
      park("US-0001", { attempts: [evidence(" n1aaa ", 8)] }),
      park("us-0001", {
        confirmations: [evidence("N1AAA", 12), evidence(" n1aaa ", 12)],
        attempts: [evidence("N1AAA", 8)],
      }),
    ]));
    expect(result).toMatchObject({
      totalParks: 1, confirmedParks: 1, observedParks: 0,
      activationCount: 1, callsigns: ["N1AAA"], qsoCredits: 12, repeatParks: 0,
    });
  });

  it("uses inclusive event dates and ignores out-of-window history and spots", () => {
    const result = summarizeFixture(snapshot([
      park("US-0001", { confirmations: [
        evidence("N1EARLY", 10, { qsoDate: "20260910" }),
        evidence("N1LAST", 10, { qsoDate: "20260913" }),
        evidence("N1BEFORE", 100, { qsoDate: "20260909" }),
        evidence("N1AFTER", 100, { qsoDate: "20260914" }),
      ] }),
      park("US-0002", {
        observed: true, lastObservation: observation("2026-09-14"),
        attempts: [evidence("N1AFTER", 3, { qsoDate: "20260914" })],
      }),
    ]));
    expect(result).toMatchObject({
      totalParks: 2, confirmedParks: 1, observedParks: 0,
      activationCount: 2, callsigns: ["N1EARLY", "N1LAST"], qsoCredits: 20, repeatParks: 1,
    });
  });

  it("keeps zero-QSO attempts but requires a public confirmation of at least ten QSOs", () => {
    const result = summarizeFixture(snapshot([
      park("US-0001", { confirmations: [evidence("N1NINE", 9)] }),
      park("US-0002", { attempts: [evidence("N1ZERO", 0), evidence("N1TEN", 10)] }),
    ]));
    expect(result).toMatchObject({
      confirmedParks: 0, observedParks: 2, activationCount: 0,
      callsigns: ["N1NINE", "N1TEN", "N1ZERO"], qsoCredits: 19,
    });
  });

  it.each([Number.NaN, Number.POSITIVE_INFINITY, -1, 1.5, Number.MAX_SAFE_INTEGER + 1, "10", undefined])(
    "rejects an entire record containing an invalid numeric field (%s)",
    (invalid) => {
      for (const field of ["totalQsos", "qsosPhone", "qsosCw", "qsosData"] as const) {
        const result = summarizeFixture(snapshot([
          park("US-0001", { confirmations: [evidence("N1BAD", 10, { [field]: invalid } as Partial<PublicParkEvidence>)] }),
        ]));
        expect(result).toMatchObject({ confirmedParks: 0, activationCount: 0, callsigns: [], qsoCredits: 0 });
      }
    },
  );

  it("ignores malformed evidence identities and absent records", () => {
    const result = summarizeFixture(snapshot([
      park("US-0001", { confirmations: [
        evidence("", 10),
        evidence("BAD CALL", 10),
        evidence("N1BAD", 10, { qsoDate: "20260911-extra" }),
        null as unknown as PublicParkEvidence,
        {} as PublicParkEvidence,
      ] }),
    ]));
    expect(result).toMatchObject({ confirmedParks: 0, observedParks: 0, callsigns: [], qsoCredits: 0 });
  });
});

function evidence(activeCallsign: string, totalQsos: number, overrides: Partial<PublicParkEvidence> = {}): PublicParkEvidence {
  return { activeCallsign, totalQsos, qsoDate: "20260911", qsosPhone: totalQsos, qsosCw: 0, qsosData: 0, ...overrides };
}

function observation(spotDate: string): NonNullable<PublicParkPotaStatus["lastObservation"]> {
  return {
    spotDate, activeCallsign: "N1SPOT", lastObservedAt: `${spotDate}T12:00:00Z`,
    frequency: "14.060", mode: "CW", sourceLabel: "POTA", spotterCallsign: "N1HUNT",
    evidenceKind: "structured_spot", declaredByReference: null,
  };
}

function park(reference: string, overrides: Partial<PublicParkPotaStatus> = {}): PublicParkPotaStatus {
  return {
    reference, name: "Synthetic Park", potaUrl: `https://pota.app/#/park/${reference}`,
    status: "needed", live: false, scheduled: false, observed: false, attemptRecorded: false,
    confirmation: null, confirmations: [], attempts: [], lastObservation: null, ...overrides,
  };
}

function snapshot(parks: PublicParkPotaStatus[]): PublicPotaParkStatusSnapshot {
  return {
    generatedAt: "2026-09-13T20:00:00Z", lastPotaSyncAt: null, lastSpotIngestAt: null,
    stale: false, warning: null,
    eventWindow: { startDate: "2026-09-10", endDate: "2026-09-13", timezone: "UTC" },
    // Deliberately unrelated: recap figures must come from the actual roster
    // and usable dated evidence rather than trusting a summary or status badge.
    summary: { total: 61, confirmed: 61, observedNotConfirmed: 0, scheduledNotConfirmed: 0, stillNeeded: 0, withoutConfirmation: 0 },
    parks,
  };
}

function summarizeFixture(value: PublicPotaParkStatusSnapshot) {
  return summarizeRecap(value, value.parks);
}
