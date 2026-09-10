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

  try {
    const body = JSON.stringify({
      schemaVersion: 2,
      scope,
      name,
      anonymousId: analyticsSubjectId(scope),
      eventId: crypto.randomUUID(),
      occurredAt: new Date().toISOString(),
      properties: { ...properties, pageCategory: pageCategory() },
    });
    // D1 deduplicates this exact event ID. Keep retries bounded and in memory;
    // expired or opted-out browser activity must not be uploaded later.
    for (let attempt = 0; attempt < 2; attempt += 1) {
      if (privacySignalEnabled()) return;
      let delayMs = 1_000;
      try {
        const response = await fetch("/api/analytics/events", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body,
          credentials: "omit",
          keepalive: true,
          referrerPolicy: "no-referrer",
        });
        if (response.ok) return;
        if (response.status !== 429 && response.status < 500) {
          console.warn("Anonymous analytics event rejected", response.status);
          return;
        }
        if (response.status === 429) {
          const retrySeconds = Number(response.headers.get("retry-after") ?? "60");
          // Do not retry before a server's long cooldown or create a durable queue.
          if (!Number.isFinite(retrySeconds) || retrySeconds > 60) return;
          delayMs = Math.max(1_000, retrySeconds * 1_000);
        }
      } catch { /* A lost response can be retried safely with the same event ID. */ }
      if (attempt === 0) await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
    console.warn("Anonymous analytics event could not be collected");
  } catch {
    // Analytics must never interrupt the feature being measured.
  }
}

function pageCategory(): NonNullable<AnalyticsProperties["pageCategory"]> {
  const path = typeof location === "undefined" ? "" : location.pathname;
  if (/^\/activate-ri-2026\/hunter\/?$/.test(path)) return "hunter";
  if (/^\/activate-ri-2026\/schedule\/?$/.test(path)) return "schedule";
  if (/^\/activate-ri-2026\/volunteer\/?$/.test(path)) return "volunteer";
  if (path.startsWith("/activate-ri-2026/")) return "event";
  return "other";
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
