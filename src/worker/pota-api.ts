export const potaApiUserAgent = "ripota.org (+https://ripota.org)";

const potaApiOrigin = "https://api.pota.app";
const potaApiTimeoutMilliseconds = 10_000;

type PotaApiOptions = {
  fetcher?: typeof fetch;
};

// All outbound POTA API requests go through this transport so identification,
// timeouts, and future rate limiting have one home. Callers own caching,
// backoff, and response validation.
export function fetchPotaApi(
  path: `/${string}`,
  options: PotaApiOptions = {},
): Promise<Response> {
  const fetcher = options.fetcher ?? fetch;
  return fetcher(`${potaApiOrigin}${path}`, {
    headers: {
      accept: "application/json",
      "user-agent": potaApiUserAgent,
    },
    signal: AbortSignal.timeout(potaApiTimeoutMilliseconds),
  });
}
