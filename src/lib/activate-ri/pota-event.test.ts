import { describe, expect, it } from "vitest";
import {
  deriveParkPotaStatus,
  isHistoryReconciliationTime,
  isSpotCaptureTime,
  normalizePotaActivationHistory,
  spotToEventObservation,
  summarizeParkPotaStatuses,
  type ParkPotaFacts,
} from "./pota-event";
import type { LivePotaSpot } from "../pota/spots";

describe("Activate RI POTA history", () => {
  it("keeps only valid RI event rows and does not combine callsigns", () => {
    const rows = normalizePotaActivationHistory([
      history("N1AAA", "20260910", 6),
      history("N1BBB", "20260910", 5),
      history("N1CCC", "20260911", 10),
      history("N1OUT", "20260911", 40, "US-MD"),
      history("N1LATE", "20260914", 20),
      { ...history("N1BAD", "20260912", 20), totalQSOs: "twenty" },
    ], "US-4582");

    expect(rows).toHaveLength(3);
    expect(rows.filter((row) => row.qualifying).map((row) => row.activatorCallsign)).toEqual(["N1CCC"]);
    expect(rows.filter((row) => !row.qualifying)).toHaveLength(2);
  });

  it("deduplicates a source row by date and normalized callsign", () => {
    const rows = normalizePotaActivationHistory([
      history("n1abc", "20260912", 8),
      history("N1ABC", "20260912", 12),
    ], "US-0513");
    expect(rows).toEqual([expect.objectContaining({ activatorCallsign: "N1ABC", totalQsos: 12, qualifying: true })]);
  });

  it("rejects a malformed top-level payload", () => {
    expect(() => normalizePotaActivationHistory({}, "US-0513")).toThrow(/array/);
  });
});

describe("Activate RI POTA status", () => {
  const facts = (overrides: Partial<ParkPotaFacts>): ParkPotaFacts => ({
    scheduled: false,
    live: false,
    observations: [],
    activations: [],
    ...overrides,
  });

  it("uses confirmation, observation/attempt, schedule, needed precedence with an independent live overlay", () => {
    const confirmed = deriveParkPotaStatus(facts({ scheduled: true, live: true, observations: [observation()], activations: [activation(true)] }));
    const attempted = deriveParkPotaStatus(facts({ scheduled: true, activations: [activation(false)] }));
    const observed = deriveParkPotaStatus(facts({ observations: [observation()] }));
    const scheduled = deriveParkPotaStatus(facts({ scheduled: true }));
    const needed = deriveParkPotaStatus(facts({}));
    expect([confirmed.status, attempted.status, observed.status, scheduled.status, needed.status]).toEqual([
      "confirmed", "observed", "observed", "scheduled", "needed",
    ]);
    expect(confirmed.live).toBe(true);
    expect(summarizeParkPotaStatuses([confirmed, attempted, observed, scheduled, needed])).toEqual({
      total: 5,
      confirmed: 1,
      observedNotConfirmed: 2,
      scheduledNotConfirmed: 1,
      stillNeeded: 1,
      withoutConfirmation: 4,
    });
  });

  it("uses exact UTC event and reconciliation boundaries", () => {
    expect(isSpotCaptureTime(new Date("2026-09-10T00:00:00Z"))).toBe(true);
    expect(isSpotCaptureTime(new Date("2026-09-14T00:14:59Z"))).toBe(true);
    expect(isSpotCaptureTime(new Date("2026-09-14T00:15:00Z"))).toBe(false);
    expect(isHistoryReconciliationTime(new Date("2026-10-13T23:59:59Z"))).toBe(true);
    expect(isHistoryReconciliationTime(new Date("2026-10-14T00:00:00Z"))).toBe(false);
  });

  it("turns only RI event spots into persistent allowlisted observations", () => {
    expect(spotToEventObservation(liveSpot(), new Date("2026-09-11T12:01:00Z"))).toEqual(expect.objectContaining({
      parkReference: "US-7971",
      spotDate: "2026-09-11",
      activatorCallsign: "N1ABC",
      locationDesc: "US-RI",
    }));
  });
});

function history(activeCallsign: string, qso_date: string, totalQSOs: number, locationDesc = "US-RI") {
  return { activeCallsign, qso_date, totalQSOs, qsosCW: 1, qsosDATA: 2, qsosPHONE: 3, locationDesc };
}

function activation(qualifying: boolean) {
  return { parkReference: "US-0513", locationDesc: "US-RI" as const, qsoDate: "20260911", activatorCallsign: "N1ABC", totalQsos: qualifying ? 10 : 9, qsosCw: 0, qsosData: 0, qsosPhone: 10, qualifying };
}

function observation() {
  return { parkReference: "US-0513", spotDate: "2026-09-11", activatorCallsign: "N1ABC", locationDesc: "US-RI" as const, sourceSpotId: "1", observedAt: "2026-09-11T12:00:00Z", frequency: "14.074", mode: "FT8", sourceLabel: "POTA" };
}

function liveSpot(): LivePotaSpot {
  return { id: "1", parkReference: "US-7971", parkName: "Synthetic Park", activatorCallsign: "N1ABC", frequency: "14.074", mode: "FT8", spotTime: "2026-09-11T12:00:00Z", spotterCallsign: "N1XYZ", comments: "ignored", sourceLabel: "POTA", expiresInSeconds: 300, parkUrl: "https://pota.app/#/park/US-7971", spotsUrl: "https://pota.app/", locationDesc: "US-RI" };
}
