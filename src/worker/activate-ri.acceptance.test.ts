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
        startTime: "13:00",
        endTime: "16:00",
        bands: ["40m"],
        modes: ["SSB"],
        status: "scheduled",
      }),
    ]);
  });

  it("merges repeated submissions for the same activator into one editable stop list", async () => {
    const db = createMigratedSqliteD1();
    cleanup = db.close;
    const env = testEnv(db.DB);

    const firstResponse = await handleActivateRiApi(
      jsonRequest("/api/activate-ri-2026/plans", volunteerPayload()),
      env,
    );
    expect(firstResponse.status).toBe(202);

    const secondResponse = await handleActivateRiApi(
      jsonRequest("/api/activate-ri-2026/plans", {
        ...volunteerPayload(),
        stops: [
          {
            parkReference: "US-2869",
            plannedDate: "2026-09-12",
            timeBlock: "10:00-13:00",
            bands: ["20m"],
            modes: ["CW"],
          },
        ],
      }),
      env,
    );
    expect(secondResponse.status).toBe(202);

    const pendingResponse = await handleActivateRiApi(
      adminRequest("/api/activate-ri-2026/admin/plans"),
      env,
    );
    expect(pendingResponse.status).toBe(200);
    const pendingBody = (await pendingResponse.json()) as {
      plans: Array<{
        submitter_callsign: string;
        submitter_email: string;
        stops: Array<{ park_reference: string; status: string }>;
      }>;
    };

    expect(pendingBody.plans).toHaveLength(1);
    expect(pendingBody.plans[0]).toMatchObject({
      submitter_callsign: "N1RWJ",
      submitter_email: "rob@example.com",
    });
    expect(pendingBody.plans[0].stops).toEqual([
      expect.objectContaining({
        park_reference: "US-2868",
        status: "pending-review",
      }),
      expect.objectContaining({
        park_reference: "US-2869",
        status: "pending-review",
      }),
    ]);
  });

  it("publishes new stops immediately for an already approved activator", async () => {
    const db = createMigratedSqliteD1();
    cleanup = db.close;
    const env = testEnv(db.DB);

    const firstResponse = await handleActivateRiApi(
      jsonRequest("/api/activate-ri-2026/plans", volunteerPayload()),
      env,
    );
    expect(firstResponse.status).toBe(202);

    const pendingResponse = await handleActivateRiApi(
      adminRequest("/api/activate-ri-2026/admin/plans"),
      env,
    );
    const pendingBody = (await pendingResponse.json()) as {
      plans: Array<{ id: string }>;
    };
    expect(pendingBody.plans).toHaveLength(1);

    const approveResponse = await handleActivateRiApi(
      adminRequest(`/api/activate-ri-2026/admin/plans/${pendingBody.plans[0].id}/approve`, {
        method: "POST",
      }),
      env,
    );
    expect(approveResponse.status).toBe(200);

    const secondResponse = await handleActivateRiApi(
      jsonRequest("/api/activate-ri-2026/plans", {
        ...volunteerPayload(),
        stops: [
          {
            parkReference: "US-2869",
            plannedDate: "2026-09-12",
            timeBlock: "10:00-13:00",
            bands: ["20m"],
            modes: ["CW"],
          },
        ],
      }),
      env,
    );
    expect(secondResponse.status).toBe(202);

    const nextPendingResponse = await handleActivateRiApi(
      adminRequest("/api/activate-ri-2026/admin/plans"),
      env,
    );
    const nextPendingBody = (await nextPendingResponse.json()) as {
      plans: unknown[];
    };
    expect(nextPendingBody.plans).toHaveLength(0);

    const publicResponse = await handleActivateRiApi(
      new Request("https://ripota.org/api/activate-ri-2026/public/stops"),
      env,
    );
    const publicBody = (await publicResponse.json()) as {
      stops: Array<{
        parkReference: string;
        activatorCallsign: string;
        status: string;
      }>;
    };
    expect(publicBody.stops).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          parkReference: "US-2868",
          activatorCallsign: "N1RWJ",
          status: "scheduled",
        }),
        expect.objectContaining({
          parkReference: "US-2869",
          activatorCallsign: "N1RWJ",
          status: "scheduled",
        }),
      ]),
    );
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
        timeBlock: "13:00-16:00",
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
