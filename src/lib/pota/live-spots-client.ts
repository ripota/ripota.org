import type { LivePotaSpot } from "./spots";

const liveSpotsPath = "/api/pota/spots";

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
