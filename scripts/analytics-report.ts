import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";

const defaultScope = "activate-ri-2026";
const defaultDataset = "ripota_usage";
const defaultDatabase = "ripota-org";
const defaultSince = "2026-08-31T19:34:14Z";
const reportTimeZone = "America/New_York";

const knownSmokeEvents = [{
  scope: "activate-ri-2026",
  eventName: "schedule_detail_opened",
  timestamp: "2026-08-31 23:17:50",
}] as const;

const hunterEvents = [
  "hunter_checklist_started",
  "hunter_progress_changed",
  "hunter_agenda_action",
  "hunter_import_attempted",
  "hunter_import_succeeded",
  "hunter_import_failed",
  "hunter_checklist_resumed",
  "hunter_manual_override_used",
  "hunter_schedule_details_opened",
] as const;

type CliOptions = {
  database: string;
  dataset: string;
  includeSmoke: boolean;
  json: boolean;
  scope: string;
  since: string;
  until: string;
};

type AnonymousEventRow = {
  action: string;
  errorCode: string;
  eventName: string;
  feature: string;
  filterCategory: string;
  firstSeen: string;
  importMethod: string;
  interactions: number;
  lastSeen: string;
  outcome: string;
  placement: string;
  uniqueBrowsers: number;
};

type AuthenticatedFeatureRow = {
  feature: string;
  firstSeen: string;
  lastSeen: string;
  opens: number;
  subjectType: string;
  uniqueSubjects: number;
};

export type AnalyticsReport = {
  collection: {
    startedAt: Record<string, string>;
    legacyFeatureUses: number;
    limitations: string[];
  };
  anonymousDurable: {
    interactions: number;
    uniqueBrowsers: number;
    hunterBrowsers: number;
    events: Array<{ eventName: string; properties: Record<string, unknown>; interactions: number; uniqueBrowsers: number }>;
  };
  anonymous: {
    until: string;
    events: AnonymousEventRow[];
    hunterBrowsers: number;
    interactions: number;
    uniqueBrowsers: number;
  };
  authenticated: {
    featureOpens: number;
    features: AuthenticatedFeatureRow[];
    uniqueActivators: number;
  };
  generatedAt: string;
  knownSmokeExcluded: boolean;
  opsRoom: {
    activatorMessages: number;
    activatorsWhoPosted: number;
    foregroundActivators: number;
    foregroundSamples: number;
    firstDailyMessageExposures: number;
    activatorsWithFirstDailyExposure: number;
  };
  scope: string;
  since: string;
  until: string;
};

type AnalyticsEngineResponse = {
  data?: Record<string, unknown>[];
};

type WranglerIdentity = {
  accounts?: Array<{ id?: string; name?: string }>;
};

type WranglerToken = {
  token?: string;
  type?: string;
};

export function parseAnalyticsReportArgs(args: string[]): CliOptions {
  const options: CliOptions = {
    database: process.env.ANALYTICS_REPORT_DATABASE ?? defaultDatabase,
    dataset: process.env.ANALYTICS_REPORT_DATASET ?? defaultDataset,
    includeSmoke: false,
    json: false,
    scope: process.env.ANALYTICS_REPORT_SCOPE ?? defaultScope,
    since: process.env.ANALYTICS_REPORT_SINCE ?? defaultSince,
    until: process.env.ANALYTICS_REPORT_UNTIL ?? new Date().toISOString(),
  };

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--json") {
      options.json = true;
    } else if (argument === "--include-smoke") {
      options.includeSmoke = true;
    } else if (argument === "--scope") {
      options.scope = requiredValue(args, ++index, argument);
    } else if (argument === "--dataset") {
      options.dataset = requiredValue(args, ++index, argument);
    } else if (argument === "--database") {
      options.database = requiredValue(args, ++index, argument);
    } else if (argument === "--since") {
      options.since = requiredValue(args, ++index, argument);
    } else if (argument === "--until") {
      options.until = requiredValue(args, ++index, argument);
    } else if (argument === "--help" || argument === "-h") {
      process.stdout.write(helpText());
      process.exit(0);
    } else {
      throw new Error(`Unknown option: ${argument}\n\n${helpText()}`);
    }
  }

  validateIdentifier(options.dataset, "dataset");
  validateIdentifier(options.database, "database", true);
  if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(options.scope)) {
    throw new Error(`Invalid analytics scope: ${options.scope}`);
  }
  const since = new Date(options.since);
  if (Number.isNaN(since.valueOf())) {
    throw new Error(`Invalid --since timestamp: ${options.since}`);
  }
  const until = new Date(options.until);
  if (Number.isNaN(until.valueOf())) throw new Error(`Invalid --until timestamp: ${options.until}`);
  // Analytics Engine has second-precision timestamps; expose the normalized bounds.
  since.setUTCMilliseconds(0);
  until.setUTCMilliseconds(0);
  if (until <= since) throw new Error("--until must be after --since (at second precision)");
  options.since = since.toISOString();
  options.until = until.toISOString();

  return options;
}

