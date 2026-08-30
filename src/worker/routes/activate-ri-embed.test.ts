import { describe, expect, it, vi } from "vitest";
import type { LivePotaSpot } from "../../lib/pota/spots";
import {
  handleActivateRiEmbed,
  renderActivateRiEmbed,
} from "./activate-ri-embed";
import type { RiPotaSpotsSnapshotResult } from "./pota";

const now = new Date("2026-09-12T15:30:00.000Z");

function spot(overrides: Partial<LivePotaSpot> = {}): LivePotaSpot {
  return {
    id: "1",
    parkReference: "US-10545",
    parkName: "Hillsdale Preserve Management Area",
    activatorCallsign: "N1BS",
    frequency: "14052.0",
    mode: "CW",
    spotTime: "2026-09-12T15:27:00",
    spotterCallsign: "KW7MM-#",
    comments: "RBN 5 dB",
    sourceLabel: "RBN",
    locationDesc: "US-RI",
    expiresInSeconds: 561,
    parkUrl: "https://pota.app/#/park/US-10545",
    spotsUrl: "https://pota.app/",
    ...overrides,
  };
}

function availableResult(
  spots: LivePotaSpot[],
  stale = false,
): Extract<RiPotaSpotsSnapshotResult, { ok: true }> {
  return {
    ok: true,
    fetchedAt: now.valueOf(),
    observedAt: now.valueOf(),
    snapshot: {
      generatedAt: now.toISOString(),
      stale,
      spots,
    },
  };
}

const env = {
  DB: { prepare: vi.fn() } as unknown as D1Database,
};

describe("Activate All RI embed renderer", () => {
  it("renders the compact pre-event flyer from event configuration", () => {
    const html = renderActivateRiEmbed({ kind: "pre-event" }, now);

    expect(html).toContain("Activate All RI 2026");
    expect(html).toContain("September 11–13, 2026");
    expect(html).toContain("61 Rhode Island parks");
    expect(html).toContain("3 days");
    expect(html).toContain("/assets/logos/ri-pota-coastal-signal.svg");
    expect(html).toContain("A statewide POTA challenge");
    expect(html).toContain("Put all 61 Rhode Island parks on the air.");
    expect(html).toContain("get closer to your Worked All RI award");
    expect(html).toContain('class="pre-state" aria-hidden="true"');
    expect(html).toContain("Plan your hunt");
    expect(html).toContain("Community-run and unofficial");
    expect(html).not.toContain('http-equiv="refresh"');
    expect(html).not.toContain("<script");
  });

  it("renders at most two current spots and summarizes the remainder", () => {
    const html = renderActivateRiEmbed({
      kind: "live",
      snapshot: availableResult([
        spot(),
        spot({ id: "2", activatorCallsign: "W1AW", parkReference: "US-2870" }),
        spot({ id: "3", activatorCallsign: "K1RI", parkReference: "US-2871" }),
      ]).snapshot,
    }, now);

    expect(html).toContain('http-equiv="refresh" content="60"');
    expect(html).toContain("N1BS");
    expect(html).toContain("W1AW");
    expect(html).not.toContain("K1RI");
    expect(html).toContain("+1 more · full status");
    expect(html).toContain("Spotted 3m ago");
  });

  it("renders an intentional live empty state", () => {
    const result = availableResult([]);
    if (!result.ok) {
      throw new Error("Expected an available fixture");
    }

    const html = renderActivateRiEmbed({
      kind: "live",
      snapshot: result.snapshot,
    }, now);

    expect(html).toContain("No current Rhode Island spots");
    expect(html).toContain("Event schedule");
    expect(html).toContain("Official POTA spots");
  });

  it("distinguishes unavailable and safely stale live data", () => {
    const unavailableHtml = renderActivateRiEmbed({
      kind: "live",
      snapshot: null,
    }, now);
    const staleResult = availableResult([spot()], true);
    if (!staleResult.ok) {
      throw new Error("Expected an available fixture");
    }
    const staleHtml = renderActivateRiEmbed({
      kind: "live",
      snapshot: staleResult.snapshot,
    }, now);

    expect(unavailableHtml).toContain("Live status temporarily unavailable");
    expect(staleHtml).toContain(
      "Live status is delayed; showing the last successful update.",
    );
    expect(staleHtml).toContain("N1BS");
  });

  it("escapes every rendered field originating in spot data", () => {
    const result = availableResult([
      spot({
        activatorCallsign: '<script>alert("call")</script>',
        frequency: "<b>14052</b>",
        mode: 'CW" onmouseover="alert(1)',
        parkReference: '"><img src=x onerror=alert(1)>',
        parkName: "Rock & <em>Roll</em>",
        spotTime: '2026-09-12T15:27:00" autofocus',
      }),
    ]);
    if (!result.ok) {
      throw new Error("Expected an available fixture");
    }

    const html = renderActivateRiEmbed({
      kind: "live",
      snapshot: result.snapshot,
    }, now);

    expect(html).not.toContain('<script>alert("call")</script>');
    expect(html).not.toContain("<b>14052</b>");
    expect(html).not.toContain("<img src=x");
    expect(html).toContain("&lt;script&gt;alert(&quot;call&quot;)&lt;/script&gt;");
    expect(html).toContain("Rock &amp; &lt;em&gt;Roll&lt;/em&gt;");
    expect(html).toContain("%22%3E%3Cimg%20src%3Dx%20onerror%3Dalert(1)%3E");
  });

  it("renders a useful post-event thank-you without live language", () => {
    const html = renderActivateRiEmbed({ kind: "post-event" }, now);

    expect(html).toContain("Thank you, Rhode Island");
    expect(html).toContain("Visit the event page");
    expect(html).not.toContain("Event live");
    expect(html).not.toContain('http-equiv="refresh"');
  });
});

