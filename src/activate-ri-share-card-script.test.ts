import { describe, expect, it } from "vitest";

import {
  chromiumLaunchOptions,
  hashStableJson,
  normalizeParkStatusResponse,
  previewProcessOptions,
  shareCardPhaseAt,
  shareCardStatusInput,
  terminationSignalTarget,
} from "../scripts/activate-ri-2026/render-share-card.mjs";
import { activateRi2026Event } from "./data/activate-ri-2026/event";
import type { PublicPotaParkStatusSnapshot } from "./lib/activate-ri/pota-status-client";

describe("Activate RI share card renderer", () => {
  it("uses the configured Chromium channel when one is provided", () => {
    expect(
      chromiumLaunchOptions({
        PLAYWRIGHT_CHROMIUM_CHANNEL: "chrome",
      }),
    ).toEqual({ channel: "chrome" });
  });

  it("uses Playwright's default browser when no channel is configured", () => {
    expect(chromiumLaunchOptions({})).toEqual({});
  });

  it("starts the preview server in a process group on POSIX platforms", () => {
    expect(previewProcessOptions("linux")).toMatchObject({ detached: true });
    expect(terminationSignalTarget({ pid: 123 }, "linux")).toBe(-123);
  });
});

describe("share card event phases", () => {
  it.each([
    ["2026-09-09T23:59:59.999Z", "planning"],
    ["2026-09-10T00:00:00Z", "event-live"],
    ["2026-09-13T23:59:59.999Z", "event-live"],
    ["2026-09-14T00:00:00Z", "post-event"],
  ])("selects %s using the same UTC boundaries as the page", (time, phase) => {
    expect(shareCardPhaseAt(activateRi2026Event, new Date(time))).toBe(phase);
  });

  it("preserves the configured schedule phase before the soft opening", () => {
    expect(shareCardPhaseAt(
      { ...activateRi2026Event, phase: "schedule-live" },
      new Date("2026-09-09T12:00:00Z"),
    )).toBe("schedule-live");
  });
});

describe("share card status fingerprints", () => {
  it("captures the displayed totals, warning, and park colors in reference order", () => {
    const snapshot = statusResponse();
    snapshot.parks.reverse();

    expect(shareCardStatusInput(snapshot)).toEqual({
      total: 4,
      activated: 2,
      live: 1,
      warning: null,
      parks: [
        { reference: "US-0513", status: "activated", live: false },
        { reference: "US-0514", status: "activated", live: true },
        { reference: "US-10545", status: "needed", live: false },
        { reference: "US-7971", status: "scheduled", live: false },
      ],
    });
  });

  it("ignores polling timestamps, evidence details, and response ordering", () => {
    const original = statusResponse();
    const refreshed = statusResponse();
    refreshed.generatedAt = "2026-09-11T12:30:00Z";
    refreshed.lastPotaSyncAt = "2026-09-11T12:29:00Z";
    refreshed.lastSpotIngestAt = "2026-09-11T12:30:00Z";
    refreshed.parks[0].confirmation = { ...evidence, totalQsos: 35, qsosCw: 35 };
    refreshed.parks[0].confirmations = [refreshed.parks[0].confirmation];
    refreshed.parks[1].lastObservation = {
      ...refreshed.parks[1].lastObservation!,
      activeCallsign: "N1LATE",
      frequency: "7032",
      lastObservedAt: "2026-09-11T12:29:00Z",
    };
    refreshed.parks.reverse();

    expect(statusFingerprint(refreshed)).toBe(statusFingerprint(original));
  });

  it("does not regenerate when observed activity becomes POTA confirmed", () => {
    const original = statusResponse();
    const confirmed = statusResponse();
    confirmed.parks[1].status = "confirmed";
    confirmed.parks[1].confirmation = evidence;
    confirmed.parks[1].confirmations = [evidence];
    confirmed.summary.confirmed = 2;
    confirmed.summary.observedNotConfirmed = 0;
    confirmed.summary.withoutConfirmation = 2;

    expect(statusFingerprint(confirmed)).toBe(statusFingerprint(original));
  });

  it("regenerates for new activity even when the live count is unchanged", () => {
    const original = statusResponse();
    const activated = statusResponse();
    activated.parks[2].status = "observed";
    activated.parks[2].observed = true;
    activated.summary.observedNotConfirmed = 2;
    activated.summary.scheduledNotConfirmed = 0;

    expect(statusFingerprint(activated)).not.toBe(statusFingerprint(original));
  });

  it("regenerates when the live park changes despite unchanged totals", () => {
    const original = statusResponse();
    const changed = statusResponse();
    changed.parks[1].live = false;
    changed.parks[2].live = true;

    expect(shareCardStatusInput(changed).activated).toBe(2);
    expect(shareCardStatusInput(changed).live).toBe(1);
    expect(statusFingerprint(changed)).not.toBe(statusFingerprint(original));
  });

  it("regenerates when a park goes off air", () => {
    const original = statusResponse();
    const offline = statusResponse();
    offline.parks[1].live = false;

    expect(statusFingerprint(offline)).not.toBe(statusFingerprint(original));
  });

  it("regenerates for schedule changes without changing the activity totals", () => {
    const original = statusResponse();
    const scheduled = statusResponse();
    scheduled.parks[3].status = "scheduled";
    scheduled.parks[3].scheduled = true;
    scheduled.summary.scheduledNotConfirmed = 2;
    scheduled.summary.stillNeeded = 0;

    expect(statusFingerprint(scheduled)).not.toBe(statusFingerprint(original));
  });

  it("regenerates when a visible warning or the event phase changes", () => {
    const original = statusResponse();
    const delayed = statusResponse();
    delayed.stale = true;
    delayed.warning = "POTA evidence updates are delayed.";

    expect(statusFingerprint(delayed)).not.toBe(statusFingerprint(original));
    expect(statusFingerprint(original, "post-event")).not.toBe(statusFingerprint(original));
  });

  it("hashes object keys deterministically", () => {
    expect(hashStableJson({ phase: "event-live", summary: { total: 4, activated: 2 } }))
      .toBe(hashStableJson({ summary: { activated: 2, total: 4 }, phase: "event-live" }));
    expect(hashStableJson({ total: 4 })).toMatch(/^[a-f0-9]{64}$/);
  });
});

