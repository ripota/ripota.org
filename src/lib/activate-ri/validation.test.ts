import { describe, expect, it } from "vitest";
import { activateRiTimeBlocks } from "./time-blocks";
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

  it("keeps EDT submitted block values with UTC backend ranges", () => {
    expect(activateRiTimeBlocks[0]).toEqual(expect.objectContaining({
      value: "00:00-03:00",
      label: "00:00 - 03:00 EDT",
      startTime: "04:00",
      endTime: "07:00",
      easternLabel: "00:00 - 03:00 EDT",
      utcDateOffset: 0,
    }));
  });

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

  it("allows the final evening EDT block on the next UTC date", () => {
    const result = validateRouteSubmission({
      ...validSubmission,
      stops: [
        {
          parkReference: "US-2868",
          plannedDate: "2026-09-11",
          timeBlock: "21:00-24:00",
          bands: ["40m"],
          modes: ["ssb"],
        },
      ],
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.stops[0]).toEqual(
        expect.objectContaining({
          plannedDate: "2026-09-11",
          startTime: "01:00",
          endTime: "04:00",
        }),
      );
    }
  });

  it("normalizes allowed three-hour blocks to start and end times", () => {
    const result = validateRouteSubmission({
      ...validSubmission,
      stops: [
        {
          parkReference: "US-2868",
          plannedDate: "2026-09-11",
          timeBlock: "09:00-12:00",
          bands: ["40m", "20m"],
          modes: ["ssb", "cw"],
        },
        {
          parkReference: "US-2872",
          plannedDate: "2026-09-11",
          timeBlock: "12:00-15:00",
          bands: ["20m"],
          modes: ["digital"],
        },
      ],
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.stops).toEqual([
        expect.objectContaining({
          parkReference: "US-2868",
          startTime: "13:00",
          endTime: "16:00",
          modes: ["SSB", "CW"],
        }),
        expect.objectContaining({
          parkReference: "US-2872",
          startTime: "16:00",
          endTime: "19:00",
          modes: ["Digital"],
        }),
      ]);
    }
  });

  it("allows the evening EDT block that crosses UTC midnight", () => {
    const result = validateRouteSubmission({
      ...validSubmission,
      stops: [
        {
          parkReference: "US-2868",
          plannedDate: "2026-09-11",
          timeBlock: "18:00-21:00",
          bands: ["40m"],
          modes: ["ssb"],
        },
      ],
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.stops[0]).toEqual(
        expect.objectContaining({
          startTime: "22:00",
          endTime: "01:00",
        }),
      );
    }
  });

  it("rejects unsupported bands and modes", () => {
    const result = validateRouteSubmission({
      ...validSubmission,
      stops: [
        {
          ...validSubmission.stops[0],
          bands: ["40m", "11m"],
          modes: ["SSB", "AM"],
        },
      ],
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors).toEqual(
        expect.arrayContaining([
          "Stop 1 bands must use supported bands: 160m, 80m, 60m, 40m, 30m, 20m, 17m, 15m, 12m, 10m, 6m, 2m, 70cm.",
          "Stop 1 modes must use supported modes: SSB, CW, Digital.",
        ]),
      );
    }
  });

  it("rejects invalid time block values", () => {
    const result = validateRouteSubmission({
      ...validSubmission,
      stops: [
        {
          ...validSubmission.stops[0],
          startTime: undefined,
          endTime: undefined,
          timeBlock: "09:30-12:30",
        },
      ],
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors).toContain(
        "Stop 1 time block must be one of 00:00-03:00, 03:00-06:00, 06:00-09:00, 09:00-12:00, 12:00-15:00, 15:00-18:00, 18:00-21:00, 21:00-24:00 EDT.",
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
