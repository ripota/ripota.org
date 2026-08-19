import references from "../../data/ri-references.json";
import { normalizeRiPotaSpots } from "../../lib/pota/spots";
import { json } from "../http";

const upstreamSpotsUrl = "https://api.pota.app/spot/activator";
const publicCacheControl = "public, max-age=30, s-maxage=60";
const parkNames = new Map(
  references.map((reference) => [reference.reference, reference.name]),
);

type WorkerCacheStorage = CacheStorage & { default?: Cache };

export async function handlePotaSpots(
  request: Request,
  ctx?: ExecutionContext,
): Promise<Response> {
  const cache = (globalThis.caches as WorkerCacheStorage | undefined)?.default;
  const cacheKey = new Request(new URL(request.url).origin + "/api/pota/spots", {
    headers: { accept: "application/json" },
  });
  const bypassCache = cacheBypassRequested(request);

  if (cache && !bypassCache) {
    const cachedResponse = await cache.match(cacheKey);
    if (cachedResponse) {
      return cachedResponse;
    }
  }

  let upstreamResponse: Response;
  try {
    upstreamResponse = await fetch(upstreamSpotsUrl, {
      headers: {
        accept: "application/json",
        "user-agent": "ripota.org live Rhode Island POTA spots",
      },
    });
  } catch {
    return unavailableResponse();
  }

  if (!upstreamResponse.ok) {
    return unavailableResponse();
  }

  let upstreamData: unknown;
  try {
    upstreamData = await upstreamResponse.json();
  } catch {
    return unavailableResponse();
  }

  if (!Array.isArray(upstreamData)) {
    return unavailableResponse();
  }

  const response = json(
    {
      ok: true,
      generatedAt: new Date().toISOString(),
      spots: normalizeRiPotaSpots(upstreamData, { parkNames }),
    },
    {
      headers: {
        "cache-control": publicCacheControl,
        "x-content-type-options": "nosniff",
      },
    },
  );

  if (!cache || bypassCache) {
    return response;
  }

  const cachePut = cache.put(cacheKey, response.clone());
  if (ctx) {
    ctx.waitUntil(cachePut);
  } else {
    await cachePut;
  }

  return response;
}

function cacheBypassRequested(request: Request): boolean {
  const cacheControl = request.headers.get("cache-control")?.toLowerCase() ?? "";
  return cacheControl
    .split(",")
    .map((directive) => directive.trim())
    .some((directive) => directive === "no-cache" || directive === "no-store");
}

function unavailableResponse(): Response {
  return json(
    { ok: false, error: "Live POTA spots are temporarily unavailable." },
    {
      status: 502,
      headers: {
        "cache-control": "no-store",
        "x-content-type-options": "nosniff",
      },
    },
  );
}
