import { afterEach, describe, expect, it, vi } from "vitest";
import worker from "./index";
import type { Env } from "./env";
import { createMigratedSqliteD1 } from "./test-utils/sqlite-d1";

function env(): Env {
  return {
    ACTIVATE_RI_EVENT_ID: "activate-ri-2026",
    SITE_ORIGIN: "https://ripota.org",
    TURNSTILE_REQUIRED: "false",
    ALLOW_LOCAL_ADMIN_AUTH: "true",
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

function localRequest(path: string, init?: RequestInit): Request {
  return new Request(`http://127.0.0.1${path}`, init);
}

describe("worker routing", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("exchanges a legacy edit link for a private activator session", async () => {
    const testEnv = env();
    const database = createMigratedSqliteD1();
    testEnv.DB = database.DB;

    try {
      const submitResponse = await worker.fetch(
        request("/api/activate-ri-2026/plans", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            origin: "https://ripota.org",
          },
          body: JSON.stringify(volunteerPayload()),
        }),
        testEnv,
      );
      const submitBody = (await submitResponse.json()) as { editUrl: string };
      const editToken = new URL(submitBody.editUrl).hash.slice(1);

      const response = await worker.fetch(
        request(`/activate-ri-2026/edit/${encodeURIComponent(editToken)}/`),
        testEnv,
      );

      expect(response.status).toBe(303);
      expect(response.headers.get("location")).toBe(
        "https://ripota.org/activate-ri-2026/activator/plan/",
      );
      expect(response.headers.get("set-cookie")).toMatch(
        /^__Host-activate-ri-session=.+; Secure; HttpOnly; SameSite=Strict; Path=\/; Max-Age=1209600$/,
      );
      expect(response.headers.get("cache-control")).toBe("private, no-store");
      expect(response.headers.get("referrer-policy")).toBe("no-referrer");
      expect(testEnv.ASSETS.fetch).not.toHaveBeenCalled();
    } finally {
      database.close();
    }
  });

  it("does not disclose whether an invalid legacy edit token was once valid", async () => {
    const testEnv = env();
    const database = createMigratedSqliteD1();
    testEnv.DB = database.DB;

    try {
      const response = await worker.fetch(
        request("/activate-ri-2026/edit/not-a-real-token/"),
        testEnv,
      );

      expect(response.status).toBe(404);
      expect(response.headers.get("cache-control")).toBe("private, no-store");
      expect(testEnv.ASSETS.fetch).not.toHaveBeenCalled();
    } finally {
      database.close();
    }
  });

  it("redirects unauthenticated activator portal requests to access", async () => {
    const testEnv = env();
    const database = createMigratedSqliteD1();
    testEnv.DB = database.DB;

    try {
      const response = await worker.fetch(
        request("/activate-ri-2026/activator/plan/"),
        testEnv,
      );

      expect(response.status).toBe(303);
      expect(response.headers.get("location")).toBe(
        "https://ripota.org/activate-ri-2026/access/",
      );
      expect(response.headers.get("cache-control")).toBe("private, no-store");
      expect(testEnv.ASSETS.fetch).not.toHaveBeenCalled();
    } finally {
      database.close();
    }
  });

  it("protects the contextual activator account page", async () => {
    const testEnv = env();
    const database = createMigratedSqliteD1();
    testEnv.DB = database.DB;

    try {
      const response = await worker.fetch(
        request("/activate-ri-2026/activator/account/"),
        testEnv,
      );

      expect(response.status).toBe(303);
      expect(response.headers.get("location")).toBe(
        "https://ripota.org/activate-ri-2026/access/",
      );
      expect(response.headers.get("cache-control")).toBe("private, no-store");
      expect(testEnv.ASSETS.fetch).not.toHaveBeenCalled();
    } finally {
      database.close();
    }
  });

  it("serves the tokenless plan page to an authenticated activator", async () => {
    const testEnv = env();
    const database = createMigratedSqliteD1();
    testEnv.DB = database.DB;

    try {
      const submitResponse = await worker.fetch(
        request("/api/activate-ri-2026/plans", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            origin: "https://ripota.org",
          },
          body: JSON.stringify(volunteerPayload()),
        }),
        testEnv,
      );
      const submitBody = (await submitResponse.json()) as { editUrl: string };
      const token = new URL(submitBody.editUrl).hash.slice(1);
      const exchangeResponse = await worker.fetch(
        request(`/activate-ri-2026/edit/${encodeURIComponent(token)}/`),
        testEnv,
      );
      const cookie = exchangeResponse.headers.get("set-cookie")?.split(";", 1)[0];

      const response = await worker.fetch(
        request("/activate-ri-2026/activator/plan/", {
          headers: { cookie: cookie ?? "" },
        }),
        testEnv,
      );

      expect(response.status).toBe(200);
      await expect(response.text()).resolves.toBe("asset shell");
      expect(response.headers.get("cache-control")).toBe("private, no-store");
      expect(testEnv.ASSETS.fetch).toHaveBeenCalledOnce();
      await expect(database.DB.prepare(
        `SELECT feature, use_count FROM analytics_feature_usage
         WHERE scope = ? AND subject_type = 'activator'`,
      ).bind("activate-ri-2026").first()).resolves.toEqual({
        feature: "plan_editor",
        use_count: 1,
      });
    } finally {
      database.close();
    }
  });

  it("serves the access shell with private response headers", async () => {
    const testEnv = env();

    const response = await worker.fetch(
      request("/activate-ri-2026/access/"),
      testEnv,
    );

    expect(response.status).toBe(200);
    await expect(response.text()).resolves.toBe("asset shell");
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("x-robots-tag")).toBe("noindex, nofollow");
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

  it("routes public live POTA spots through the Worker adapter", async () => {
    const testEnv = env();
    const database = createMigratedSqliteD1();
    testEnv.DB = database.DB;
    vi.stubGlobal("fetch", vi.fn(async () => Response.json([])));

    try {
      const response = await worker.fetch(request("/api/pota/spots"), testEnv);

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toMatchObject({
        ok: true,
        stale: false,
        spots: [],
      });
      expect(testEnv.ASSETS.fetch).not.toHaveBeenCalled();
    } finally {
      database.close();
    }
  });

  it("routes the Activate All RI embed through the Worker without site chrome", async () => {
    const testEnv = env();

    const response = await worker.fetch(
      request("/embed/activate-ri-2026/?preview=unknown"),
      testEnv,
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe(
      "text/html; charset=utf-8",
    );
    expect(response.headers.get("cache-control")).toBe("no-store");
    await expect(response.text()).resolves.toContain("Activate All RI 2026");
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

  it.each([
    "/api/activate-ri-2026/admin/auth/access-bootstrap/start",
    "/api/auth/access-bootstrap/start",
  ])("routes administrator bootstrap at %s", async (path) => {
    const testEnv = {
      ...env(),
      ALLOW_LOCAL_ADMIN_AUTH: "false" as const,
      ALLOW_ADMIN_HEADER_AUTH: "true" as const,
      AUTH_BOOTSTRAP_ADMIN_EMAILS: "admin@example.com",
    };
    const database = createMigratedSqliteD1();
    testEnv.DB = database.DB;

    try {
      const response = await worker.fetch(
        request(path, {
          method: "POST",
          headers: {
            origin: "https://ripota.org",
            "Cf-Access-Authenticated-User-Email": "admin@example.com",
          },
        }),
        testEnv,
      );

      expect(response.status).toBe(200);
      expect(response.headers.get("set-cookie")).toMatch(
        /^__Host-ripota-session=.+; Secure; HttpOnly; SameSite=Strict; Path=\//,
      );
      await expect(response.json()).resolves.toMatchObject({ ok: true });
    } finally {
      database.close();
    }
  });

  it("serves the Activate RI admin page on localhost when local admin auth is enabled", async () => {
    const testEnv = {
      ...env(),
      ALLOW_LOCAL_ADMIN_AUTH: "true" as const,
      LOCAL_ADMIN_EMAIL: "local@example.com",
    };

    const response = await worker.fetch(
      localRequest("/activate-ri-2026/admin/"),
      testEnv,
    );

    expect(response.status).toBe(200);
    await expect(response.text()).resolves.toBe("asset shell");
    expect(testEnv.ASSETS.fetch).toHaveBeenCalledOnce();
  });

  it("does not allow local admin auth on non-localhost requests", async () => {
    const testEnv = {
      ...env(),
      ALLOW_LOCAL_ADMIN_AUTH: "true" as const,
    };

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
});

function volunteerPayload(): Record<string, unknown> {
  return {
    submitterCallsign: "N1RWJ",
    submitterName: "Rob Jackson",
    submitterEmail: "rob@example.com",
    stops: [
      {
        parkReference: "US-2868",
        plannedDate: "2026-09-11",
        timeBlock: "09:00-12:00",
        bands: ["40m"],
        modes: ["SSB"],
      },
    ],
  };
}
