import { afterEach, describe, expect, it } from "vitest";
import type { Env } from "./env";
import { recordFeatureUsage } from "./feature-usage";
import { createMigratedSqliteD1 } from "./test-utils/sqlite-d1";

let closeDatabase: (() => void) | undefined;

afterEach(() => {
  closeDatabase?.();
  closeDatabase = undefined;
});

describe("authenticated feature usage", () => {
  it("rolls repeated use up by opaque subject and feature", async () => {
    const database = createMigratedSqliteD1();
    closeDatabase = database.close;
    const env = {
      ACTIVATE_RI_EVENT_ID: "activate-ri-2026",
      ASSETS: {} as Fetcher,
      DB: database.DB,
    } satisfies Env;
    const usage = {
      scope: "activate-ri-2026",
      subjectType: "activator",
      subjectId: "opaque-activator-id",
      feature: "ops_room",
    } as const;

    await recordFeatureUsage(env, usage, new Date("2026-09-11T12:00:00Z"));
    await recordFeatureUsage(env, usage, new Date("2026-09-11T12:05:00Z"));

    const row = await env.DB.prepare(
      `SELECT scope, subject_type, subject_id, feature,
              first_used_at, last_used_at, use_count
       FROM analytics_feature_usage`,
    ).first<Record<string, string | number>>();
    expect(row).toEqual({
      scope: "activate-ri-2026",
      subject_type: "activator",
      subject_id: "opaque-activator-id",
      feature: "ops_room",
      first_used_at: "2026-09-11T12:00:00.000Z",
      last_used_at: "2026-09-11T12:05:00.000Z",
      use_count: 2,
    });
    expect((await env.DB.prepare(`SELECT occurred_at FROM analytics_feature_events ORDER BY occurred_at`).all()).results)
      .toEqual([{ occurred_at: "2026-09-11T12:00:00.000Z" }, { occurred_at: "2026-09-11T12:05:00.000Z" }]);
    expect(await env.DB.prepare(`SELECT started_at FROM analytics_collection_metadata WHERE stream = 'authenticated_events'`).first())
      .toEqual({ started_at: "2026-09-11T12:00:00.000Z" });
  });

  it("freezes legacy totals without fabricating timestamped history", async () => {
    const database = createMigratedSqliteD1({ through: "0025_ops_message_edits.sql" });
    closeDatabase = database.close;
    await database.DB.prepare(`INSERT INTO analytics_feature_usage VALUES (?, 'activator', 'legacy', 'ops_room', ?, ?, 20)`)
      .bind("activate-ri-2026", "2026-09-01T00:00:00.000Z", "2026-09-09T00:00:00.000Z").run();
    database.applyMigrationFile("0027_analytics_engagement.sql");
    const env = { ACTIVATE_RI_EVENT_ID: "activate-ri-2026", ASSETS: {} as Fetcher, DB: database.DB } satisfies Env;
    await recordFeatureUsage(env, { scope: "activate-ri-2026", subjectType: "activator", subjectId: "legacy", feature: "ops_room" });
    expect(await database.DB.prepare(`SELECT use_count FROM analytics_feature_usage_legacy`).first()).toEqual({ use_count: 20 });
    expect(await database.DB.prepare(`SELECT COUNT(*) AS count FROM analytics_feature_events`).first()).toEqual({ count: 1 });
    expect(await database.DB.prepare(`SELECT use_count FROM analytics_feature_usage`).first()).toEqual({ use_count: 21 });
  });
});
