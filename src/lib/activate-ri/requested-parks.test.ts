import { describe, expect, it } from "vitest";
import { buildRequestedAgendaUrl, parseRequestedReferences, requestedAgendaStops } from "./requested-parks";
import type { PublicActivationStop } from "./types";

const known = [{ reference: "US-0513" }, { reference: "US-0514" }];

describe("requested park references", () => {
  it("normalizes, deduplicates, and sorts mixed paste delimiters", () => {
    expect(parseRequestedReferences(" us-0514; US-0513,\nus-0514\tUS-0513 ", known)).toEqual({
      references: ["US-0513", "US-0514"], invalid: [], unknown: [],
    });
    expect(parseRequestedReferences("us-0513", ["us-0513"])).toEqual({
      references: ["US-0513"], invalid: [], unknown: [],
    });
  });

  it("keeps malformed and unknown tokens explicit rather than broadening the request", () => {
    expect(parseRequestedReferences("US-0513, wrong; US-9999 US-123 wrong;US-9999", known)).toEqual({
      references: ["US-0513"], invalid: ["US-123", "WRONG"], unknown: ["US-9999"],
    });
    expect(parseRequestedReferences(" ; ,\n", known)).toEqual({ references: [], invalid: [], unknown: [] });
  });
});

describe("portable requested agenda URLs", () => {
  it("includes only requested references and allowed public filters", () => {
    const filters = new URLSearchParams({
      parks: "US-9999", scope: "remaining", token: "private-token", email: "private@example.invalid",
      q: "Block & Island", activator: "W1AW", mode: "SSB", band: "20m", timeline: "2026-09-12",
      county: "Washington County", timezone: "utc",
    });
    const url = new URL(buildRequestedAgendaUrl(
      "https://user:secret@ripota.org/private?secret=keep-out#private-fragment",
      ["us-0514", "US-0513", "US-0514"], filters,
    ));
    expect(url.origin).toBe("https://ripota.org");
    expect(url.pathname).toBe("/activate-ri-2026/schedule/");
    expect(url.username).toBe("");
    expect(url.password).toBe("");
    expect(url.hash).toBe("");
    expect(Object.fromEntries(url.searchParams)).toEqual({
      parks: "US-0513,US-0514", q: "Block & Island", activator: "W1AW", mode: "SSB", band: "20m",
      timeline: "2026-09-12", county: "Washington County", timezone: "utc",
    });
    expect(filters.get("parks")).toBe("US-9999");
  });

  it("preserves an explicitly empty selection and rejects malformed references or non-web origins", () => {
    const url = new URL(buildRequestedAgendaUrl("http://localhost:4321/", []));
    expect(url.searchParams.has("parks")).toBe(true);
    expect(url.searchParams.get("parks")).toBe("");
    expect(url.searchParams.has("scope")).toBe(false);
    expect(() => buildRequestedAgendaUrl("https://ripota.org", ["US-0513&scope=all"])).toThrow(/reference IDs/);
    expect(() => buildRequestedAgendaUrl("file:///tmp/site/", ["US-0513"])).toThrow(/HTTP/);
  });
});

describe("requested agenda stop matching", () => {
  function stop(id: string, values: Partial<PublicActivationStop> = {}): PublicActivationStop {
    return {
      id, parkReference: "US-0513", plannedDate: "2026-09-10", startTime: "23:00", endTime: "02:00",
      activatorCallsign: "W1AW", bands: ["20m"], modes: ["SSB"], publicNotes: "", status: "scheduled",
      ...values,
    };
  }

  it("keeps every requested public stop and orders by UTC start, reference, callsign, and ID", () => {
    const stops = [
      stop("following-day", { plannedDate: "2026-09-11", startTime: "04:00", endTime: "07:00" }),
      stop("overnight", { startTime: "01:00", endTime: "04:00", status: "delayed" }),
      stop("same-second-park", { parkReference: "US-0514" }),
      stop("same-w1z", { status: "completed" }),
      stop("same-aa", { activatorCallsign: "AA1AA" }),
      stop("cancelled", { status: "cancelled" }),
      stop("sample-hidden"),
      stop("other-park", { parkReference: "US-9999" }),
      stop("same-w1a"),
    ];
    const originalIds = stops.map(({ id }) => id);
    const result = requestedAgendaStops(["us-0514", "US-0513", "US-0513", "US-8888"], stops);
    expect(result.map(({ id }) => id)).toEqual([
      "same-aa", "same-w1a", "same-w1z", "same-second-park", "overnight", "following-day",
    ]);
    expect(result.find(({ id }) => id === "overnight")?.status).toBe("delayed");
    expect(result.find(({ id }) => id === "same-w1z")?.status).toBe("completed");
    expect(stops.map(({ id }) => id)).toEqual(originalIds);
    expect(requestedAgendaStops([], stops)).toEqual([]);
    expect(requestedAgendaStops(["US-8888"], stops)).toEqual([]);
  });
});
