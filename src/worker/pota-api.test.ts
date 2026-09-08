import { afterEach, describe, expect, it, vi } from "vitest";

import { fetchPotaApi, potaApiUserAgent } from "./pota-api";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("POTA API transport", () => {
  it("uses the runtime fetch with shared identification and a ten-second deadline", async () => {
    const response = Response.json([]);
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(response);
    vi.stubGlobal("fetch", fetcher);
    const signal = new AbortController().signal;
    const timeout = vi.spyOn(AbortSignal, "timeout").mockReturnValue(signal);

    await expect(fetchPotaApi("/spot/comments/N1BS%2FP/US-10545?count=all"))
      .resolves.toBe(response);

    expect(fetcher).toHaveBeenCalledExactlyOnceWith(
      "https://api.pota.app/spot/comments/N1BS%2FP/US-10545?count=all",
      {
        headers: {
          accept: "application/json",
          "user-agent": potaApiUserAgent,
        },
        signal,
      },
    );
    expect(timeout).toHaveBeenCalledExactlyOnceWith(10_000);
    expect(response.bodyUsed).toBe(false);
  });

  it("leaves HTTP failures and retry metadata intact for caller backoff", async () => {
    const response = new Response("Rate limited", {
      status: 429,
      headers: { "retry-after": "60" },
    });
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(response);

    await expect(fetchPotaApi("/spot/activator", { fetcher })).resolves.toBe(response);

    expect(fetcher).toHaveBeenCalledOnce();
    expect(response.bodyUsed).toBe(false);
    expect(response.headers.get("retry-after")).toBe("60");
  });

  it.each([
    new TypeError("Network error"),
    new DOMException("Timed out", "TimeoutError"),
  ])("preserves $name failures for caller error classification", async (error) => {
    const fetcher = vi.fn<typeof fetch>().mockRejectedValue(error);

    await expect(fetchPotaApi("/spot/activator", { fetcher })).rejects.toBe(error);

    expect(fetcher).toHaveBeenCalledOnce();
  });
});
