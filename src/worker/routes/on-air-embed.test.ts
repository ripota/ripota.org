import { afterEach, describe, expect, it, vi } from "vitest";
import type { LivePotaSpot } from "../../lib/pota/spots";
import type { RiPotaSpotsSnapshot, RiPotaSpotsSnapshotResult } from "./pota";
import { handleOnAirEmbed, renderOnAirEmbed } from "./on-air-embed";

const now = new Date("2026-10-01T15:30:00Z");
const env = { DB: { prepare: vi.fn() } as unknown as D1Database };
const spot: LivePotaSpot = {
  id: "1", parkReference: "US-10545", parkName: "Hillsdale Preserve Management Area",
  activatorCallsign: "N1BS", frequency: "14052.0", mode: "CW", spotTime: "2026-10-01T15:27:00",
  spotterCallsign: "W1AW", comments: "", sourceLabel: "POTA", upstreamCount: null,
  locationDesc: "US-RI", expiresInSeconds: 300, parkUrl: "https://pota.app/#/park/US-10545", spotsUrl: "https://pota.app/",
};
const snapshot: RiPotaSpotsSnapshot = { spots: [spot], generatedAt: now.toISOString(), stale: false };
function available(): RiPotaSpotsSnapshotResult {
  return { ok: true, snapshot, fetchedAt: now.valueOf(), observedAt: now.valueOf() };
}

afterEach(() => vi.restoreAllMocks());

describe("evergreen on-air embed", () => {
  it.each(["2026-01-01T12:00:00Z", "2026-09-12T12:00:00Z", "2027-01-01T12:00:00Z"])(
    "uses the same live feed at %s regardless of embedder or event phase", async date => {
      const getSnapshot = vi.fn(async () => available());
      const response = await handleOnAirEmbed(new Request("https://ripota.org/embed/on-air/K1NW/"), env, {
        getSnapshot, now: () => new Date(date),
      });
      const html = await response.text();
      expect(getSnapshot).toHaveBeenCalledOnce();
      expect(html).toContain("N1BS");
      expect(html).toContain("Hillsdale Preserve Management Area");
      expect(html).not.toContain("Activate All RI");
      expect(html).not.toContain("Event schedule");
      expect(html).toContain("14052 kHz · CW");
    },
  );

  it("renders every current spot, park counts, ages, and an attributed refresh and click target", () => {
    const html = renderOnAirEmbed({ ...snapshot, spots: [spot, { ...spot, id: "2", activatorCallsign: "W1AW" },
      { ...spot, id: "3", parkReference: "US-2870", activatorCallsign: "K1RI" }] }, { callsign: "k1nw/p", now });
    expect(html).toContain("2 Rhode Island parks spotted");
    for (const call of ["N1BS", "W1AW", "K1RI"]) expect(html).toContain(call);
    expect(html).toContain("Spotted 3m ago");
    expect(html).toContain('content="60;url=/embed/on-air/K1NW%2FP/?refresh=1"');
    expect(html).toContain('href="/embed/on-air/K1NW%2FP/?visit=1"');
    expect(html).toContain("Community-run and unofficial.");
    expect(html).toContain("Official POTA spots");
    expect(html).not.toContain("<script");
  });

  it("distinguishes quiet, stale (even empty), and unavailable feeds and retries each", () => {
    const empty = renderOnAirEmbed({ ...snapshot, spots: [] });
    const stale = renderOnAirEmbed({ ...snapshot, stale: true });
    const staleEmpty = renderOnAirEmbed({ ...snapshot, stale: true, spots: [] });
    const unavailable = renderOnAirEmbed(null);
    expect(empty).toContain("No current Rhode Island spots");
    expect(stale).toContain("Updates delayed");
    expect(stale).toContain("N1BS");
    expect(staleEmpty).toContain("Updates delayed");
    expect(staleEmpty).not.toContain("No current Rhode Island spots");
    expect(unavailable).toContain("Live status temporarily unavailable");
    for (const html of [empty, stale, staleEmpty, unavailable]) expect(html).toContain('content="60;url=');
  });

  it("escapes upstream data and never inserts raw HTML", () => {
    const html = renderOnAirEmbed({ ...snapshot, spots: [{ ...spot,
      parkName: '<img src=x onerror="alert(1)">', parkReference: 'US-1"<', activatorCallsign: "<script>bad()</script>",
      frequency: "<b>14052</b>", mode: "CW & FT8", spotTime: '" onmouseover="alert(1)',
    }] });
    expect(html).toContain("&lt;img");
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain("CW &amp; FT8");
    expect(html).toContain("Spot time unavailable");
    expect(html).not.toContain("<script>");
    expect(html).not.toContain("<img src=x");
    expect(html).not.toContain('" onmouseover="');
  });

  it("serves generic and unavailable responses with secure, iframe-compatible headers", async () => {
    const response = await handleOnAirEmbed(new Request("https://ripota.org/embed/on-air/"), env, {
      getSnapshot: async () => ({ ok: false, retryAfterSeconds: 60 }),
    });
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("content-type")).toBe("text/html; charset=utf-8");
    expect(response.headers.get("content-security-policy")).toContain("frame-ancestors 'self' https:");
    expect(response.headers.get("content-security-policy")).toContain("default-src 'none'");
    expect(response.headers.get("x-frame-options")).toBeNull();
    expect(response.headers.get("x-robots-tag")).toBe("noindex, nofollow");
    await expect(response.text()).resolves.toContain("Live status temporarily unavailable");
  });

  it("logs loads, refreshes, and clicks separately, normalizing attribution and excluding previews and HEAD", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const getSnapshot = vi.fn(async () => available());
    for (const query of ["", "?refresh=1", "?visit=1", "?preview=1", "?refresh=1&preview=1", "?visit=1&preview=1"]) {
      const response = await handleOnAirEmbed(new Request(`https://ripota.org/embed/on-air/k1nw%2Fp/${query}`), env, { getSnapshot });
      if (query.includes("visit=1")) {
        expect(response.status).toBe(302);
        const target = new URL(response.headers.get("location")!);
        expect(target.pathname).toBe("/on-air/");
        expect(target.searchParams.get("utm_content")).toBe(query.includes("preview") ? null : "K1NW/P");
      }
      if (query === "?preview=1") {
        expect(await response.text()).toContain('content="60;url=/embed/on-air/K1NW%2FP/?refresh=1&amp;preview=1"');
      }
    }
    const head = await handleOnAirEmbed(new Request("https://ripota.org/embed/on-air/K1NW/", { method: "HEAD" }), env, { getSnapshot });
    expect(await head.text()).toBe("");
    expect(getSnapshot).toHaveBeenCalledTimes(4);
    expect(log.mock.calls.map(([value]) => JSON.parse(value))).toEqual(["load", "refresh", "click"].map(action => ({
      event: "on-air-widget", action, embedder: "K1NW/P",
    })));
  });

  it("rejects bad methods and malformed paths without requesting POTA data", async () => {
    const getSnapshot = vi.fn();
    for (const [path, method, status] of [
      ["/embed/on-air/", "POST", 405], ["/embed/on-air/%ZZ/", "GET", 404], ["/embed/on-air/K1NW/extra/", "GET", 404],
    ] as const) {
      const response = await handleOnAirEmbed(new Request(`https://ripota.org${path}`, { method }), env, { getSnapshot });
      expect(response.status).toBe(status);
    }
    expect(getSnapshot).not.toHaveBeenCalled();
  });
});
