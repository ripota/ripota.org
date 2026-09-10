export const analyticsScopes = ["activate-ri-2026"] as const;
export type AnalyticsScope = (typeof analyticsScopes)[number];

const sharedPropertyValues = {
  action: ["add_to_plan", "open_details", "open_popup", "primary", "schedule", "secondary", "volunteer", "hunter", "open", "build", "share", "print", "scope_changed", "reset", "clear"],
  errorCode: ["empty_file", "invalid_csv", "read_failed", "unsupported_file", "storage_unavailable"],
  feature: ["coverage", "event_hero", "hunter_checklist", "map", "schedule", "volunteer_form"],
  filterCategory: ["activator", "band", "county", "coverage", "mode", "timeline", "time_zone"],
  importMethod: ["file_picker", "drop"],
  outcome: ["accepted", "rejected", "ready", "empty", "unavailable", "copied", "manual_copy", "requested", "succeeded", "network_failed"],
  placement: ["coverage", "hero", "map", "schedule"],
  entryMode: ["blank", "imported", "requested"],
  agendaScope: ["all", "remaining", "requested", "park"],
  direction: ["hunted", "remaining", "reset", "clear"],
  persistence: ["saved", "unavailable"],
  importQuality: ["clean", "partial", "zero_matches"],
  pageCategory: ["hunter", "schedule", "volunteer", "event", "other"],
} as const;

const numericPropertyLimits = {
  completedCount: 1_000,
  totalCount: 1_000,
  parkCount: 1_000,
  windowCount: 10_000,
  examinedRows: 1_000_000,
  recoveredRows: 1_000_000,
  skippedRows: 1_000_000,
  matchedCount: 1_000,
} as const;

export type AnalyticsProperties = Partial<{
  [Key in keyof typeof sharedPropertyValues]: (typeof sharedPropertyValues)[Key][number];
} & { [Key in keyof typeof numericPropertyLimits]: number } & { importAttemptId: string }>;
export type AnalyticsPropertyName = keyof AnalyticsProperties;

const checklistProperties = ["entryMode", "completedCount", "totalCount", "persistence"] as const;
const importProperties = ["importMethod", "importAttemptId", "importQuality", "examinedRows", "recoveredRows", "skippedRows", "matchedCount", ...checklistProperties] as const;
const agendaProperties = ["action", "agendaScope", "parkCount", "windowCount", "outcome"] as const;

const activateRiEventProperties = {
  event_cta_clicked: ["action", "feature", "placement"],
  schedule_filter_used: ["filterCategory"],
  schedule_detail_opened: [],
  coverage_filter_used: ["filterCategory"],
  map_action: ["action"],
  hunter_import_attempted: ["importMethod", "importAttemptId"],
  hunter_import_succeeded: importProperties,
  hunter_import_failed: ["errorCode", ...importProperties],
  hunter_checklist_started: checklistProperties,
  hunter_checklist_resumed: checklistProperties,
  hunter_progress_changed: ["direction", ...checklistProperties],
  hunter_manual_override_used: [],
  hunter_schedule_details_opened: ["agendaScope", "parkCount"],
  hunter_agenda_action: agendaProperties,
  volunteer_form_started: [],
  volunteer_validation_failed: [],
  volunteer_submit_attempted: [],
  volunteer_submit_completed: ["outcome"],
} as const satisfies Record<string, readonly AnalyticsPropertyName[]>;

export const analyticsEventProperties = { "activate-ri-2026": activateRiEventProperties } as const;
export type AnalyticsEventName = keyof typeof activateRiEventProperties;

type AnalyticsEventBase = {
  scope: AnalyticsScope;
  name: AnalyticsEventName;
  anonymousId: string;
  properties?: AnalyticsProperties;
};
export type AnalyticsEvent = AnalyticsEventBase & (
  | { schemaVersion: 1 }
  | { schemaVersion: 2; eventId: string; occurredAt: string }
);

export function parseAnalyticsEvent(value: unknown): AnalyticsEvent | null {
  if (!isRecord(value) || !hasOnlyKeys(value, ["anonymousId", "name", "properties", "schemaVersion", "scope", "eventId", "occurredAt"])) return null;
  if (
    (value.schemaVersion !== 1 && value.schemaVersion !== 2) ||
    value.scope !== "activate-ri-2026" ||
    typeof value.name !== "string" ||
    !Object.hasOwn(activateRiEventProperties, value.name) ||
    typeof value.anonymousId !== "string" || !uuidPattern.test(value.anonymousId)
  ) return null;
  if (value.schemaVersion === 2) {
    if (typeof value.eventId !== "string" || !uuidPattern.test(value.eventId) || !isIsoTimestamp(value.occurredAt)) return null;
  } else if (value.eventId !== undefined || value.occurredAt !== undefined) {
    return null;
  }

  const name = value.name as AnalyticsEventName;
  if (value.properties !== undefined && !isRecord(value.properties)) return null;
  const properties = value.properties as Record<string, unknown> | undefined;
  const allowedProperties: readonly string[] = activateRiEventProperties[name];
  for (const [key, propertyValue] of Object.entries(properties ?? {})) {
    if (key !== "pageCategory" && !allowedProperties.includes(key)) return null;
    if (Object.hasOwn(numericPropertyLimits, key)) {
      if (typeof propertyValue !== "number" || !Number.isInteger(propertyValue) || propertyValue < 0 || propertyValue > numericPropertyLimits[key as keyof typeof numericPropertyLimits]) return null;
    } else if (key === "importAttemptId") {
      if (typeof propertyValue !== "string" || !uuidPattern.test(propertyValue)) return null;
    } else {
      if (!Object.hasOwn(sharedPropertyValues, key)) return null;
      const values: readonly unknown[] = sharedPropertyValues[key as keyof typeof sharedPropertyValues];
      if (!values.includes(propertyValue)) return null;
    }
  }
  if (typeof properties?.completedCount === "number" && typeof properties?.totalCount === "number" && properties.completedCount > properties.totalCount) return null;
  return value as AnalyticsEvent;
}

function isIsoTimestamp(value: unknown): boolean {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) return false;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString() === value;
}
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function hasOnlyKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).every((key) => keys.includes(key));
}
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
