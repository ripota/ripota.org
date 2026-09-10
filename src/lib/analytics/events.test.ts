import { describe, expect, it } from "vitest";
import { parseAnalyticsEvent } from "./events";

const base = {
  schemaVersion: 2, scope: "activate-ri-2026", name: "hunter_progress_changed",
  anonymousId: "45f073b5-e599-42c1-bc56-67b766bf284c", eventId: "55f073b5-e599-42c1-bc56-67b766bf284c",
  occurredAt: "2026-09-10T12:34:56.000Z",
};

describe("analytics payload validation", () => {
  it("accepts the rendered hunter CTA action", () => {
    expect(parseAnalyticsEvent({ ...base, name: "event_cta_clicked", properties: { action: "hunter", feature: "hunter_checklist" } })).not.toBeNull();
  });

  it.each(["toString", "constructor", "__proto__"])("rejects inherited event name %s", (name) => {
    expect(parseAnalyticsEvent({ ...base, name })).toBeNull();
  });

  it("accepts bounded anonymous progress without identifiers for parks or contacts", () => {
    expect(parseAnalyticsEvent({ ...base, properties: { completedCount: 61, totalCount: 61, direction: "hunted", entryMode: "blank", persistence: "saved", pageCategory: "hunter" } })).not.toBeNull();
  });

  it.each([
    { completedCount: -1 }, { completedCount: 1.5 }, { completedCount: 1_001 },
    { completedCount: "1" }, { completedCount: 62, totalCount: 61 }, { parkReference: "US-0513" },
    { occurredAt: "2026-09-10" }, { callsign: "PRIVATE" }, { pageCategory: "/private/url" },
  ])("rejects out-of-contract properties %j", (properties) => {
    expect(parseAnalyticsEvent({ ...base, properties })).toBeNull();
  });

  it.each([
    { eventId: "not-an-id" }, { eventId: undefined }, { occurredAt: undefined },
    { occurredAt: "2026-02-31T12:00:00.000Z" }, { occurredAt: "private" },
  ])("requires a unique ID and valid occurrence timestamp for v2: %j", (overrides) => {
    expect(parseAnalyticsEvent({ ...base, ...overrides })).toBeNull();
  });

  it("keeps the original v1 payload contract working", () => {
    expect(parseAnalyticsEvent({ schemaVersion: 1, scope: base.scope, name: "hunter_checklist_resumed", anonymousId: base.anonymousId })).not.toBeNull();
  });
});
