import { describe, expect, it } from "vitest";
import { routeRowsToPublicStops } from "./public-export";

describe("routeRowsToPublicStops", () => {
  it("exports only public-safe scheduled stop fields", () => {
    const stops = routeRowsToPublicStops([
      {
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
      },
    ]);

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
});
