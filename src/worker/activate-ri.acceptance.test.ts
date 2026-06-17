import { afterEach, describe, expect, it } from "vitest";
import type { Env } from "./env";
import { handleActivateRiApi } from "./routes/activate-ri";
import { createMigratedSqliteD1 } from "./test-utils/sqlite-d1";

const adminEmail = "organizer@example.com";

let cleanup: (() => void) | undefined;

afterEach(() => {
  cleanup?.();
  cleanup = undefined;
});

describe("Activate RI API acceptance flow", () => {
  it("saves a volunteer plan, lists it for admins, approves it, and publishes it publicly", async () => {
    const db = createMigratedSqliteD1();
    cleanup = db.close;
    const env = testEnv(db.DB);

    const submitResponse = await handleActivateRiApi(
      jsonRequest("/api/activate-ri-2026/plans", volunteerPayload()),
      env,
    );
    expect(submitResponse.status).toBe(202);
    await expect(submitResponse.json()).resolves.toMatchObject({
      ok: true,
      message: "Submission received for organizer review.",
    });

    const pendingResponse = await handleActivateRiApi(
      adminRequest("/api/activate-ri-2026/admin/plans"),
      env,
    );
    expect(pendingResponse.status).toBe(200);
    const pendingBody = (await pendingResponse.json()) as {
      plans: Array<{
        id: string;
        status: string;
        stops: Array<{ status: string }>;
      }>;
    };
    expect(pendingBody.plans).toHaveLength(1);
    expect(pendingBody.plans[0]).toMatchObject({
      status: "pending",
      stops: [{ status: "pending-review" }],
    });

    const planId = pendingBody.plans[0].id;
    const approveResponse = await handleActivateRiApi(
      adminRequest(`/api/activate-ri-2026/admin/plans/${planId}/approve`, {
        method: "POST",
      }),
      env,
    );
    expect(approveResponse.status).toBe(200);
    await expect(approveResponse.json()).resolves.toEqual({ ok: true });

    const publicResponse = await handleActivateRiApi(
      new Request("https://ripota.org/api/activate-ri-2026/public/stops"),
      env,
    );
    expect(publicResponse.status).toBe(200);
    const publicBody = (await publicResponse.json()) as {
      stops: Array<{
        parkReference: string;
        activatorCallsign: string;
        plannedDate: string;
        startTime: string;
        endTime: string;
        bands: string[];
        modes: string[];
        status: string;
      }>;
    };
    expect(publicBody.stops).toEqual([
      expect.objectContaining({
        parkReference: "US-2868",
        activatorCallsign: "N1RWJ",
        plannedDate: "2026-09-11",
        startTime: "09:00",
        endTime: "12:00",
        bands: ["40m"],
        modes: ["SSB"],
        status: "scheduled",
      }),
    ]);
  });
});

function testEnv(DB: D1Database): Env {
  return {
    ACTIVATE_RI_EVENT_ID: "activate-ri-2026",
    TURNSTILE_REQUIRED: "false",
    ALLOW_ADMIN_HEADER_AUTH: "true",
    ACTIVATE_RI_EMAIL_FROM: "activate-ri-2026@ripota.org",
    ASSETS: { fetch: async () => new Response("not used") } as unknown as Fetcher,
    DB,
    EMAIL: {
      send: async () => ({ messageId: "test-message" }),
    } as unknown as SendEmail,
  };
}

function volunteerPayload(): Record<string, unknown> {
  return {
    submitterCallsign: "N1RWJ",
    submitterName: "Rob Jackson",
    submitterEmail: "rob@example.com",
    club: "RI POTA",
    organizerNotes: "Acceptance test submission.",
    stops: [
      {
        parkReference: "US-2868",
        plannedDate: "2026-09-11",
        timeBlock: "09:00-12:00",
        bands: ["40m"],
        modes: ["SSB"],
        publicNotes: "Acceptance test public note.",
      },
    ],
  };
}

function jsonRequest(path: string, payload: unknown): Request {
  return new Request(`https://ripota.org${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
}

function adminRequest(path: string, init: RequestInit = {}): Request {
  return new Request(`https://ripota.org${path}`, {
    ...init,
    headers: {
      "Cf-Access-Authenticated-User-Email": adminEmail,
      ...init.headers,
    },
  });
}