describe("Activate All RI embed route", () => {
  it("uses normal phase behavior for unknown previews without fetching spots", async () => {
    const getSnapshot = vi.fn();
    const response = await handleActivateRiEmbed(
      new Request("https://ripota.org/embed/activate-ri-2026/?preview=unknown"),
      env,
      { eventPhase: "planning", getSnapshot, now: () => now },
    );

    expect(response.status).toBe(200);
    expect(getSnapshot).not.toHaveBeenCalled();
    await expect(response.text()).resolves.toContain("Plan your hunt");
  });

  it("forces real live presentation for preview=live", async () => {
    const getSnapshot = vi.fn(async () => availableResult([]));
    const response = await handleActivateRiEmbed(
      new Request("https://ripota.org/embed/activate-ri-2026/?preview=live"),
      env,
      { eventPhase: "planning", getSnapshot, now: () => now },
    );

    expect(getSnapshot).toHaveBeenCalledOnce();
    await expect(response.text()).resolves.toContain(
      "No current Rhode Island spots",
    );
  });

  it("sets no-store, script-free framing headers for GET", async () => {
    const response = await handleActivateRiEmbed(
      new Request("https://ripota.org/embed/activate-ri-2026/"),
      env,
      { eventPhase: "planning", now: () => now },
    );

    expect(response.headers.get("content-type")).toBe(
      "text/html; charset=utf-8",
    );
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
    expect(response.headers.get("x-frame-options")).toBeNull();
    expect(response.headers.get("content-security-policy")).toContain(
      "frame-ancestors https:",
    );
    expect(response.headers.get("content-security-policy")).toContain(
      "default-src 'none'",
    );
  });

  it("supports HEAD with the same headers and no response body", async () => {
    const response = await handleActivateRiEmbed(
      new Request("https://ripota.org/embed/activate-ri-2026/", {
        method: "HEAD",
      }),
      env,
      { eventPhase: "post-event", now: () => now },
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe(
      "text/html; charset=utf-8",
    );
    await expect(response.text()).resolves.toBe("");
  });

  it("rejects unsupported methods", async () => {
    const response = await handleActivateRiEmbed(
      new Request("https://ripota.org/embed/activate-ri-2026/", {
        method: "POST",
      }),
      env,
    );

    expect(response.status).toBe(405);
    expect(response.headers.get("allow")).toBe("GET, HEAD");
  });
});
