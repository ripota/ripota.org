import { describe, expect, it } from "vitest";
import { deriveParkCoverage } from "./coverage";
import type { PublicActivationStop } from "./types";

const park = { reference: "US-2868", name: "Beavertail State Park" };

describe("deriveParkCoverage", () => {
  it("marks parks with no stops as uncovered", () => {
    expect(deriveParkCoverage([park], [])).toEqual([
      expect.objectContaining({
        reference: "US-2868",
        status: "uncovered",
        scheduledStopCount: 0,
        cancelledStopCount: 0,
        nextStop: null,
      }),
    ]);
  });

  it("marks multiple scheduled stops and picks the next chronological stop", () => {
    const stops: PublicActivationStop[] = [
      {
        id: "late",
        parkReference: "US-2868",
        plannedDate: "2026-09-12",
        startTime: "14:00",
        endTime: "16:00",
        activatorCallsign: "K1ABC",
        bands: ["20m"],
        modes: ["SSB"],
        publicNotes: "",
        status: "scheduled",
      },
      {
        id: "early",
        parkReference: "US-2868",
        plannedDate: "2026-09-11",
        startTime: "09:00",
        endTime: "11:00",
        activatorCallsign: "N1RWJ",
        bands: ["40m"],
        modes: ["CW"],
        publicNotes: "",
        status: "scheduled",
      },
    ];

    expect(deriveParkCoverage([park], stops)).toEqual([
      expect.objectContaining({
        status: "multiple-scheduled",
        scheduledStopCount: 2,
        nextStop: expect.objectContaining({ id: "early" }),
      }),
    ]);
  });

  it("marks cancellation as a replacement gap when no scheduled stop remains", () => {
    const stops: PublicActivationStop[] = [
      {
        id: "cancelled",
        parkReference: "US-2868",
        plannedDate: "2026-09-11",
        startTime: "09:00",
        endTime: "11:00",
        activatorCallsign: "N1RWJ",
        bands: ["40m"],
        modes: ["CW"],
        publicNotes: "Cancelled due to access.",
        status: "cancelled",
      },
    ];

    expect(deriveParkCoverage([park], stops)).toEqual([
      expect.objectContaining({
        status: "cancelled-needs-replacement",
        scheduledStopCount: 0,
        cancelledStopCount: 1,
      }),
    ]);
  });
});