export function buildAnalyticsEngineQueries(options: CliOptions): {
  events: string;
  hunters: string;
  totals: string;
} {
  const dataset = options.dataset;
  const where = analyticsWhere(options);
  const hunterNames = hunterEvents.map(sqlString).join(", ");

  return {
    events: `SELECT
  blob2 AS event_name,
  blob4 AS feature,
  blob5 AS action,
  blob6 AS placement,
  blob7 AS outcome,
  blob8 AS error_code,
  blob9 AS filter_category,
  blob10 AS import_method,
  count(DISTINCT index1) AS unique_browsers,
  sum(_sample_interval * double1) AS interactions,
  min(timestamp) AS first_seen,
  max(timestamp) AS last_seen
FROM ${dataset}
WHERE ${where}
GROUP BY event_name, feature, action, placement, outcome, error_code, filter_category, import_method
ORDER BY first_seen ASC`,
    hunters: `SELECT count(DISTINCT index1) AS hunter_browsers
FROM ${dataset}
WHERE ${where}
  AND (blob2 IN (${hunterNames}) OR (blob2 = 'event_cta_clicked' AND blob4 = 'hunter_checklist'))`,
    totals: `SELECT
  count(DISTINCT index1) AS unique_browsers,
  sum(_sample_interval * double1) AS interactions
FROM ${dataset}
WHERE ${where}`,
  };
}

export function renderAnalyticsReport(
  report: AnalyticsReport,
  color = process.stdout.isTTY && !process.env.NO_COLOR,
): string {
  const bold = (value: string): string => color ? `\u001b[1m${value}\u001b[0m` : value;
  const dim = (value: string): string => color ? `\u001b[2m${value}\u001b[0m` : value;
  const lines: string[] = [];

  lines.push(bold("Analytics report"));
  lines.push("────────────────");
  lines.push(`Generated  ${formatTimestamp(report.generatedAt)}`);
  lines.push(`Window     [${formatTimestamp(report.since)}, ${formatTimestamp(report.until)})`);
  lines.push(`Scope      ${report.scope}`);
  if (report.knownSmokeExcluded) {
    lines.push(`Smoke      Excluded the initial schedule-detail ingestion check`);
  }

  lines.push("");
  lines.push(bold("Anonymous feature usage (Analytics Engine estimates)"));
  lines.push("  Full reporting interval; overlaps durable events below. These totals must not be added.");
  lines.push(`  ${plural(report.anonymous.uniqueBrowsers, "browser")} · ${plural(report.anonymous.interactions, "interaction")}`);
  if (report.anonymous.events.length === 0) {
    lines.push(dim("  No anonymous feature events yet."));
  } else {
    lines.push("");
    lines.push(renderTable(
      ["Event", "Detail", "Browsers", "Uses", "First", "Last"],
      report.anonymous.events.map((event) => [
        humanize(event.eventName),
        eventDetail(event),
        number(event.uniqueBrowsers),
        number(event.interactions),
        formatTimestamp(event.firstSeen, false),
        formatTimestamp(event.lastSeen, false),
      ]),
      new Set([2, 3]),
    ));
  }
  lines.push(`  Hunter checklist: ${report.anonymous.hunterBrowsers === 0 ? "no activity yet" : plural(report.anonymous.hunterBrowsers, "browser")}`);

  lines.push("");
  lines.push(bold("Durable anonymous feature usage (accepted events)"));
  lines.push(`  ${plural(report.anonymousDurable.uniqueBrowsers, "browser")} · ${plural(report.anonymousDurable.interactions, "interaction")} · ${plural(report.anonymousDurable.hunterBrowsers, "engaged hunter browser")}`);

  lines.push("");
  lines.push(bold("Authenticated feature usage"));
  lines.push(`  Timestamped collection: ${report.collection.startedAt.authenticated_events ?? "no captured events yet"}.`);
  lines.push(`  ${number(report.collection.legacyFeatureUses)} legacy lifetime uses are retained separately and excluded from interval totals.`);
  lines.push(`  ${plural(report.authenticated.uniqueActivators, "activator")} · ${plural(report.authenticated.featureOpens, "recorded use")}`);
  if (report.authenticated.features.length === 0) {
    lines.push(dim("  No authenticated feature usage yet."));
  } else {
    lines.push("");
    lines.push(renderTable(
      ["Feature", "Subject type", "Subjects", "Uses", "First", "Last"],
      report.authenticated.features.map((feature) => [
        humanize(feature.feature),
        feature.subjectType,
        number(feature.uniqueSubjects),
        number(feature.opens),
        formatTimestamp(feature.firstSeen, false),
        formatTimestamp(feature.lastSeen, false),
      ]),
      new Set([2, 3]),
    ));
  }

  lines.push("");
  lines.push(bold("Ops Room participation"));
  lines.push(`  ${plural(report.opsRoom.foregroundActivators, "foreground activator")} · ${plural(report.opsRoom.foregroundSamples, "foreground sample")} · ${plural(report.opsRoom.firstDailyMessageExposures, "first daily message exposure")}`);
  if (report.opsRoom.activatorMessages === 0) {
    lines.push(dim("  No activator messages during this reporting window."));
  } else {
    lines.push(`  ${plural(report.opsRoom.activatorsWhoPosted, "activator")} posted ${plural(report.opsRoom.activatorMessages, "message")}.`);
  }

  lines.push("");
  lines.push(dim("Browser counts estimate devices, not people. GPC and DNT opt out of anonymous collection."));
  report.collection.limitations.forEach((limitation) => lines.push(dim(limitation)));
  return `${lines.join("\n")}\n`;
}

