import { describe, expect, it, vi } from "vitest";
import { handleActivateRiApi } from "./activate-ri";
import type { Env } from "../env";

function env(): Env {
  return {
    ACTIVATE_RI_EVENT_ID: "activate-ri-2026",
    TURNSTILE_REQUIRED: "false",
    ASSETS: { fetch: vi.fn() } as unknown as Fetcher,
    DB: {
      prepare: vi.fn(() => ({
        bind: vi.fn().mockReturnThis(),
        run: vi.fn(async () => ({ success: true })),
        all: vi.fn(),
        first: vi.fn(),
      })),
      batch: vi.fn(async () => []),
    } as unknown as D1Database,
  };
}

function validPayload(): unknown {
  return {
    submitterCallsign: "N1RWJ",
    submitterName: "Rob Jackson",
    submitterEmail: "rob@example.com",
    stops: [
      {
        parkReference: "US-2868",
        plannedDate: "2026-09-11",
        startTime: "09:00",
        endTime: "11:00",
        bands: ["40m"],
        modes: ["SSB"],
      },
    ],
  };
}

function post(path: string, payload: unknown): Request {
  return new Request(`https://ripota.org${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
}

describe("handleActivateRiApi", () => {
  it("accepts valid route submissions for organizer review", async () => {
    const testEnv = env();
    const response = await handleActivateRiApi(
      post("/api/activate-ri-2026/routes", validPayload()),
      testEnv,
    );

    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toEqual({
      ok: true,
      message: "Submission received for organizer review.",
    });
    expect(testEnv.DB.batch).toHaveBeenCalledOnce();
  });

  it("returns validation errors for invalid route submissions", async () => {
    const response = await handleActivateRiApi(
      post("/api/activate-ri-2026/routes", {
        submitterCallsign: "not a call sign!",
        submitterName: "",
        submitterEmail: "not-email",
        stops: [],
      }),
      env(),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      ok: false,
      errors: expect.arrayContaining([
        "Enter a valid activator callsign.",
        "Enter the activator name.",
        "Enter a valid email address.",
        "Add at least one activation stop.",
      ]),
    });
  });

  it("returns validation errors for non-object JSON payloads", async () => {
    const response = await handleActivateRiApi(
      post("/api/activate-ri-2026/routes", null),
      env(),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      ok: false,
      errors: ["Enter a valid route submission."],
    });
  });

  it("returns readJson responses for unsupported content types", async () => {
    const response = await handleActivateRiApi(
      new Request("https://ripota.org/api/activate-ri-2026/routes", {
        method: "POST",
        headers: { "content-type": "text/plain" },
        body: "hello",
      }),
      env(),
    );

    expect(response.status).toBe(415);
    await expect(response.text()).resolves.toBe("Expected application/json");
  });

  it("returns JSON 404 for unknown Activate RI API routes", async () => {
    const response = await handleActivateRiApi(
      new Request("https://ripota.org/api/activate-ri-2026/missing"),
      env(),
    );

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({
      ok: false,
      error: "Not found",
    });
  });
});
