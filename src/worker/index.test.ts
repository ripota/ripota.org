import { describe, expect, it, vi } from "vitest";
import worker from "./index";
import type { Env } from "./env";

function env(): Env {
  return {
    ACTIVATE_RI_EVENT_ID: "activate-ri-2026",
    TURNSTILE_REQUIRED: "false",
    ASSETS: {
      fetch: vi.fn(async () => new Response("asset shell")),
    } as unknown as Fetcher,
    DB: {
      prepare: vi.fn(),
      batch: vi.fn(async () => []),
    } as unknown as D1Database,
  };
}

function request(path: string, init?: RequestInit): Request {
  return new Request(`https://ripota.org${path}`, init);
}

describe("worker routing", () => {
  it("rewrites real Activate RI edit tokens to the static edit shell", async () => {
    const testEnv = env();

    const response = await worker.fetch(
      request("/activate-ri-2026/edit/abc123/?ignored=true"),
      testEnv,
    );

    expect(response.status).toBe(200);
    expect(testEnv.ASSETS.fetch).toHaveBeenCalledOnce();

    const assetRequest = vi.mocked(testEnv.ASSETS.fetch).mock
      .calls[0][0] as Request;
    expect(assetRequest.method).toBe("GET");
    expect(new URL(assetRequest.url).pathname).toBe(
      "/activate-ri-2026/edit/[token]/",
    );
    expect(new URL(assetRequest.url).search).toBe("");
  });

  it("rewrites HEAD edit token requests to the static edit shell", async () => {
    const testEnv = env();

    await worker.fetch(
      request("/activate-ri-2026/edit/abc123", { method: "HEAD" }),
      testEnv,
    );

    const assetRequest = vi.mocked(testEnv.ASSETS.fetch).mock
      .calls[0][0] as Request;
    expect(assetRequest.method).toBe("HEAD");
    expect(new URL(assetRequest.url).pathname).toBe(
      "/activate-ri-2026/edit/[token]/",
    );
  });

  it("keeps API requests on API routing", async () => {
    const testEnv = env();

    const response = await worker.fetch(
      request("/api/activate-ri-2026/health"),
      testEnv,
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      ok: true,
      eventId: "activate-ri-2026",
    });
    expect(testEnv.ASSETS.fetch).not.toHaveBeenCalled();
  });

  it("requires Access identity before serving the Activate RI admin page", async () => {
    const testEnv = env();

    const response = await worker.fetch(
      request("/activate-ri-2026/admin/"),
      testEnv,
    );

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({
      ok: false,
      error: "Unauthorized",
    });
    expect(testEnv.ASSETS.fetch).not.toHaveBeenCalled();
  });

  it("serves the Activate RI admin page for locally authorized admin requests", async () => {
    const testEnv = {
      ...env(),
      ALLOW_ADMIN_HEADER_AUTH: "true" as const,
    };

    const response = await worker.fetch(
      request("/activate-ri-2026/admin/", {
        headers: {
          "Cf-Access-Authenticated-User-Email": "admin@example.com",
        },
      }),
      testEnv,
    );

    expect(response.status).toBe(200);
    await expect(response.text()).resolves.toBe("asset shell");
    expect(testEnv.ASSETS.fetch).toHaveBeenCalledOnce();
  });
});
