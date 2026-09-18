import { pathToFileURL } from "node:url";
import { queryD1 } from "./analytics-report.ts";

export type WidgetReportOptions = { database: string; since: string; until: string; json: boolean };
type Query = (database: string, sql: string) => Record<string, unknown>[];

export function parseWidgetReportArgs(args: string[], now = new Date()): WidgetReportOptions {
  const today = Date.parse(now.toISOString().slice(0, 10));
  const options: WidgetReportOptions = {
    database: process.env.ANALYTICS_REPORT_DATABASE ?? "ripota-org",
    since: new Date(today - 29 * 86_400_000).toISOString().slice(0, 10),
    until: new Date(today + 86_400_000).toISOString().slice(0, 10),
    json: false,
  };
  for (let index = 0; index < args.length; index++) {
    const key = args[index];
    if (key === "--json") options.json = true;
    else if (key === "--since" || key === "--until" || key === "--database") {
      const value = args[++index];
      if (!value || value.startsWith("--")) throw new Error(`Missing value for ${key}`);
      options[key.slice(2) as "since" | "until" | "database"] = value;
    } else throw new Error(`Unknown option: ${key}`);
  }
  if (!/^[a-zA-Z0-9_-]+$/.test(options.database)) throw new Error("Invalid database name");
  for (const day of [options.since, options.until]) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || !Number.isFinite(Date.parse(day)) || new Date(day).toISOString().slice(0, 10) !== day) {
      throw new Error("Use real UTC dates (YYYY-MM-DD); widget totals cannot resolve partial days");
    }
  }
  if (options.until <= options.since) throw new Error("--until must be after --since (exclusive)");
  return options;
}

export function widgetReportQueries(options: WidgetReportOptions) {
  // Options are validated by parseWidgetReportArgs; only ISO dates enter SQL.
  const window = `day >= '${options.since}' AND day < '${options.until}'`;
  return {
    daily: `SELECT day, embedder,
      SUM(CASE WHEN action = 'load' THEN count ELSE 0 END) AS loads,
      SUM(CASE WHEN action = 'refresh' THEN count ELSE 0 END) AS refreshes,
      SUM(CASE WHEN action = 'click' THEN count ELSE 0 END) AS clicks
      FROM analytics_widget_daily WHERE scope = 'on-air' AND ${window}
      GROUP BY day, embedder ORDER BY day, embedder`,
    generator: `SELECT substr(received_at, 1, 10) AS day, event_name, COUNT(*) AS count
      FROM analytics_anonymous_events WHERE scope = 'on-air'
      AND received_at >= '${options.since}T00:00:00.000Z' AND received_at < '${options.until}T00:00:00.000Z'
      AND event_name IN ('widget_generated', 'widget_code_copied')
      GROUP BY day, event_name ORDER BY day, event_name`,
    collection: "SELECT stream, started_at FROM analytics_collection_metadata WHERE scope = 'on-air' ORDER BY stream",
  };
}

export function collectWidgetReport(options: WidgetReportOptions, query: Query = queryD1) {
  const queries = widgetReportQueries(options);
  const daily = query(options.database, queries.daily);
  const generator = query(options.database, queries.generator);
  const collection = query(options.database, queries.collection);
  const totals = daily.reduce<{ loads: number; refreshes: number; clicks: number }>((sum, row) => ({
    loads: sum.loads + Number(row.loads), refreshes: sum.refreshes + Number(row.refreshes), clicks: sum.clicks + Number(row.clicks),
  }), { loads: 0, refreshes: 0, clicks: 0 });
  return {
    scope: "on-air", generatedAt: new Date().toISOString(), since: options.since, until: options.until,
    totals, daily, generator, collection,
    limitations: [
      "UTC dates use [since, until); the current day is partial as of report generation.",
      "D1 totals count recorded requests, not unique visitors, verified embedders, or successful renders. Bots can be included.",
      "Previews, HEAD requests, and requests carrying GPC/DNT opt-outs are excluded.",
      "Click counts cover Full on-air view only. Generator events do not establish installation; manual copies are unobserved.",
      "Collection begins at deployment; earlier request logs are not backfilled. Storage failures can leave gaps.",
      "Analytics Engine mirrors overlap these totals and must not be added to them.",
    ],
  };
}

export function renderWidgetReport(report: ReturnType<typeof collectWidgetReport>): string {
  return [
    `On-air widget analytics · [${report.since}, ${report.until}) UTC`,
    `Generated ${report.generatedAt}`,
    `Collection: ${report.collection.map(row => `${row.stream}=${row.started_at}`).join(", ") || "not started"}`,
    `Total: ${report.totals.loads} loads · ${report.totals.refreshes} refreshes · ${report.totals.clicks} clicks`,
    "", "Date / embedder / loads / refreshes / clicks",
    ...report.daily.map(row => `${row.day} / ${row.embedder} / ${row.loads} / ${row.refreshes} / ${row.clicks}`),
    ...(!report.daily.length ? ["No recorded widget requests in this window."] : []),
    "", "Generator actions",
    ...report.generator.map(row => `${row.day} / ${row.event_name} / ${row.count}`),
    ...(!report.generator.length ? ["No recorded generator actions in this window."] : []),
    "", ...report.limitations,
  ].join("\n") + "\n";
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv.includes("--help") || process.argv.includes("-h")) {
    console.log("Usage: mise run analytics:widgets -- [--since YYYY-MM-DD] [--until YYYY-MM-DD] [--json] [--database NAME]\nDefaults to the last 30 UTC dates including today. --until is exclusive.");
  } else {
    try {
      const options = parseWidgetReportArgs(process.argv.slice(2));
      const report = collectWidgetReport(options);
      process.stdout.write(options.json ? `${JSON.stringify(report, null, 2)}\n` : renderWidgetReport(report));
    } catch (error) {
      console.error(error instanceof Error ? error.message : "Widget analytics report failed");
      process.exitCode = 1;
    }
  }
}
