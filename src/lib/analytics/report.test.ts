import { describe, expect, it } from "vitest";
import {
  buildAnalyticsEngineQueries,
  parseAnalyticsReportArgs,
  renderAnalyticsReport,
  type AnalyticsReport,
} from "../../../scripts/analytics-report.ts";

const report: AnalyticsReport = {
  anonymous: {
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
  },
  scope: "activate-ri-2026",
  since: "2026-08-31T19:34:14.000Z",
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
    expect(output).toContain("2 activators · 5 opens");
    expect(output).toContain("No activator messages during this reporting window.");
  });

  it("excludes the known production smoke event by default", () => {
    const options = parseAnalyticsReportArgs([]);
    const queries = buildAnalyticsEngineQueries(options);

    expect(queries.totals).toContain("schedule_detail_opened");
    expect(queries.totals).toContain("2026-08-31 23:17:50");
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
});
