import { afterEach, describe, expect, it, vi } from "vitest";
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

  it("approves plans when the browser URL-encodes the activator id", async () => {
    const db = createMigratedSqliteD1();
    cleanup = db.close;
    const env = testEnv(db.DB);

    const submitResponse = await handleActivateRiApi(
      jsonRequest("/api/activate-ri-2026/plans", volunteerPayload()),
      env,
    );
    expect(submitResponse.status).toBe(202);

    const pendingResponse = await handleActivateRiApi(
      adminRequest("/api/activate-ri-2026/admin/plans"),
      env,
    );
    expect(pendingResponse.status).toBe(200);
    const pendingBody = (await pendingResponse.json()) as {
      plans: Array<{ id: string }>;
    };
    expect(pendingBody.plans).toHaveLength(1);
    expect(pendingBody.plans[0].id).toContain(":");

    const encodedPlanId = encodeURIComponent(pendingBody.plans[0].id);
    const approveResponse = await handleActivateRiApi(
      adminRequest(`/api/activate-ri-2026/admin/plans/${encodedPlanId}/approve`, {
        method: "POST",
      }),
      env,
    );

    expect(approveResponse.status).toBe(200);
    await expect(approveResponse.json()).resolves.toEqual({ ok: true });
  });

  it("merges repeated submissions for the same activator into one editable stop list", async () => {
    const db = createMigratedSqliteD1();
    cleanup = db.close;
    const env = {
      ...testEnv(db.DB),
      ALLOW_LOCAL_ADMIN_AUTH: "true" as const,
    };

    const firstResponse = await handleActivateRiApi(
      jsonRequest("/api/activate-ri-2026/plans", volunteerPayload()),
      env,
    );
    expect(firstResponse.status).toBe(202);
    const firstBody = (await firstResponse.json()) as { editUrl: string };
    const firstEditPath = editApiPlansPath(firstBody.editUrl);

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

    const firstEditResponse = await handleActivateRiApi(
      new Request(`https://ripota.org${firstEditPath}`),
      env,
    );
    expect(firstEditResponse.status).toBe(200);
    const firstEditBody = (await firstEditResponse.json()) as {
      plans: Array<{ stops: Array<{ park_reference: string }> }>;
    };
    expect(firstEditBody.plans[0].stops).toEqual([
      expect.objectContaining({ park_reference: "US-2868" }),
      expect.objectContaining({ park_reference: "US-2869" }),
    ]);

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

  it("keeps an existing edit link working after a resend request", async () => {
    const db = createMigratedSqliteD1();
    cleanup = db.close;
    const env = {
      ...testEnv(db.DB),
      ALLOW_LOCAL_ADMIN_AUTH: "true" as const,
      ACTIVATE_RI_EMAIL_FROM: "activate-ri-2026@ripota.org",
      EMAIL: {
        send: vi.fn(async () => ({ messageId: "test-message" })),
      } as unknown as SendEmail,
    };

    const submitResponse = await handleActivateRiApi(
      jsonRequest("/api/activate-ri-2026/plans", volunteerPayload()),
      env,
    );
    expect(submitResponse.status).toBe(202);
    const submitBody = (await submitResponse.json()) as { editUrl: string };
    const firstEditPath = editApiPlansPath(submitBody.editUrl);

    const resendResponse = await handleActivateRiApi(
      jsonRequest("/api/activate-ri-2026/resend-edit-link", {
        callsign: "N1RWJ",
        email: "rob@example.com",
      }),
      env,
    );
    expect(resendResponse.status).toBe(200);

    const firstEditResponse = await handleActivateRiApi(
      new Request(`https://ripota.org${firstEditPath}`),
      env,
    );
    expect(firstEditResponse.status).toBe(200);
    await expect(firstEditResponse.json()).resolves.toMatchObject({
      ok: true,
      plans: [
        {
          submitter_callsign: "N1RWJ",
          submitter_email: "rob@example.com",
        },
      ],
    });
  });

  it("checks whether a callsign and email already have an activation without sending email", async () => {
    const db = createMigratedSqliteD1();
    cleanup = db.close;
    const sendEmail = vi.fn(async () => ({ messageId: "test-message" }));
    const env = {
      ...testEnv(db.DB),
      ACTIVATE_RI_EMAIL_FROM: "activate-ri-2026@ripota.org",
      EMAIL: {
        send: sendEmail,
      } as unknown as SendEmail,
    };

    const submitResponse = await handleActivateRiApi(
      jsonRequest("/api/activate-ri-2026/plans", volunteerPayload()),
      env,
    );
    expect(submitResponse.status).toBe(202);
    sendEmail.mockClear();

    const matchResponse = await handleActivateRiApi(
      jsonRequest("/api/activate-ri-2026/activation-lookup", {
        callsign: "n1rwj",
        email: "ROB@example.com",
      }),
      env,
    );
    expect(matchResponse.status).toBe(200);
    await expect(matchResponse.json()).resolves.toEqual({
      ok: true,
      exists: true,
    });
    expect(sendEmail).not.toHaveBeenCalled();

    const missResponse = await handleActivateRiApi(
      jsonRequest("/api/activate-ri-2026/activation-lookup", {
        callsign: "K1ABC",
        email: "rob@example.com",
      }),
      env,
    );
    expect(missResponse.status).toBe(200);
    await expect(missResponse.json()).resolves.toEqual({
      ok: true,
      exists: false,
    });
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

  it("does not email admins for approval when an approved activator adds stops", async () => {
    const db = createMigratedSqliteD1();
    cleanup = db.close;
    const env = {
      ...testEnv(db.DB),
      ACTIVATE_RI_ADMIN_EMAILS: "admin@example.com",
      EMAIL: {
        send: async () => ({ messageId: "test-message" }),
      } as unknown as SendEmail,
    };
    const sendEmail = vi.fn(async () => ({ messageId: "test-message" }));
    env.EMAIL = { send: sendEmail } as unknown as SendEmail;

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

    const adminApprovalEmails = (sendEmail.mock.calls as unknown[][])
      .map(([message]) => message as unknown as { subject?: string; to?: unknown })
      .filter((message) =>
        message.subject === "Activate RI approval needed: N1RWJ"
      );
    expect(adminApprovalEmails).toHaveLength(1);
    expect(adminApprovalEmails[0].to).toEqual(["admin@example.com"]);
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

function editApiPlansPath(editUrl: string): string {
  const editPath = new URL(editUrl).pathname.replace(/\/$/, "");
  return editPath.replace(
    "/activate-ri-2026/edit/",
    "/api/activate-ri-2026/edit/",
  ) + "/plans";
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
