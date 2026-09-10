import { afterEach, describe, expect, it } from "vitest";
import { parseAnalyticsEvent } from "../lib/analytics/events";
import { persistAnonymousAnalyticsEvent, recordAnalyticsIngestionOutcome } from "./analytics-archive";
import { createMigratedSqliteD1 } from "./test-utils/sqlite-d1";

const databases: ReturnType<typeof createMigratedSqliteD1>[] = [];
afterEach(() => databases.splice(0).forEach((db) => db.close()));
const receipt = "2026-09-10T14:00:00.000Z";
function setup() {
  const context = createMigratedSqliteD1();
  databases.push(context);
  return context.DB;
}
function legacyEvent() {
  return parseAnalyticsEvent({
    schemaVersion: 1, scope: "activate-ri-2026", name: "hunter_checklist_resumed",
    anonymousId: "11111111-1111-4111-8111-111111111111",
  })!;
}

describe("durable anonymous evidence", () => {
  it("stores only the HMAC subject and validated properties, with receipt-time legacy provenance", async () => {
    const db = setup();
    expect(await persistAnonymousAnalyticsEvent(db, legacyEvent(), "hashed-subject", receipt)).toBe(true);
    const row = await db.prepare("SELECT * FROM analytics_anonymous_events").first();
    expect(row).toMatchObject({subject_hash: "hashed-subject", occurred_at: receipt,
      received_at: receipt, clock_skewed: 0, schema_version: 1, properties_json: "{}"});
    expect(JSON.stringify(row)).not.toContain(legacyEvent().anonymousId);
  });

  it("deduplicates retries per browser without suppressing another browser's event", async () => {
    const db = setup();
    const event = parseAnalyticsEvent({ ...legacyEvent(), schemaVersion: 2,
      eventId: "22222222-2222-4222-8222-222222222222", occurredAt: receipt })!;
    expect(event).not.toBeNull();
    expect(await persistAnonymousAnalyticsEvent(db, event, "first", receipt)).toBe(true);
    expect(await persistAnonymousAnalyticsEvent(db, event, "first", receipt)).toBe(false);
    expect(await persistAnonymousAnalyticsEvent(db, event, "second", receipt)).toBe(true);
    expect(await db.prepare("SELECT COUNT(*) AS count FROM analytics_anonymous_events").first()).toEqual({ count: 2 });
  });

  it("preserves skewed source time without using it as the authoritative receipt", async () => {
    const db = setup();
    const event = parseAnalyticsEvent({ ...legacyEvent(), schemaVersion: 2,
      eventId: "22222222-2222-4222-8222-222222222222", occurredAt: "2026-09-09T14:00:00.000Z" })!;
    expect(event).not.toBeNull();
    await persistAnonymousAnalyticsEvent(db, event, "subject", receipt);
    expect(await db.prepare("SELECT clock_skewed, received_at FROM analytics_anonymous_events").first())
      .toEqual({ clock_skewed: 1, received_at: receipt });
    await recordAnalyticsIngestionOutcome(db, "accepted", receipt);
    await recordAnalyticsIngestionOutcome(db, "accepted", receipt);
    await recordAnalyticsIngestionOutcome(db, "duplicate", receipt);
    expect((await db.prepare("SELECT outcome, count FROM analytics_ingestion_daily ORDER BY outcome").all()).results)
      .toEqual([{ outcome: "accepted", count: 2 }, { outcome: "duplicate", count: 1 }]);
  });
});
