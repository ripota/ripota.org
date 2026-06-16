import { describe, expect, it } from "vitest";
import { parseStringArray, routeRowsToPublicStops } from "./public-export";

const validRow = {
  id: "stop-1",
  park_reference: "US-2868",
  planned_date: "2026-09-11",
  start_time: "09:00",
  end_time: "11:00",
  submitter_callsign: "N1RWJ",
  submitter_email: "private@example.com",
  submitter_phone: "555-0100",
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
    expect(JSON.stringify(stops)).not.toMatch(/private|555|Organizer/i);
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
        { ...validRow, planned_date: undefined },
        { ...validRow, start_time: ["09:00"] },
        { ...validRow, end_time: { value: "11:00" } },
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
