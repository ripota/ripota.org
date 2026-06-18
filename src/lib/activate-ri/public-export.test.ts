import { describe, expect, it } from "vitest";
import {
  parseStringArray,
  routeRowsToPublicStops,
  routeRowsToPublicStopsStrict,
} from "./public-export";

const validRow = {
  id: "stop-1",
  park_reference: "US-2868",
  start_at: "2026-09-11T09:00:00.000Z",
  end_at: "2026-09-11T11:00:00.000Z",
  submitter_callsign: "N1RWJ",
  submitter_email: "private@example.com",
  submitter_phone: "555-0100",
  club: "Private Club",
  bands_json: "[\"40m\",\"20m\"]",
  modes_json: "[\"SSB\"]",
  public_notes: "Will spot through POTA.",
  organizer_notes: "Private note",
  status: "scheduled",
};

describe("routeRowsToPublicStops", () => {
  it("exports only public-safe scheduled stop fields", () => {
    const stops = routeRowsToPublicStops([validRow]);

    expect(stops).toEqual([
      {
        id: "stop-1",
        parkReference: "US-2868",
        plannedDate: "2026-09-11",
        startTime: "09:00",
        endTime: "11:00",
        activatorCallsign: "N1RWJ",
        bands: ["40m", "20m"],
        modes: ["SSB"],
        publicNotes: "Will spot through POTA.",
        status: "scheduled",
      },
    ]);
    expect(JSON.stringify(stops)).not.toMatch(/private|555|Organizer|Private Club/i);
  });

  it("does not export pending-review rows", () => {
    expect(routeRowsToPublicStops([{ ...validRow, status: "pending-review" }])).toEqual(
      [],
    );
  });

  it("does not export rows with invalid statuses", () => {
    expect(routeRowsToPublicStops([{ ...validRow, status: "published" }])).toEqual([]);
  });

  it("does not export rows with malformed required scalar fields", () => {
    expect(
      routeRowsToPublicStops([
        { ...validRow, id: 42 },
        { ...validRow, park_reference: null },
        { ...validRow, start_at: undefined },
        { ...validRow, end_at: { value: "2026-09-11T11:00:00.000Z" } },
        { ...validRow, submitter_callsign: false },
        { ...validRow, bands_json: ["40m"] },
        { ...validRow, modes_json: 20 },
      ]),
    ).toEqual([]);
  });

  it("exports valid public rows and keeps public notes null-safe", () => {
    const stops = routeRowsToPublicStops([
      { ...validRow, id: "scheduled", status: "scheduled", public_notes: null },
      { ...validRow, id: "delayed", status: "delayed", public_notes: undefined },
      { ...validRow, id: "cancelled", status: "cancelled" },
      { ...validRow, id: "completed", status: "completed" },
    ]);

    expect(stops).toEqual([
      expect.objectContaining({ id: "scheduled", publicNotes: "", status: "scheduled" }),
      expect.objectContaining({ id: "delayed", publicNotes: "", status: "delayed" }),
      expect.objectContaining({ id: "cancelled", status: "cancelled" }),
      expect.objectContaining({ id: "completed", status: "completed" }),
    ]);
  });

  it("exports the Eastern event date for late EDT stops stored on the next UTC date", () => {
    expect(
      routeRowsToPublicStops([
        {
          ...validRow,
          start_at: "2026-09-12T01:00:00.000Z",
          end_at: "2026-09-12T04:00:00.000Z",
        },
      ]),
    ).toEqual([
      expect.objectContaining({
        plannedDate: "2026-09-11",
        startTime: "01:00",
        endTime: "04:00",
      }),
    ]);
  });

  it("returns an empty array for non-array input", () => {
    expect(routeRowsToPublicStops(null)).toEqual([]);
    expect(routeRowsToPublicStops({ results: [] })).toEqual([]);
  });
});

describe("routeRowsToPublicStopsStrict", () => {
  it("exports valid public rows", () => {
    expect(routeRowsToPublicStopsStrict([validRow])).toEqual([
      expect.objectContaining({
        id: "stop-1",
        parkReference: "US-2868",
        activatorCallsign: "N1RWJ",
      }),
    ]);
  });

  it("fails with row indexes for malformed rows", () => {
    expect(() =>
      routeRowsToPublicStopsStrict([
        validRow,
        { ...validRow, id: 42 },
        { ...validRow, modes_json: "[\"SSB\",42]" },
        { ...validRow, status: "pending-review" },
      ]),
    ).toThrowErrorMatchingInlineSnapshot(`
      [Error: Invalid public stop export rows:
      - row 1: id must be a string
      - row 2: modes_json[1] must be a string
      - row 3: status must be one of scheduled, delayed, cancelled, completed]
    `);
  });

  it("fails when the export payload rows are not an array", () => {
    expect(() => routeRowsToPublicStopsStrict({ rows: [] })).toThrow(
      "Expected public stop rows to be a JSON array.",
    );
  });
});

describe("parseStringArray", () => {
  it("returns an empty array for malformed JSON", () => {
    expect(parseStringArray("[not-json")).toEqual([]);
  });

  it("returns an empty array for non-array JSON", () => {
    expect(parseStringArray("{\"band\":\"40m\"}")).toEqual([]);
  });

  it("keeps trimmed string entries and drops empty or non-string entries", () => {
    expect(parseStringArray("[\" 40m \",\"\",42,true,{\"band\":\"20m\"},\" CW \"]")).toEqual([
      "40m",
      "CW",
    ]);
  });
});
