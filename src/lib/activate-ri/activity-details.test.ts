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
});
