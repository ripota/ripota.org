import { describe, expect, it } from "vitest";
import {
  defaultLiveSpotsSort,
  formatSpotSource,
  readLiveSpotsSort,
  sortLiveSpots,
  writeLiveSpotsSort,
  type LiveSpotsSortColumn,
  type LiveSpotsSortDirection,
} from "./live-spots-view";
import type { LivePotaSpot } from "./spots";

function spot(id: string, overrides: Partial<LivePotaSpot> = {}): LivePotaSpot {
  return {
    id,
    parkReference: "US-2874",
    parkName: "Fort Adams State Park",
    activatorCallsign: "K1RI",
    frequency: "14250",
    mode: "SSB",
    spotTime: "2026-09-11T14:00:00Z",
    spotterCallsign: "K1NW",
    comments: "",
    sourceLabel: "Web",
    upstreamCount: null,
    locationDesc: "US-RI",
    expiresInSeconds: 300,
    parkUrl: "https://pota.app/#/park/US-2874",
    spotsUrl: "https://pota.app/",
    ...overrides,
  };
}

const columns: LiveSpotsSortColumn[] = ["park", "activator", "frequency", "mode", "spotted", "source"];
const directions: LiveSpotsSortDirection[] = ["asc", "desc"];

describe("live spot sort URL state", () => {
  it("defaults to the most recently spotted first", () => {
    expect(readLiveSpotsSort(new URLSearchParams())).toEqual({ column: "spotted", direction: "desc" });
  });

  it.each([
    ["sort=invalid&direction=asc", { column: "spotted", direction: "asc" }],
    ["sort=frequency&direction=invalid", { column: "frequency", direction: "desc" }],
    ["sort=&direction=", defaultLiveSpotsSort],
    ["sort=PARK&direction=ASC", defaultLiveSpotsSort],
  ])("validates each parameter independently: %s", (query, expected) => {
    expect(readLiveSpotsSort(new URLSearchParams(query))).toEqual(expected);
  });

  it.each(columns.flatMap((column) => directions.map((direction) => ({ column, direction }))))(
    "round trips $column $direction and omits individual defaults",
    (sort) => {
      const url = writeLiveSpotsSort(new URL("https://ripota.org/on-air/"), sort);
      expect(readLiveSpotsSort(url.searchParams)).toEqual(sort);
      expect(url.searchParams.get("sort")).toBe(sort.column === "spotted" ? null : sort.column);
      expect(url.searchParams.get("direction")).toBe(sort.direction === "desc" ? null : sort.direction);
    },
  );

  it("copies the URL, replaces repeated sort state, and preserves other parameters and the anchor", () => {
    const original = new URL("https://ripota.org/on-air/?tag=one&sort=mode&tag=two&sort=park&direction=asc&direction=desc#spots");
    const unchanged = original.href;
    const next = writeLiveSpotsSort(original, { column: "frequency", direction: "asc" });

    expect(next).not.toBe(original);
    expect(original.href).toBe(unchanged);
    expect(next.searchParams.getAll("tag")).toEqual(["one", "two"]);
    expect(next.searchParams.getAll("sort")).toEqual(["frequency"]);
    expect(next.searchParams.getAll("direction")).toEqual(["asc"]);
    expect(next.hash).toBe("#spots");
    expect(next.pathname).toBe("/on-air/");

    const reset = writeLiveSpotsSort(next, defaultLiveSpotsSort);
    expect(reset.href).toBe("https://ripota.org/on-air/?tag=one&tag=two#spots");
    expect(readLiveSpotsSort(reset.searchParams)).toEqual(defaultLiveSpotsSort);
  });
});

