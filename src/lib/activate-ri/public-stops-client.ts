import { publicDataPath } from "./paths";
import type { PublicActivationStop } from "./types";

const liveStopsPath = "/api/activate-ri-2026/public/stops";
const staticStopsPath = publicDataPath("stops");

type Fetcher = (input: string, init?: RequestInit) => Promise<Response>;

type PublicStopsResponse = {
  ok?: boolean;
  stops?: PublicActivationStop[];
  generatedAt?: string | null;
};

export async function fetchPublicActivationStops(
  fetcher: Fetcher = fetch,
): Promise<PublicActivationStop[]> {
  const liveResult = await fetchPublicStops(fetcher, liveStopsPath);
  if (liveResult !== null) {
    return liveResult;
  }

  // Astro's dev server has no Worker API, so it can use a generated local export.
  // Production consumers present these stops as current plans and cannot label
  // a stale snapshot. Report an outage instead of silently replacing live data.
  if (import.meta.env.DEV) {
    const staticResult = await fetchPublicStops(fetcher, staticStopsPath);
    if (staticResult !== null) {
      return staticResult;
    }
  }

  throw new Error("Public stops response was unavailable.");
}

async function fetchPublicStops(
  fetcher: Fetcher,
  path: string,
): Promise<PublicActivationStop[] | null> {
  try {
    const response = await fetcher(path, {
      headers: { accept: "application/json" },
    });
    if (!response.ok) {
      return null;
    }

    const data = (await response.json()) as PublicStopsResponse;
    if (!data.ok || !Array.isArray(data.stops)) {
      return null;
    }

    // The checked-in { stops: [], generatedAt: null } file is a placeholder,
    // not evidence that no activators have scheduled a park.
    if (path === staticStopsPath && (
      typeof data.generatedAt !== "string" || !Number.isFinite(Date.parse(data.generatedAt))
    )) {
      return null;
    }

    return data.stops;
  } catch {
    return null;
  }
}