export async function collectAnalyticsReport(options: CliOptions): Promise<AnalyticsReport> {
  const identity = runWranglerJson<WranglerIdentity>(["whoami", "--json"]);
  const accountId = selectAccountId(identity);
  const auth = runWranglerJson<WranglerToken>(["auth", "token", "--json"]);
  if (!auth.token) {
    throw new Error("Wrangler did not provide a bearer token. Run `npx wrangler login` first.");
  }

  const metadata = queryD1(options.database, `SELECT stream, started_at FROM analytics_collection_metadata WHERE scope = ${sqlString(options.scope)}`);
  const startedAt = Object.fromEntries(metadata.map((row) => [stringValue(row.stream), stringValue(row.started_at)]));
  // Old deployed code may keep incrementing the rollup between migration and deployment.
  // Subtract the atomically dual-written new facts to retain that untimed legacy activity too.
  const legacy = queryD1(options.database, `SELECT COALESCE(SUM(use_count), 0) -
    (SELECT COUNT(*) FROM analytics_feature_events WHERE scope = ${sqlString(options.scope)}) AS uses
    FROM analytics_feature_usage WHERE scope = ${sqlString(options.scope)}`)[0] ?? {};
  const queries = buildAnalyticsEngineQueries(options);
  const eventRows = await queryAnalyticsEngine(accountId, auth.token, queries.events);
  const hunterRows = await queryAnalyticsEngine(accountId, auth.token, queries.hunters);
  const totalRows = await queryAnalyticsEngine(accountId, auth.token, queries.totals);
  const featureRows = queryD1(options.database, authenticatedFeatureSql(options));
  const authenticatedRows = queryD1(options.database, authenticatedTotalsSql(options));
  const engagement = queryD1(options.database, opsEngagementSql(options))[0] ?? {};
  const durable = queryD1(options.database, anonymousDurableTotalsSql(options))[0] ?? {};
  const durableEvents = queryD1(options.database, `SELECT event_name, properties_json, COUNT(*) AS interactions,
    COUNT(DISTINCT subject_hash) AS unique_browsers FROM analytics_anonymous_events
    WHERE scope = ${sqlString(options.scope)} AND received_at >= ${sqlString(options.since)} AND received_at < ${sqlString(options.until)}
    GROUP BY event_name, properties_json ORDER BY event_name, properties_json`);

  const events = eventRows.map((row): AnonymousEventRow => ({
    action: stringValue(row.action),
    errorCode: stringValue(row.error_code),
    eventName: stringValue(row.event_name),
    feature: stringValue(row.feature),
    filterCategory: stringValue(row.filter_category),
    firstSeen: stringValue(row.first_seen),
    importMethod: stringValue(row.import_method),
    interactions: numericValue(row.interactions),
    lastSeen: stringValue(row.last_seen),
    outcome: stringValue(row.outcome),
    placement: stringValue(row.placement),
    uniqueBrowsers: numericValue(row.unique_browsers),
  }));
  const features = featureRows.map((row): AuthenticatedFeatureRow => ({
    feature: stringValue(row.feature),
    firstSeen: stringValue(row.first_seen),
    lastSeen: stringValue(row.last_seen),
    opens: numericValue(row.opens),
    subjectType: stringValue(row.subject_type),
    uniqueSubjects: numericValue(row.unique_subjects),
  }));
  const totals = totalRows[0] ?? {};
  const hunterTotals = hunterRows[0] ?? {};
  const authenticated = authenticatedRows[0] ?? {};

  return {
    collection: {
      startedAt,
      legacyFeatureUses: numericValue(legacy.uses),
      limitations: [
        "Missing pre-instrumentation timestamps, exposures, and checklist counts cannot be recovered.",
        "Analytics Engine estimates overlap durable anonymous events; neither event totals nor browser counts may be added across sources.",
        "Foreground samples establish visible room use, not duration; exposure is not acknowledgment.",
        "Authenticated uses count successful page GETs or Ops bootstrap loads, not distinct sessions or confirmed page rendering.",
        "Message exposures count the first exposure per actor/message/UTC date in the interval.",
        "Durable anonymous totals count accepted, deduplicated events; opt-outs and undelivered events remain unobserved.",
        "Anonymous report intervals use server receipt time; client occurrence times and clock-skew flags remain in the archive.",
      ],
    },
    anonymousDurable: {
      interactions: numericValue(durable.interactions), uniqueBrowsers: numericValue(durable.unique_browsers),
      hunterBrowsers: numericValue(durable.hunter_browsers),
      events: durableEvents.map((row) => ({ eventName: stringValue(row.event_name),
        properties: JSON.parse(stringValue(row.properties_json) || "{}") as Record<string, unknown>,
        interactions: numericValue(row.interactions), uniqueBrowsers: numericValue(row.unique_browsers) })),
    },
    anonymous: {
      until: options.until,
      events,
      hunterBrowsers: numericValue(hunterTotals.hunter_browsers),
      interactions: numericValue(totals.interactions),
      uniqueBrowsers: numericValue(totals.unique_browsers),
    },
    authenticated: {
      featureOpens: numericValue(authenticated.feature_opens),
      features,
      uniqueActivators: numericValue(authenticated.unique_activators),
    },
    generatedAt: new Date().toISOString(),
    knownSmokeExcluded: !options.includeSmoke && knownSmokeEvents.some((event) => event.scope === options.scope),
    opsRoom: {
      activatorMessages: numericValue(authenticated.activator_messages),
      activatorsWhoPosted: numericValue(authenticated.activators_who_posted),
      foregroundActivators: numericValue(engagement.foreground_activators),
      foregroundSamples: numericValue(engagement.foreground_samples),
      firstDailyMessageExposures: numericValue(engagement.first_daily_exposures),
      activatorsWithFirstDailyExposure: numericValue(engagement.exposed_activators),
    },
    scope: options.scope,
    since: options.since,
    until: options.until,
  };
}

