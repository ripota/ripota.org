import type {
  AnalyticsEventName,
  AnalyticsProperties,
  AnalyticsScope,
} from "./events";

const storageKey = "ripota:analytics:subjects:v1";
const subjectExpiry = "2026-12-31T23:59:59.999Z";
let pageSubjectId: string | null = null;

type StoredSubjects = Partial<Record<AnalyticsScope, {
  id: string;
  expiresAt: string;
}>>;

export async function trackAnalyticsEvent(
  scope: AnalyticsScope,
  name: AnalyticsEventName,
  properties?: AnalyticsProperties,
): Promise<void> {
  if (privacySignalEnabled()) return;

  const anonymousId = analyticsSubjectId(scope);
  try {
    await fetch("/api/analytics/events", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        schemaVersion: 1,
        scope,
        name,
        anonymousId,
        ...(properties && Object.keys(properties).length > 0 ? { properties } : {}),
      }),
      credentials: "omit",
      keepalive: true,
      referrerPolicy: "no-referrer",
    });
  } catch {
    // Analytics must never interrupt the feature being measured.
  }
}

export function privacySignalEnabled(): boolean {
  if (typeof navigator === "undefined") return true;
  if (typeof location !== "undefined" && isPrivatePath(location.pathname)) return true;
  const privacyNavigator = navigator as Navigator & { globalPrivacyControl?: boolean };
  return privacyNavigator.globalPrivacyControl === true || navigator.doNotTrack === "1";
}

function analyticsSubjectId(scope: AnalyticsScope): string {
  try {
    const now = Date.now();
    const stored = parseStoredSubjects(localStorage.getItem(storageKey));
    const existing = stored[scope];
    if (existing && Date.parse(existing.expiresAt) > now && isUuid(existing.id)) {
      return existing.id;
    }

    const id = crypto.randomUUID();
    stored[scope] = { id, expiresAt: subjectExpiry };
    localStorage.setItem(storageKey, JSON.stringify(stored));
    return id;
  } catch {
    pageSubjectId ??= crypto.randomUUID();
    return pageSubjectId;
  }
}

function parseStoredSubjects(value: string | null): StoredSubjects {
  if (!value) return {};
  try {
    const parsed: unknown = JSON.parse(value);
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
      ? parsed as StoredSubjects
      : {};
  } catch {
    return {};
  }
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function isPrivatePath(pathname: string): boolean {
  return pathname.startsWith("/account/") ||
    pathname.startsWith("/activate-ri-2026/activator/") ||
    pathname.startsWith("/activate-ri-2026/admin/");
}