describe("share card snapshot validation", () => {
  it("accepts a complete response and preserves its metadata for capture", () => {
    const snapshot = statusResponse();
    expect(normalizeParkStatusResponse(snapshot, parkReferences)).toBe(snapshot);
  });

  const malformed: Array<[string, (valid: StatusResponse) => unknown]> = [
    ["unavailable response", () => ({ ok: false, error: "Temporarily unavailable" })],
    ["missing success indicator", ({ ok: _ok, ...rest }) => rest],
    ["invalid generation timestamp", valid => ({ ...valid, generatedAt: "not-a-date" })],
    ["empty park list", valid => ({ ...valid, parks: [] })],
    ["partial park list", valid => ({ ...valid, parks: valid.parks.slice(1) })],
    ["duplicate park reference", valid => ({
      ...valid, parks: [valid.parks[0], valid.parks[0], ...valid.parks.slice(2)],
    })],
    ["unexpected park reference", valid => ({
      ...valid, parks: valid.parks.map((park, index) => index === 0 ? { ...park, reference: "US-9999" } : park),
    })],
    ["unknown primary status", valid => ({
      ...valid, parks: valid.parks.map((park, index) => index === 0 ? { ...park, status: "finished" } : park),
    })],
    ["non-boolean live status", valid => ({
      ...valid, parks: valid.parks.map((park, index) => index === 0 ? { ...park, live: "true" } : park),
    })],
    ["negative count", valid => ({ ...valid, summary: { ...valid.summary, confirmed: -1 } })],
    ["fractional count", valid => ({ ...valid, summary: { ...valid.summary, confirmed: 1.5 } })],
    ["nonfinite count", valid => ({ ...valid, summary: { ...valid.summary, confirmed: Number.NaN } })],
    ["missing count", valid => ({ ...valid, summary: { total: 4 } })],
    ["incorrect total", valid => ({ ...valid, summary: { ...valid.summary, total: 5 } })],
    ["status totals that do not add up", valid => ({
      ...valid, summary: { ...valid.summary, observedNotConfirmed: 2 },
    })],
    ["incorrect unconfirmed count", valid => ({
      ...valid, summary: { ...valid.summary, withoutConfirmation: 2 },
    })],
    ["summary that disagrees with park statuses", valid => ({
      ...valid, summary: { ...valid.summary, confirmed: 2, observedNotConfirmed: 0, withoutConfirmation: 2 },
    })],
  ];

  it.each(malformed)("rejects %s instead of publishing misleading progress", (_name, invalid) => {
    expect(() => normalizeParkStatusResponse(invalid(statusResponse()), parkReferences)).toThrow();
  });
});

type StatusResponse = PublicPotaParkStatusSnapshot & { ok: true };

const parkReferences = ["US-0513", "US-0514", "US-7971", "US-10545"];
const evidence = {
  qsoDate: "20260911", activeCallsign: "W1AW", totalQsos: 12,
  qsosCw: 12, qsosData: 0, qsosPhone: 0,
};

function statusResponse(): StatusResponse {
  return {
    ok: true,
    generatedAt: "2026-09-11T12:00:00Z",
    lastPotaSyncAt: "2026-09-11T11:45:00Z",
    lastSpotIngestAt: "2026-09-11T12:00:00Z",
    stale: false,
    warning: null,
    eventWindow: { startDate: "2026-09-10", endDate: "2026-09-13", timezone: "UTC" },
    summary: { total: 4, confirmed: 1, observedNotConfirmed: 1, scheduledNotConfirmed: 1, stillNeeded: 1, withoutConfirmation: 3 },
    parks: parkReferences.map((reference, index) => ({
      reference, name: `Rhode Island park ${reference}`, potaUrl: `https://pota.app/#/park/${reference}`,
      status: index === 0 ? "confirmed" : index === 1 ? "observed" : index === 2 ? "scheduled" : "needed",
      live: index === 1,
      scheduled: index === 2,
      observed: index === 1,
      attemptRecorded: false,
      confirmation: index === 0 ? { ...evidence } : null,
      confirmations: index === 0 ? [{ ...evidence }] : [],
      attempts: [],
      lastObservation: index === 1 ? {
        spotDate: "2026-09-11", activeCallsign: "W1AW", lastObservedAt: "2026-09-11T11:59:00Z",
        frequency: "14062", mode: "CW", sourceLabel: "POTA", spotterCallsign: "N1TEST",
        evidenceKind: "structured_spot", declaredByReference: null,
      } : null,
    })),
  };
}

function statusFingerprint(snapshot: StatusResponse, phase = "event-live"): string {
  return hashStableJson({ phase, status: shareCardStatusInput(snapshot) });
}
