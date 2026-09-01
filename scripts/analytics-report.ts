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
  anonymous: {
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
  };
  scope: string;
  since: string;
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
  options.since = since.toISOString();

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
  AND blob2 IN (${hunterNames})`,
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
  lines.push(`Window     Since ${formatTimestamp(report.since)}`);
  lines.push(`Scope      ${report.scope}`);
  if (report.knownSmokeExcluded) {
    lines.push(`Smoke      Excluded the initial schedule-detail ingestion check`);
  }

  lines.push("");
  lines.push(bold("Anonymous feature usage"));
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
  lines.push(bold("Authenticated feature usage"));
  lines.push(`  ${plural(report.authenticated.uniqueActivators, "activator")} · ${plural(report.authenticated.featureOpens, "open")}`);
  if (report.authenticated.features.length === 0) {
    lines.push(dim("  No authenticated feature usage yet."));
  } else {
    lines.push("");
    lines.push(renderTable(
      ["Feature", "Activators", "Opens", "First", "Last"],
      report.authenticated.features.map((feature) => [
        humanize(feature.feature),
        number(feature.uniqueSubjects),
        number(feature.opens),
        formatTimestamp(feature.firstSeen, false),
        formatTimestamp(feature.lastSeen, false),
      ]),
      new Set([1, 2]),
    ));
  }

  lines.push("");
  lines.push(bold("Ops Room participation"));
  if (report.opsRoom.activatorMessages === 0) {
    lines.push(dim("  No activator messages during this reporting window."));
  } else {
    lines.push(`  ${plural(report.opsRoom.activatorsWhoPosted, "activator")} posted ${plural(report.opsRoom.activatorMessages, "message")}.`);
  }

  lines.push("");
  lines.push(dim("Browser counts estimate devices, not people. GPC and DNT opt out of anonymous collection."));
  return `${lines.join("\n")}\n`;
}

export async function collectAnalyticsReport(options: CliOptions): Promise<AnalyticsReport> {
  const identity = runWranglerJson<WranglerIdentity>(["whoami", "--json"]);
  const accountId = selectAccountId(identity);
  const auth = runWranglerJson<WranglerToken>(["auth", "token", "--json"]);
  if (!auth.token) {
    throw new Error("Wrangler did not provide a bearer token. Run `npx wrangler login` first.");
  }

  const queries = buildAnalyticsEngineQueries(options);
  const eventRows = await queryAnalyticsEngine(accountId, auth.token, queries.events);
  const hunterRows = await queryAnalyticsEngine(accountId, auth.token, queries.hunters);
  const totalRows = await queryAnalyticsEngine(accountId, auth.token, queries.totals);
  const featureRows = queryD1(options.database, authenticatedFeatureSql(options));
  const authenticatedRows = queryD1(options.database, authenticatedTotalsSql(options));

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
    anonymous: {
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
    },
    scope: options.scope,
    since: options.since,
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
  ];
  if (!options.includeSmoke) {
    for (const smoke of knownSmokeEvents) {
      if (smoke.scope !== options.scope) continue;
      clauses.push(`NOT (blob2 = ${sqlString(smoke.eventName)} AND timestamp = toDateTime(${sqlString(smoke.timestamp)}))`);
    }
  }
  return clauses.join("\n  AND ");
}

function authenticatedFeatureSql(options: CliOptions): string {
  return `SELECT
  feature,
  subject_type,
  COUNT(*) AS unique_subjects,
  SUM(use_count) AS opens,
  MIN(first_used_at) AS first_seen,
  MAX(last_used_at) AS last_seen
FROM analytics_feature_usage
WHERE scope = ${sqlString(options.scope)}
  AND last_used_at >= ${sqlString(options.since)}
GROUP BY feature, subject_type
ORDER BY first_seen ASC;`;
}

function authenticatedTotalsSql(options: CliOptions): string {
  return `SELECT
  COUNT(DISTINCT subject_id) AS unique_activators,
  SUM(use_count) AS feature_opens,
  (SELECT COUNT(DISTINCT author_activator_id)
     FROM activate_ri_ops_messages
    WHERE event_id = ${sqlString(options.scope)}
      AND author_type = 'activator'
      AND created_at >= ${sqlString(options.since)}) AS activators_who_posted,
  (SELECT COUNT(*)
     FROM activate_ri_ops_messages
    WHERE event_id = ${sqlString(options.scope)}
      AND author_type = 'activator'
      AND created_at >= ${sqlString(options.since)}) AS activator_messages
FROM analytics_feature_usage
WHERE scope = ${sqlString(options.scope)}
  AND subject_type = 'activator'
  AND last_used_at >= ${sqlString(options.since)};`;
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
  --since <ISO time>  Reporting-window start (default: ${defaultSince})
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
