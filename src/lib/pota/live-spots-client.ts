import type { LivePotaSpot } from "./spots";

const liveSpotsPath = "/api/pota/spots";
const staleWarningAgeMilliseconds = 5 * 60_000;

type Fetcher = (input: string, init?: RequestInit) => Promise<Response>;

export type LivePotaSpotsSnapshot = {
  spots: LivePotaSpot[];
  generatedAt: string;
  stale: boolean;
};

type LiveSpotsResponse = {
  ok?: boolean;
  spots?: LivePotaSpot[];
  generatedAt?: string;
  stale?: boolean;
};

export async function fetchLivePotaSpots(
  fetcher: Fetcher = fetch,
): Promise<LivePotaSpotsSnapshot> {
  const response = await fetcher(liveSpotsPath, {
    cache: "no-store",
    headers: { accept: "application/json" },
  });
  if (!response.ok) {
    throw new Error("Live POTA spots response was unavailable.");
  }

  const data = (await response.json()) as LiveSpotsResponse;
  if (
    !data.ok ||
    !Array.isArray(data.spots) ||
    typeof data.generatedAt !== "string" ||
    typeof data.stale !== "boolean"
  ) {
    throw new Error("Live POTA spots response was invalid.");
  }

  return {
    spots: data.spots,
    generatedAt: data.generatedAt,
    stale: data.stale,
  };
}

export function shouldWarnAboutStaleSnapshot(
  snapshot: LivePotaSpotsSnapshot,
  now: Date = new Date(),
): boolean {
  if (!snapshot.stale) {
    return false;
  }

  const generatedAt = new Date(snapshot.generatedAt).valueOf();
  const age = now.valueOf() - generatedAt;
  return !Number.isFinite(age) || age >= staleWarningAgeMilliseconds;
}