describe("sortLiveSpots", () => {
  const textCases: Array<{
    column: LiveSpotsSortColumn;
    values: Partial<LivePotaSpot>[];
  }> = [
    {
      column: "park",
      values: [
        { parkReference: "US-10002", parkName: "Alpha Park" },
        { parkReference: "us-10002", parkName: "beta 2 Park" },
        { parkReference: "US-10002", parkName: "Beta 10 Park" },
        { parkReference: "US-10010", parkName: "Alpha Park" },
      ],
    },
    {
      column: "activator",
      values: [{ activatorCallsign: "k1aa" }, { activatorCallsign: "K2AA" }, { activatorCallsign: "K10AA" }],
    },
    {
      column: "mode",
      values: [{ mode: "cw" }, { mode: "FT8" }, { mode: "ft10" }, { mode: "SSB" }],
    },
    {
      column: "source",
      values: [
        { spotterCallsign: "K2AA", sourceLabel: "web 2" },
        { spotterCallsign: "k2aa", sourceLabel: "Web 10" },
        { spotterCallsign: "K10AA", sourceLabel: "RBN" },
        { spotterCallsign: "", sourceLabel: "Web" },
      ],
    },
  ];

  it.each(textCases)("sorts visible $column values naturally without regard to case", ({ column, values }) => {
    const ascending = values.map((value, index) => spot(String(index), value));
    const input = [...ascending].reverse();

    expect(sortLiveSpots(input, { column, direction: "asc" })).toEqual(ascending);
    expect(sortLiveSpots(ascending, { column, direction: "desc" })).toEqual(input);
  });

  it("orders frequencies numerically, including decimal values", () => {
    const input = [
      spot("20m", { frequency: "14250" }),
      spot("40m", { frequency: " 7057.5 " }),
      spot("10m", { frequency: "28000" }),
      spot("40m-low", { frequency: "7057.05" }),
    ];
    expect(sortLiveSpots(input, { column: "frequency", direction: "asc" }).map(({ id }) => id))
      .toEqual(["40m-low", "40m", "20m", "10m"]);
    expect(sortLiveSpots(input, { column: "frequency", direction: "desc" }).map(({ id }) => id))
      .toEqual(["10m", "20m", "40m", "40m-low"]);
  });

  it("sorts chronologically across dates and offsets, interpreting unzoned timestamps as UTC", () => {
    const input = [
      spot("new-day", { spotTime: "2026-09-12T00:01:00Z" }),
      spot("early", { spotTime: "2026-09-11T23:55:00+01:00" }),
      spot("utc", { spotTime: "2026-09-11T23:00:00" }),
      spot("negative-offset", { spotTime: "2026-09-11T19:30:00-0400" }),
      spot("late", { spotTime: "2026-09-11T23:59:00Z" }),
    ];
    expect(sortLiveSpots(input, { column: "spotted", direction: "asc" }).map(({ id }) => id))
      .toEqual(["early", "utc", "negative-offset", "late", "new-day"]);
    expect(sortLiveSpots(input, defaultLiveSpotsSort).map(({ id }) => id))
      .toEqual(["new-day", "late", "negative-offset", "utc", "early"]);
  });

  const missingCases: Array<{ column: LiveSpotsSortColumn; missing: Partial<LivePotaSpot>[] }> = [
    { column: "park", missing: [{ parkReference: "", parkName: "  " }] },
    { column: "activator", missing: [{ activatorCallsign: "  " }] },
    { column: "mode", missing: [{ mode: "" }] },
    { column: "source", missing: [{ spotterCallsign: " ", sourceLabel: " " }] },
    {
      column: "frequency",
      missing: ["", " ", "unknown", "14000 kHz", "Infinity", "0xAB", "-50", "0"]
        .map((frequency) => ({ frequency })),
    },
    { column: "spotted", missing: ["", " ", "not a timestamp"].map((spotTime) => ({ spotTime })) },
  ];

  it.each(missingCases)("keeps missing or invalid $column values last in either direction", ({ column, missing }) => {
    const invalid = missing.map((value, index) => spot(`invalid-${index}`, value));
    const valid = spot("valid");
    for (const direction of directions) {
      expect(sortLiveSpots([...invalid, valid], { column, direction })).toEqual([valid, ...invalid]);
    }
  });

  it.each(columns)("preserves ties and does not mutate the input when sorting %s", (column) => {
    const first = Object.freeze(spot("first"));
    const second = Object.freeze(spot("second"));
    const input = Object.freeze([second, first]);

    for (const direction of directions) {
      const sorted = sortLiveSpots(input, { column, direction });
      expect(sorted).not.toBe(input);
      expect(sorted).toEqual([second, first]);
      expect(sorted[0]).toBe(second);
      expect(input).toEqual([second, first]);
    }
  });

  it("preserves ties between differently formatted frequencies and equivalent timestamps", () => {
    const first = spot("first", { frequency: "14000.0", spotTime: "2026-09-11T14:00:00" });
    const second = spot("second", { frequency: "14000", spotTime: "2026-09-11T10:00:00-04:00" });
    const input = [first, second];
    for (const column of ["frequency", "spotted"] as const) {
      for (const direction of directions) {
        expect(sortLiveSpots(input, { column, direction })).toEqual(input);
      }
    }
  });
});

describe("formatSpotSource", () => {
  it.each([
    ["K1NW", "Web", "by K1NW via Web"],
    ["K1NW", "", "by K1NW"],
    ["", "RBN", "via RBN"],
    ["", "", ""],
    [" ", " ", ""],
  ])("formats spotter %s and source %s", (spotterCallsign, sourceLabel, expected) => {
    expect(formatSpotSource(spot("source", { spotterCallsign, sourceLabel }))).toBe(expected);
  });
});
