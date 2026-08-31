export const analyticsScopes = ["activate-ri-2026"] as const;

export type AnalyticsScope = (typeof analyticsScopes)[number];

const sharedPropertyValues = {
  action: [
    "add_to_plan",
    "open_details",
    "open_popup",
    "primary",
    "schedule",
    "secondary",
    "volunteer",
  ],
  errorCode: ["empty_file", "invalid_csv", "read_failed", "unsupported_file"],
  feature: [
    "coverage",
    "event_hero",
    "hunter_checklist",
    "map",
    "schedule",
    "volunteer_form",
  ],
  filterCategory: [
    "activator",
    "band",
    "county",
    "coverage",
    "mode",
    "timeline",
    "time_zone",
  ],
  importMethod: ["file_picker", "drop"],
  outcome: ["accepted", "rejected"],
  placement: ["coverage", "hero", "map", "schedule"],
} as const;

export type AnalyticsPropertyName = keyof typeof sharedPropertyValues;
export type AnalyticsProperties = Partial<{
  [Key in AnalyticsPropertyName]: (typeof sharedPropertyValues)[Key][number];
}>;

const activateRiEventProperties = {
  event_cta_clicked: ["action", "feature", "placement"],
  schedule_filter_used: ["filterCategory"],
  schedule_detail_opened: [],
  coverage_filter_used: ["filterCategory"],
  map_action: ["action"],
  hunter_import_attempted: ["importMethod"],
  hunter_import_succeeded: ["importMethod"],
  hunter_import_failed: ["errorCode", "importMethod"],
  hunter_checklist_resumed: [],
  hunter_manual_override_used: [],
  hunter_schedule_details_opened: [],
  volunteer_form_started: [],
  volunteer_validation_failed: [],
  volunteer_submit_attempted: [],
} as const satisfies Record<string, readonly AnalyticsPropertyName[]>;

export const analyticsEventProperties = {
  "activate-ri-2026": activateRiEventProperties,
} as const;

export type AnalyticsEventName = keyof typeof activateRiEventProperties;

export type AnalyticsEvent = {
  schemaVersion: 1;
  scope: AnalyticsScope;
  name: AnalyticsEventName;
  anonymousId: string;
  properties?: AnalyticsProperties;
};

export function parseAnalyticsEvent(value: unknown): AnalyticsEvent | null {
  if (!isRecord(value) || !hasOnlyKeys(value, [
    "anonymousId",
    "name",
    "properties",
    "schemaVersion",
    "scope",
  ])) {
    return null;
  }

  if (
    value.schemaVersion !== 1 ||
    value.scope !== "activate-ri-2026" ||
    typeof value.name !== "string" ||
    !(value.name in activateRiEventProperties) ||
    typeof value.anonymousId !== "string" ||
    !uuidPattern.test(value.anonymousId)
  ) {
    return null;
  }

  const name = value.name as AnalyticsEventName;
  const properties = value.properties;
  if (properties !== undefined && !isRecord(properties)) {
    return null;
  }

  const allowedProperties = activateRiEventProperties[name];
  for (const [key, propertyValue] of Object.entries(properties ?? {})) {
    if (!allowedProperties.includes(key as never)) {
      return null;
    }
    const allowedValues = sharedPropertyValues[key as AnalyticsPropertyName];
    if (!allowedValues || !allowedValues.includes(propertyValue as never)) {
      return null;
    }
  }

  return value as AnalyticsEvent;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOnlyKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).every((key) => keys.includes(key));
}

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
