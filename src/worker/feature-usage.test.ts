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
  });
});
