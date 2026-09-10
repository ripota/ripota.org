import { describe, expect, it } from "vitest";
import {
  buildAnalyticsEngineQueries,
  authenticatedFeatureSql,
  authenticatedTotalsSql,
  anonymousDurableTotalsSql,
  parseAnalyticsReportArgs,
  renderAnalyticsReport,
  type AnalyticsReport,
} from "../../../scripts/analytics-report.ts";
import { createMigratedSqliteD1 } from "../../worker/test-utils/sqlite-d1";
import { recordFeatureUsage } from "../../worker/feature-usage";
import type { Env } from "../../worker/env";

const report: AnalyticsReport = {
  collection: { startedAt: {}, legacyFeatureUses: 20, limitations: [] },
  anonymousDurable: { events: [], interactions: 0, uniqueBrowsers: 0, hunterBrowsers: 0 },
  anonymous: {
    until: "2026-09-01T00:51:02Z",
    events: [{
      action: "open_popup",
      errorCode: "",
      eventName: "map_action",
      feature: "",
      filterCategory: "",
      firstSeen: "2026-09-01 00:34:09",
      importMethod: "",
      interactions: 7,
      lastSeen: "2026-09-01 00:35:25",
      outcome: "",
      placement: "map",
      uniqueBrowsers: 1,
    }],
    hunterBrowsers: 0,
    interactions: 8,
    uniqueBrowsers: 2,
  },
  authenticated: {
    featureOpens: 5,
    features: [{
      feature: "plan_editor",
      firstSeen: "2026-08-31T21:00:11.672Z",
      lastSeen: "2026-08-31T23:30:22.672Z",
      opens: 2,
      subjectType: "activator",
      uniqueSubjects: 2,
    }],
    uniqueActivators: 2,
  },
  generatedAt: "2026-09-01T00:51:02Z",
  knownSmokeExcluded: true,
  opsRoom: {
    activatorMessages: 0,
    activatorsWhoPosted: 0,
    foregroundActivators: 0, foregroundSamples: 0, firstDailyMessageExposures: 0, activatorsWithFirstDailyExposure: 0,
  },
  scope: "activate-ri-2026",
  since: "2026-08-31T19:34:14.000Z",
  until: "2026-09-01T00:51:02Z",
};

describe("analytics report command", () => {
  it("renders a concise human-readable summary", () => {
    const output = renderAnalyticsReport(report, false);

    expect(output).toContain("Analytics report");
    expect(output).toContain("2 browsers · 8 interactions");
    expect(output).toContain("map action");
    expect(output).toContain("action: open popup");
    expect(output).toContain("placement: map");
    expect(output).toContain("Hunter checklist: no activity yet");
    expect(output).toContain("2 activators · 5 recorded uses");
    expect(output).toContain("No activator messages during this reporting window.");
  });

  it("excludes the known production smoke event by default", () => {
    const options = parseAnalyticsReportArgs([]);
    const queries = buildAnalyticsEngineQueries(options);

    expect(queries.totals).toContain("schedule_detail_opened");
    expect(queries.totals).toContain("2026-08-31 23:17:50");
    expect(queries.totals).toContain("timestamp < toDateTime(");
  });

  it("can include smoke events for raw investigation", () => {
    const options = parseAnalyticsReportArgs(["--include-smoke"]);
    const queries = buildAnalyticsEngineQueries(options);

    expect(queries.totals).not.toContain("schedule_detail_opened");
  });

  it("normalizes override timestamps and rejects unsafe dataset names", () => {
    expect(parseAnalyticsReportArgs([
      "--since",
      "2026-09-01T00:00:00-04:00",
    ]).since).toBe("2026-09-01T04:00:00.000Z");
    expect(() => parseAnalyticsReportArgs([
      "--dataset",
      "ripota_usage; DROP TABLE events",
    ])).toThrow("Invalid dataset name");
  });

  it("normalizes both interval bounds and rejects reversed or empty windows", () => {
    const options = parseAnalyticsReportArgs(["--since", "2026-09-11T00:00:00-04:00", "--until", "2026-09-14T00:00:00-04:00"]);
    expect(options.until).toBe("2026-09-14T04:00:00.000Z");
    expect(buildAnalyticsEngineQueries(options).totals).toContain("timestamp < toDateTime('2026-09-14 04:00:00')");
    expect(() => parseAnalyticsReportArgs(["--since", "2026-09-11", "--until", "2026-09-11"])).toThrow("--until must be after --since");
  });

  it("counts only timestamped usage inside [since, until), deduplicating actors", async () => {
    const database = createMigratedSqliteD1();
    const env = { DB: database.DB, ASSETS: {} as Fetcher, ACTIVATE_RI_EVENT_ID: "activate-ri-2026" } satisfies Env;
    try {
      const usage = { scope: "activate-ri-2026", subjectType: "activator", subjectId: "test", feature: "plan_editor" } as const;
      for (const timestamp of ["2026-09-10T23:59:59Z", "2026-09-11T00:00:00Z", "2026-09-11T12:00:00Z", "2026-09-12T00:00:00Z"]) {
        await recordFeatureUsage(env, usage, new Date(timestamp));
      }
      const options = parseAnalyticsReportArgs(["--since", "2026-09-11", "--until", "2026-09-12"]);
      expect(await database.DB.prepare(authenticatedFeatureSql(options)).first()).toMatchObject({ opens: 2, unique_subjects: 1 });
      expect(await database.DB.prepare(authenticatedTotalsSql(options)).first()).toMatchObject({ feature_opens: 2, unique_activators: 1 });
    } finally { database.close(); }
  });

  it("uses receipt bounds for durable browser cohorts despite client clock skew", async () => {
    const database = createMigratedSqliteD1();
    try {
      const insert = (id: string, subject: string, event: string, received: string, props = {}) => database.DB.prepare(
        `INSERT INTO analytics_anonymous_events
          (scope, subject_hash, event_id, event_name, schema_version, occurred_at, received_at, clock_skewed, properties_json)
          VALUES ('activate-ri-2026', ?, ?, ?, 2, '2030-01-01T00:00:00.000Z', ?, 1, ?)`,
      ).bind(subject, id, event, received, JSON.stringify(props)).run();
      await insert("before", "outside", "hunter_checklist_started", "2026-09-10T23:59:59.000Z");
      await insert("first", "hunter", "hunter_checklist_started", "2026-09-11T00:00:00.000Z");
      await insert("again", "hunter", "hunter_progress_changed", "2026-09-11T12:00:00.000Z");
      await insert("cta", "visitor", "event_cta_clicked", "2026-09-11T15:00:00.000Z", { feature: "hunter_checklist" });
      await insert("end", "outside", "hunter_checklist_started", "2026-09-12T00:00:00.000Z");
      const options = parseAnalyticsReportArgs(["--since", "2026-09-11", "--until", "2026-09-12"]);
      expect(await database.DB.prepare(anonymousDurableTotalsSql(options)).first()).toEqual({ interactions: 3, unique_browsers: 2, hunter_browsers: 2 });
    } finally { database.close(); }
  });
});
