import type { LivePotaSpot } from "./spots";

const liveSpotsPath = "/api/pota/spots";

type Fetcher = (input: string, init?: RequestInit) => Promise<Response>;

type LiveSpotsResponse = {
  ok?: boolean;
  spots?: LivePotaSpot[];
};

export async function fetchLivePotaSpots(
  fetcher: Fetcher = fetch,
): Promise<LivePotaSpot[]> {
  const response = await fetcher(liveSpotsPath, {
    headers: { accept: "application/json" },
  });
  if (!response.ok) {
    throw new Error("Live POTA spots response was unavailable.");
  }

  const data = (await response.json()) as LiveSpotsResponse;
  if (!data.ok || !Array.isArray(data.spots)) {
    throw new Error("Live POTA spots response was invalid.");
  }

  return data.spots;
}
