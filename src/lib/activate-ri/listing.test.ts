import { describe, expect, it } from "vitest";
import {
  filterPublicStops,
  formatActivatorModes,
  scheduleVisibleStops,
  timelineOptions,
  uniqueSortedValues,
} from "./listing";
import type { PublicActivationStop, PublicParkSummary } from "./types";

const parks: PublicParkSummary[] = [
  {
    reference: "US-2868",
    name: "Beavertail State Park",
    counties: ["Newport County"],
  },
  {
    reference: "US-2872",
    name: "Colt State Park",
    counties: ["Bristol County"],
  },
];

const stops: PublicActivationStop[] = [
  {
    id: "one",
    parkReference: "US-2868",
    plannedDate: "2026-09-10",
    startTime: "09:00",
    endTime: "12:00",
    activatorCallsign: "N1RWJ",
    bands: ["40m", "20m"],
    modes: ["CW", "SSB"],
    publicNotes: "",
    status: "scheduled",
  },
  {
    id: "two",
    parkReference: "US-2872",
    plannedDate: "2026-09-12",
    startTime: "12:00",
    endTime: "15:00",
    activatorCallsign: "K1ABC",
    bands: ["20m"],
    modes: ["SSB"],
    publicNotes: "",
    status: "scheduled",
  },
];

describe("listing helpers", () => {
  it("formats activator and modes together", () => {
    expect(formatActivatorModes(stops[0])).toBe("N1RWJ (CW, SSB)");
    expect(formatActivatorModes({ ...stops[0], modes: [] })).toBe("N1RWJ");
  });

  it("filters stops by mode, band, timeline, and county", () => {
    expect(
      filterPublicStops(stops, parks, {
        mode: "SSB",
        band: "20m",
        timeline: "main",
        county: "Bristol County",
      }).map((stop) => stop.id),
    ).toEqual(["two"]);
  });

  it("excludes cancelled stops from the public schedule rows", () => {
    expect(
      scheduleVisibleStops([
        stops[0],
        { ...stops[0], id: "cancelled", status: "cancelled" },
        stops[1],
      ]).map((stop) => stop.id),
    ).toEqual(["one", "two"]);
  });

  it("returns unique sorted option values", () => {
    expect(uniqueSortedValues([["SSB", "CW"], ["SSB"], []])).toEqual([
      "CW",
      "SSB",
    ]);
  });

  it("defines the first-pass timeline options", () => {
    expect(timelineOptions.map((option) => option.value)).toEqual([
      "all",
      "soft-start",
      "main",
      "2026-09-10",
      "2026-09-11",
      "2026-09-12",
      "2026-09-13",
    ]);
  });
});
