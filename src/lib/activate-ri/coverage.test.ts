import { describe, expect, it } from "vitest";
import {
  deriveParkCoverage,
  isParkVolunteerActionable,
  summarizeParkCoverage,
} from "./coverage";
import type { PublicActivationStop } from "./types";

const park = {
  reference: "US-2868",
  name: "Beavertail State Park",
  counties: ["Newport County"],
};

describe("deriveParkCoverage", () => {
  it("marks parks with no stops as uncovered", () => {
    expect(deriveParkCoverage([park], [])).toEqual([
      expect.objectContaining({
        reference: "US-2868",
        counties: ["Newport County"],
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
        stops: [
          expect.objectContaining({ id: "early" }),
          expect.objectContaining({ id: "late" }),
        ],
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

  it("marks completed stops as completed coverage without an upcoming next stop", () => {
    const stops: PublicActivationStop[] = [
      {
        id: "completed",
        parkReference: "US-2868",
        plannedDate: "2026-09-11",
        startTime: "09:00",
        endTime: "11:00",
        activatorCallsign: "N1RWJ",
        bands: ["40m"],
        modes: ["CW"],
        publicNotes: "",
        status: "completed",
      },
    ];

    expect(deriveParkCoverage([park], stops)).toEqual([
      expect.objectContaining({
        status: "completed",
        scheduledStopCount: 0,
        nextStop: null,
      }),
    ]);
  });

  it("keeps scheduled coverage when completed stops also have future active stops", () => {
    const stops: PublicActivationStop[] = [
      {
        id: "completed",
        parkReference: "US-2868",
        plannedDate: "2026-09-11",
        startTime: "09:00",
        endTime: "11:00",
        activatorCallsign: "N1RWJ",
        bands: ["40m"],
        modes: ["CW"],
        publicNotes: "",
        status: "completed",
      },
      {
        id: "future",
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
    ];

    expect(deriveParkCoverage([park], stops)).toEqual([
      expect.objectContaining({
        status: "scheduled",
        scheduledStopCount: 1,
        nextStop: expect.objectContaining({ id: "future" }),
      }),
    ]);
  });

  it("treats delayed stops as upcoming coverage and picks them over completed stops", () => {
    const stops: PublicActivationStop[] = [
      {
        id: "completed",
        parkReference: "US-2868",
        plannedDate: "2026-09-11",
        startTime: "09:00",
        endTime: "11:00",
        activatorCallsign: "N1RWJ",
        bands: ["40m"],
        modes: ["CW"],
        publicNotes: "",
        status: "completed",
      },
      {
        id: "delayed",
        parkReference: "US-2868",
        plannedDate: "2026-09-12",
        startTime: "14:00",
        endTime: "16:00",
        activatorCallsign: "K1ABC",
        bands: ["20m"],
        modes: ["SSB"],
        publicNotes: "Delayed start.",
        status: "delayed",
      },
    ];

    expect(deriveParkCoverage([park], stops)).toEqual([
      expect.objectContaining({
        status: "scheduled",
        scheduledStopCount: 1,
        nextStop: expect.objectContaining({ id: "delayed" }),
      }),
    ]);
  });

  it("summarizes scheduled parks and coverage gaps", () => {
    const parks = [
      park,
      {
        reference: "US-2869",
        name: "Brenton Point State Park",
        counties: ["Newport County"],
      },
      {
        reference: "US-2870",
        name: "Colt State Park",
        counties: ["Bristol County"],
      },
      {
        reference: "US-2871",
        name: "Fort Adams State Park",
        counties: ["Newport County"],
      },
    ];
    const stops: PublicActivationStop[] = [
      {
        id: "scheduled",
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
      {
        id: "completed",
        parkReference: "US-2869",
        plannedDate: "2026-09-11",
        startTime: "12:00",
        endTime: "14:00",
        activatorCallsign: "K1ABC",
        bands: ["20m"],
        modes: ["SSB"],
        publicNotes: "",
        status: "completed",
      },
      {
        id: "cancelled",
        parkReference: "US-2870",
        plannedDate: "2026-09-12",
        startTime: "09:00",
        endTime: "11:00",
        activatorCallsign: "W1POTA",
        bands: ["15m"],
        modes: ["FT8"],
        publicNotes: "Cancelled.",
        status: "cancelled",
      },
    ];

    expect(summarizeParkCoverage(parks, stops)).toEqual({
      scheduled: 2,
      gaps: 2,
      total: 4,
    });
  });

  it("ignores sample stops when summarizing coverage", () => {
    const stops: PublicActivationStop[] = [
      {
        id: "sample-demo",
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

    expect(summarizeParkCoverage([park], stops)).toEqual({
      scheduled: 0,
      gaps: 1,
      total: 1,
    });
  });
});

describe("isParkVolunteerActionable", () => {
  it("returns true for park coverage gaps that need activators", () => {
    expect(isParkVolunteerActionable("uncovered")).toBe(true);
    expect(isParkVolunteerActionable("cancelled-needs-replacement")).toBe(true);
  });

  it("returns false for parks that already have coverage", () => {
    expect(isParkVolunteerActionable("scheduled")).toBe(false);
    expect(isParkVolunteerActionable("multiple-scheduled")).toBe(false);
    expect(isParkVolunteerActionable("completed")).toBe(false);
  });
});