async function main(): Promise<void> {
  const options = parseAnalyticsReportArgs(process.argv.slice(2));
  const report = await collectAnalyticsReport(options);
  process.stdout.write(options.json
    ? `${JSON.stringify(report, null, 2)}\n`
    : renderAnalyticsReport(report));
}

function analyticsWhere(options: CliOptions): string {
  const clauses = [
    `blob1 = ${sqlString(options.scope)}`,
    `timestamp >= toDateTime(${sqlString(toAnalyticsTimestamp(options.since))})`,
    `timestamp < toDateTime(${sqlString(toAnalyticsTimestamp(options.until))})`,
  ];
  if (!options.includeSmoke) {
    for (const smoke of knownSmokeEvents) {
      if (smoke.scope !== options.scope) continue;
      clauses.push(`NOT (blob2 = ${sqlString(smoke.eventName)} AND timestamp = toDateTime(${sqlString(smoke.timestamp)}))`);
    }
  }
  return clauses.join("\n  AND ");
}

export function anonymousDurableTotalsSql(options: CliOptions): string {
  return `SELECT COUNT(*) AS interactions, COUNT(DISTINCT subject_hash) AS unique_browsers,
    COUNT(DISTINCT CASE WHEN event_name IN (${hunterEvents.map(sqlString).join(", ")})
      OR (event_name = 'event_cta_clicked' AND json_extract(properties_json, '$.feature') = 'hunter_checklist')
      THEN subject_hash END) AS hunter_browsers
    FROM analytics_anonymous_events WHERE scope = ${sqlString(options.scope)}
      AND received_at >= ${sqlString(options.since)} AND received_at < ${sqlString(options.until)};`;
}

