import type { AnalyticsScope } from "./events";

const dayMs = 86_400_000;

export function analyticsSubjectExpiry(scope: AnalyticsScope, now: number): string {
  return scope === "activate-ri-2026"
    ? "2026-12-31T23:59:59.999Z"
    : new Date(now + 90 * dayMs).toISOString();
}

// Minimum retention metadata, not a deletion schedule. No automatic purge.
export function analyticsRetainUntil(scope: AnalyticsScope, receivedAt: string): string {
  return scope === "activate-ri-2026"
    ? "2027-01-01T00:00:00.000Z"
    : new Date(Date.parse(receivedAt) + 365 * dayMs).toISOString();
}
