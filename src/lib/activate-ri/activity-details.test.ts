import { describe, expect, it } from "vitest";
import { activityDetailEntries } from "./activity-details";

describe("activityDetailEntries", () => {
  it("ignores fields missing from one side of previous and next snapshots", () => {
    expect(activityDetailEntries({
      previous: { status: "scheduled", publicNotes: "Meet near the trailhead." },
      next: { publicNotes: "Meet near the trailhead." },
    })).toEqual([]);
  });

  it("keeps explicit cleared values in previous and next snapshots", () => {
    expect(activityDetailEntries({
      previous: { publicNotes: "Meet near the trailhead." },
      next: { publicNotes: "" },
    })).toEqual([["Public Notes", "Meet near the trailhead. -> None"]]);
  });

  it("labels admin email recipients without exposing hash terminology", () => {
    expect(activityDetailEntries({
      status: "sent",
      recipientsCount: 2,
      recipients: ["admin@example.com", "organizer@example.com"],
    })).toEqual([
      ["Status", "sent"],
      ["Recipients Count", "2"],
      ["Recipients", "admin@example.com, organizer@example.com"],
    ]);
  });

  it("summarizes added stop snapshots with activation context", () => {
    expect(activityDetailEntries({
      next: {
        id: "stop-1",
        parkReference: "US-0123",
        plannedDate: "2026-09-12",
        startTime: "14:00",
        endTime: "17:00",
        bands: ["40m", "20m"],
        modes: ["SSB"],
        publicNotes: "Meet near the trailhead.",
        organizerNotes: "",
        status: "scheduled",
      },
    })).toEqual([
      ["Park", "US-0123"],
      ["Date", "2026-09-12"],
      ["Time", "14:00 - 17:00"],
      ["Bands", "40m, 20m"],
      ["Modes", "SSB"],
      ["Status", "scheduled"],
      ["Public Notes", "Meet near the trailhead."],
    ]);
  });

  it("summarizes removed stop snapshots with activation context", () => {
    expect(activityDetailEntries({
      previous: {
        id: "stop-1",
        parkReference: "US-0456",
        plannedDate: "2026-09-13",
        startTime: "18:00",
        endTime: "21:00",
        bands: ["15m"],
        modes: ["CW", "SSB"],
        publicNotes: "",
        organizerNotes: "Coordinate parking with ranger.",
        status: "scheduled",
      },
    })).toEqual([
      ["Park", "US-0456"],
      ["Date", "2026-09-13"],
      ["Time", "18:00 - 21:00"],
      ["Bands", "15m"],
      ["Modes", "CW, SSB"],
      ["Status", "scheduled"],
      ["Organizer Notes", "Coordinate parking with ranger."],
    ]);
  });
});