export function opsEngagementSql(options: CliOptions): string {
  return `SELECT COUNT(*) AS foreground_samples, COUNT(DISTINCT activator_id) AS foreground_activators,
    (SELECT COUNT(*) FROM activate_ri_ops_message_exposures
      WHERE event_id = ${sqlString(options.scope)} AND first_exposed_at >= ${sqlString(options.since)}
        AND first_exposed_at < ${sqlString(options.until)}) AS first_daily_exposures,
    (SELECT COUNT(DISTINCT activator_id) FROM activate_ri_ops_message_exposures
      WHERE event_id = ${sqlString(options.scope)} AND first_exposed_at >= ${sqlString(options.since)}
        AND first_exposed_at < ${sqlString(options.until)}) AS exposed_activators
    FROM activate_ri_ops_foreground_samples WHERE event_id = ${sqlString(options.scope)}
      AND occurred_at >= ${sqlString(options.since)} AND occurred_at < ${sqlString(options.until)};`;
}

export function authenticatedFeatureSql(options: CliOptions): string {
  return `SELECT
  feature,
  subject_type,
  COUNT(DISTINCT subject_id) AS unique_subjects,
  COUNT(*) AS opens,
  MIN(occurred_at) AS first_seen,
  MAX(occurred_at) AS last_seen
FROM analytics_feature_events
WHERE scope = ${sqlString(options.scope)}
  AND occurred_at >= ${sqlString(options.since)}
  AND occurred_at < ${sqlString(options.until)}
GROUP BY feature, subject_type
ORDER BY first_seen ASC;`;
}

export function authenticatedTotalsSql(options: CliOptions): string {
  return `SELECT
  COUNT(DISTINCT subject_id) AS unique_activators,
  COUNT(*) AS feature_opens,
  (SELECT COUNT(DISTINCT author_activator_id)
     FROM activate_ri_ops_messages
    WHERE event_id = ${sqlString(options.scope)}
      AND author_type = 'activator'
      AND created_at >= ${sqlString(options.since)}
      AND created_at < ${sqlString(options.until)}) AS activators_who_posted,
  (SELECT COUNT(*)
     FROM activate_ri_ops_messages
    WHERE event_id = ${sqlString(options.scope)}
      AND author_type = 'activator'
      AND created_at >= ${sqlString(options.since)}
      AND created_at < ${sqlString(options.until)}) AS activator_messages
FROM analytics_feature_events
WHERE scope = ${sqlString(options.scope)}
  AND subject_type = 'activator'
  AND occurred_at >= ${sqlString(options.since)}
  AND occurred_at < ${sqlString(options.until)};`;
}

