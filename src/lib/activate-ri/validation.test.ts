import { describe, expect, it } from "vitest";
import { validateRouteSubmission } from "./validation";

describe("validateRouteSubmission", () => {
  it("normalizes a valid single-stop submission", () => {
    const result = validateRouteSubmission({
      submitterCallsign: " n1rwj ",
      submitterName: "Rob Jackson",
      submitterEmail: "rob@example.com",
      submitterPhone: "",
      club: "Fidelity Amateur Radio Club",
      publicNotes: "Will spot through POTA.",
      organizerNotes: "Flexible by 30 minutes.",
      stops: [
        {
          parkReference: " us-2868 ",
          plannedDate: "2026-09-11",
          startTime: "09:00",
          endTime: "11:00",
          bands: ["40m", "20m"],
          modes: ["SSB", "CW"],
          publicNotes: "",
          organizerNotes: "",
        },
      ],
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.submitterCallsign).toBe("N1RWJ");
      expect(result.value.submitterEmail).toBe("rob@example.com");
      expect(result.value.stops[0]).toEqual(
        expect.objectContaining({
          parkReference: "US-2868",
          plannedDate: "2026-09-11",
          startTime: "09:00",
          endTime: "11:00",
          bands: ["40m", "20m"],
          modes: ["SSB", "CW"],
        }),
      );
    }
  });

  it("rejects invalid callsigns, emails, dates, times, and empty stops", () => {
    const result = validateRouteSubmission({
      submitterCallsign: "not a call sign!",
      submitterName: "",
      submitterEmail: "not-email",
      stops: [
        {
          parkReference: "US-999999",
          plannedDate: "2026-09-14",
          startTime: "14:00",
          endTime: "13:00",
          bands: [],
          modes: [],
        },
      ],
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors).toEqual(
        expect.arrayContaining([
          "Enter a valid activator callsign.",
          "Enter the activator name.",
          "Enter a valid email address.",
          "Stop 1 must use a known Rhode Island POTA reference.",
          "Stop 1 date must be September 10-13, 2026.",
          "Stop 1 end time must be after start time.",
          "Stop 1 needs at least one planned band.",
          "Stop 1 needs at least one planned mode.",
        ]),
      );
    }
  });
});
