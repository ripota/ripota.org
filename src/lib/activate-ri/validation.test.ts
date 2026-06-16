import { describe, expect, it } from "vitest";
import { validateRouteSubmission } from "./validation";

describe("validateRouteSubmission", () => {
  const validSubmission = {
    submitterCallsign: "N1RWJ",
    submitterName: "Rob Jackson",
    submitterEmail: "rob@example.com",
    stops: [
      {
        parkReference: "US-2868",
        plannedDate: "2026-09-11",
        startTime: "09:00",
        endTime: "11:00",
        bands: ["40m", "20m"],
        modes: ["SSB", "CW"],
      },
    ],
  };

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

  it("rejects non-object route submissions", () => {
    const result = validateRouteSubmission(null);

    expect(result).toEqual({
      ok: false,
      errors: ["Enter a valid route submission."],
    });
  });

  it("rejects non-object activation stops without throwing", () => {
    const result = validateRouteSubmission({
      ...validSubmission,
      stops: [null],
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors).toContain("Stop 1 must be a valid activation stop.");
    }
  });

  it("rejects non-string band and mode entries", () => {
    const result = validateRouteSubmission({
      ...validSubmission,
      stops: [
        {
          ...validSubmission.stops[0],
          bands: ["40m", 20],
          modes: ["SSB", true],
        },
      ],
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors).toEqual(
        expect.arrayContaining([
          "Stop 1 bands must be text values.",
          "Stop 1 modes must be text values.",
        ]),
      );
    }
  });

  it("rejects malformed top-level scalar fields", () => {
    const result = validateRouteSubmission({
      ...validSubmission,
      submitterCallsign: ["N1RWJ"],
      submitterEmail: { value: "rob@example.com" },
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors).toEqual(
        expect.arrayContaining(["Callsign must be text.", "Email must be text."]),
      );
    }
  });

  it("rejects malformed stop scalar fields", () => {
    const result = validateRouteSubmission({
      ...validSubmission,
      stops: [
        {
          ...validSubmission.stops[0],
          parkReference: ["US-2868"],
          plannedDate: { date: "2026-09-11" },
          startTime: ["09:00"],
          endTime: { time: "11:00" },
          publicNotes: ["Will spot through POTA."],
        },
      ],
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors).toEqual(
        expect.arrayContaining([
          "Stop 1 park reference must be text.",
          "Stop 1 date must be text.",
          "Stop 1 start time must be text.",
          "Stop 1 end time must be text.",
          "Stop 1 public notes must be text.",
        ]),
      );
    }
  });

  it("accepts undefined and null optional notes as empty strings", () => {
    const result = validateRouteSubmission({
      ...validSubmission,
      submitterPhone: null,
      club: undefined,
      publicNotes: null,
      organizerNotes: undefined,
      stops: [
        {
          ...validSubmission.stops[0],
          publicNotes: null,
          organizerNotes: undefined,
        },
      ],
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual(
        expect.objectContaining({
          submitterPhone: "",
          club: "",
          publicNotes: "",
          organizerNotes: "",
        }),
      );
      expect(result.value.stops[0]).toEqual(
        expect.objectContaining({
          publicNotes: "",
          organizerNotes: "",
        }),
      );
    }
  });

  it("accepts base US amateur callsigns", () => {
    const callsigns = ["N1RWJ", "K1NW", "KC1NDQ", "W3DRE", "K8ZFJ", "AA1ZZ"];

    for (const submitterCallsign of callsigns) {
      const result = validateRouteSubmission({
        ...validSubmission,
        submitterCallsign,
      });

      expect(result.ok, submitterCallsign).toBe(true);
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

  it("rejects non-US and portable-suffix callsigns", () => {
    const callsigns = ["1234", "ZZ1ZZ", "N1RWJ/P", "W1AW/1"];

    for (const submitterCallsign of callsigns) {
      const result = validateRouteSubmission({
        ...validSubmission,
        submitterCallsign,
      });

      expect(result.ok, submitterCallsign).toBe(false);
      if (!result.ok) {
        expect(result.errors).toContain("Enter a valid activator callsign.");
      }
    }
  });
});
