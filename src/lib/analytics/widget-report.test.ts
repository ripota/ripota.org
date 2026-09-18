import { afterEach, describe, expect, it } from "vitest";
import { parseWidgetReportArgs, widgetReportQueries, collectWidgetReport, renderWidgetReport } from "../../../scripts/widget-analytics-report.ts";
import { buildAnalyticsEngineQueries, parseAnalyticsReportArgs } from "../../../scripts/analytics-report.ts";
import { createMigratedSqliteD1 } from "../../worker/test-utils/sqlite-d1";
import { recordWidgetRequest } from "../../worker/widget-analytics";
import { persistAnonymousAnalyticsEvent } from "../../worker/analytics-archive";
import { parseAnalyticsEvent } from "./events";

const databases: ReturnType<typeof createMigratedSqliteD1>[] = [];
afterEach(() => databases.splice(0).forEach(db => db.close()));

describe("widget analytics report", () => {
  it("defaults to 30 UTC dates including the current partial day", () => {
    expect(parseWidgetReportArgs([], new Date("2027-01-01T12:00:00Z")))
      .toMatchObject({ since: "2026-12-03", until: "2027-01-02" });
  });

  it.each([
    ["--since", "2026-02-30"], ["--since", "2026-09-18T12:00:00Z"],
    ["--until", "2026-09-18", "--since", "2026-09-18"], ["--since"], ["--database", "';DROP TABLE x"],
  ])("rejects invalid or ambiguous interval arguments %j", (...args) => {
    expect(() => parseWidgetReportArgs(args)).toThrow();
  });

  it("reports each embedder and generator action with exclusive date boundaries, excluding AARI", async () => {
    const database = createMigratedSqliteD1();
    databases.push(database);
    const env = { DB: database.DB };
    for (const [embedder, action, at] of [
      ["K1NW", "load", "2026-09-17T23:59:59.000Z"],
      ["K1NW", "load", "2026-09-18T00:00:00.000Z"],
      ["K1NW", "refresh", "2026-09-18T00:01:00.000Z"],
      ["generic", "click", "2026-09-18T23:59:59.000Z"],
      ["K1NW", "load", "2026-09-19T00:00:00.000Z"],
    ] as const) await recordWidgetRequest(env, embedder, action, at);
    for (const [scope, name, at] of [
      ["on-air", "widget_generated", "2026-09-18T00:00:00.000Z"],
      ["on-air", "widget_code_copied", "2026-09-18T00:01:00.000Z"],
      ["on-air", "widget_generated", "2026-09-19T00:00:00.000Z"],
      ["activate-ri-2026", "volunteer_form_started", "2026-09-18T00:00:00.000Z"],
    ]) await persistAnonymousAnalyticsEvent(env.DB, parseAnalyticsEvent({ schemaVersion: 1, scope, name,
      anonymousId: "11111111-1111-4111-8111-111111111111" })!, "hashed", at!);
    const options = parseWidgetReportArgs(["--since", "2026-09-18", "--until", "2026-09-19"]);
    const queries = widgetReportQueries(options);
    const results = new Map<string, Record<string, unknown>[]>();
    for (const query of Object.values(queries)) results.set(query, (await env.DB.prepare(query).all<Record<string, unknown>>()).results);
    const report = collectWidgetReport(options, (_db, query) => results.get(query)!);
    expect(report.totals).toEqual({ loads: 1, refreshes: 1, clicks: 1 });
    expect(report.daily).toEqual([
      { day: "2026-09-18", embedder: "K1NW", loads: 1, refreshes: 1, clicks: 0 },
      { day: "2026-09-18", embedder: "generic", loads: 0, refreshes: 0, clicks: 1 },
    ]);
    expect(report.generator).toEqual([
      { day: "2026-09-18", event_name: "widget_code_copied", count: 1 },
      { day: "2026-09-18", event_name: "widget_generated", count: 1 },
    ]);
    expect(renderWidgetReport(report)).toContain("K1NW / 1 / 1 / 0");
    expect(renderWidgetReport(report)).not.toContain("volunteer_form_started");
    const empty = collectWidgetReport(options, () => []);
    expect(empty.totals).toEqual({ loads: 0, refreshes: 0, clicks: 0 });
    expect(renderWidgetReport(empty)).toContain("No recorded widget requests");
  });

  it("keeps server widget requests out of anonymous Analytics Engine browser estimates", () => {
    const options = parseAnalyticsReportArgs(["--scope", "on-air"]);
    for (const sql of Object.values(buildAnalyticsEngineQueries(options))) expect(sql).toContain("blob3 = 'anonymous'");
  });
});