async function queryAnalyticsEngine(
  accountId: string,
  token: string,
  sql: string,
): Promise<Record<string, unknown>[]> {
  const response = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${accountId}/analytics_engine/sql`,
    {
      method: "POST",
      headers: { authorization: `Bearer ${token}` },
      body: sql,
    },
  );
  const body = await response.text();
  if (!response.ok) {
    throw new Error(
      `Analytics Engine query failed (${response.status}): ${body}\n` +
      "Use a Cloudflare token with Account Analytics Read permission.",
    );
  }
  const parsed = JSON.parse(body) as AnalyticsEngineResponse;
  return parsed.data ?? [];
}

function queryD1(database: string, sql: string): Record<string, unknown>[] {
  const response = runWranglerJson<Array<{ results?: Record<string, unknown>[] }>>([
    "d1",
    "execute",
    database,
    "--remote",
    "--env=",
    "--command",
    sql,
    "--json",
  ]);
  return response[0]?.results ?? [];
}

function runWranglerJson<Value>(args: string[]): Value {
  const result = spawnSync(
    "npm",
    ["exec", "wrangler", "--", ...args],
    { encoding: "utf8", maxBuffer: 10 * 1024 * 1024 },
  );
  if (result.status !== 0) {
    throw new Error((result.stderr || result.stdout || "Wrangler command failed").trim());
  }
  try {
    return JSON.parse(result.stdout) as Value;
  } catch {
    throw new Error(`Wrangler returned invalid JSON for ${args.slice(0, 2).join(" ")}.`);
  }
}

function selectAccountId(identity: WranglerIdentity): string {
  const configured = process.env.CLOUDFLARE_ACCOUNT_ID;
  if (configured) return configured;
  const accounts = identity.accounts ?? [];
  if (accounts.length === 1 && accounts[0]?.id) return accounts[0].id;
  if (accounts.length === 0) {
    throw new Error("Wrangler is not connected to a Cloudflare account.");
  }
  throw new Error(
    "Wrangler has multiple Cloudflare accounts. Set CLOUDFLARE_ACCOUNT_ID to select one.",
  );
}

function renderTable(
  headers: string[],
  rows: string[][],
  rightAligned = new Set<number>(),
): string {
  const widths = headers.map((header, column) => Math.max(
    header.length,
    ...rows.map((row) => row[column]?.length ?? 0),
  ));
  const renderRow = (row: string[]): string => row.map((cell, column) =>
    rightAligned.has(column)
      ? cell.padStart(widths[column] ?? cell.length)
      : cell.padEnd(widths[column] ?? cell.length)
  ).join("  ").trimEnd();
  const divider = widths.map((width) => "─".repeat(width)).join("  ");
  return [renderRow(headers), divider, ...rows.map(renderRow)]
    .map((line) => `  ${line}`)
    .join("\n");
}

function eventDetail(event: AnonymousEventRow): string {
  const values = [
    event.feature && `feature: ${humanize(event.feature)}`,
    event.action && `action: ${humanize(event.action)}`,
    event.placement && `placement: ${humanize(event.placement)}`,
    event.outcome && `outcome: ${humanize(event.outcome)}`,
    event.filterCategory && `filter: ${humanize(event.filterCategory)}`,
    event.importMethod && `import: ${humanize(event.importMethod)}`,
    event.errorCode && `error: ${humanize(event.errorCode)}`,
  ].filter(Boolean);
  return values.join(", ") || "—";
}

function formatTimestamp(value: string, includeYear = true): string {
  if (!value) return "—";
  const date = new Date(value.includes("T") ? value : `${value.replace(" ", "T")}Z`);
  if (Number.isNaN(date.valueOf())) return value;
  return new Intl.DateTimeFormat("en-US", {
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    month: "short",
    timeZone: reportTimeZone,
    timeZoneName: "short",
    ...(includeYear ? { year: "numeric" } : {}),
  }).format(date);
}

function helpText(): string {
  return `Show a privacy-safe production analytics summary.

Usage: mise run analytics:report [options]

Options:
  --json              Emit stable machine-readable JSON
  --include-smoke     Include known production ingestion checks
  --scope <scope>     Event scope (default: ${defaultScope})
  --dataset <name>    Analytics Engine dataset (default: ${defaultDataset})
  --database <name>   D1 database (default: ${defaultDatabase})
  --since <ISO time>  Inclusive reporting-window start (default: ${defaultSince})
  --until <ISO time>  Exclusive reporting-window end (default: now; second precision)
  -h, --help          Show this help
`;
}

function requiredValue(args: string[], index: number, option: string): string {
  const value = args[index];
  if (!value || value.startsWith("--")) {
    throw new Error(`${option} requires a value.`);
  }
  return value;
}

function validateIdentifier(value: string, label: string, allowHyphen = false): void {
  const pattern = allowHyphen
    ? /^[A-Za-z_][A-Za-z0-9_-]*$/
    : /^[A-Za-z_][A-Za-z0-9_]*$/;
  if (!pattern.test(value)) {
    throw new Error(`Invalid ${label} name: ${value}`);
  }
}

function sqlString(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

function toAnalyticsTimestamp(value: string): string {
  return new Date(value).toISOString().replace("T", " ").replace(/\.\d{3}Z$/, "");
}

function humanize(value: string): string {
  return value.replaceAll("_", " ");
}

function plural(value: number, singular: string): string {
  return `${number(value)} ${value === 1 ? singular : `${singular}s`}`;
}

function number(value: number): string {
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(value);
}

function numericValue(value: unknown): number {
  const parsed = typeof value === "number" ? value : Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value : "";
}

const invokedPath = process.argv[1] ? pathToFileURL(process.argv[1]).href : "";
if (import.meta.url === invokedPath) {
  main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`analytics:report: ${message}\n`);
    process.exitCode = 1;
  });
}
