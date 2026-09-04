export type PublicParkEvidence = {
  qsoDate: string;
  activeCallsign: string;
  totalQsos: number;
  qsosCw: number;
  qsosData: number;
  qsosPhone: number;
};

export type PublicParkObservation = {
  spotDate: string;
  activeCallsign: string;
  lastObservedAt: string;
  frequency: string;
  mode: string;
  sourceLabel: string;
  spotterCallsign: string;
  evidenceKind: "structured_spot" | "declared_nfer";
  declaredByReference: string | null;
};

export type PublicParkPotaStatus = {
  reference: string;
  name: string;
  potaUrl: string;
  status: "confirmed" | "observed" | "scheduled" | "needed";
  live: boolean;
  scheduled: boolean;
  observed: boolean;
  attemptRecorded: boolean;
  confirmation: PublicParkEvidence | null;
  confirmations: PublicParkEvidence[];
  attempts: PublicParkEvidence[];
  lastObservation: PublicParkObservation | null;
};

export type PublicPotaParkStatusSnapshot = {
  generatedAt: string;
  lastPotaSyncAt: string | null;
  lastSpotIngestAt: string | null;
  stale: boolean;
  warning: string | null;
  eventWindow: { startDate: string; endDate: string; timezone: "UTC" };
  summary: {
    total: number;
    confirmed: number;
    observedNotConfirmed: number;
    scheduledNotConfirmed: number;
    stillNeeded: number;
    withoutConfirmation: number;
  };
  parks: PublicParkPotaStatus[];
};

type Fetcher = (input: string, init?: RequestInit) => Promise<Response>;

export async function fetchPublicPotaParkStatus(
  fetcher: Fetcher = fetch,
): Promise<PublicPotaParkStatusSnapshot> {
  const response = await fetcher("/api/activate-ri-2026/public/park-status", {
    headers: { accept: "application/json" },
  });
  if (!response.ok) throw new Error("Park evidence response was unavailable.");
  const value: unknown = await response.json();
  if (!isRecord(value) || value.ok !== true || !validSnapshot(value)) {
    throw new Error("Park evidence response was invalid.");
  }
  return value as unknown as PublicPotaParkStatusSnapshot;
}

function validSnapshot(value: Record<string, unknown>): boolean {
  return typeof value.generatedAt === "string" &&
    typeof value.stale === "boolean" &&
    (value.warning === null || typeof value.warning === "string") &&
    isRecord(value.summary) &&
    typeof value.summary.total === "number" &&
    typeof value.summary.confirmed === "number" &&
    typeof value.summary.observedNotConfirmed === "number" &&
    typeof value.summary.scheduledNotConfirmed === "number" &&
    typeof value.summary.stillNeeded === "number" &&
    typeof value.summary.withoutConfirmation === "number" &&
    Array.isArray(value.parks) && value.parks.every(validPark);
}

function validPark(value: unknown): boolean {
  return isRecord(value) &&
    typeof value.reference === "string" &&
    typeof value.name === "string" &&
    ["confirmed", "observed", "scheduled", "needed"].includes(String(value.status)) &&
    typeof value.live === "boolean" &&
    typeof value.scheduled === "boolean" &&
    typeof value.observed === "boolean" &&
    typeof value.attemptRecorded === "boolean" &&
    Array.isArray(value.confirmations) &&
    Array.isArray(value.attempts);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
