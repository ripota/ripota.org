import { afterEach, describe, expect, it, vi } from "vitest";
import type { Env } from "./env";
import { ActivateRiOpsRoom } from "./durable-objects/activate-ri-ops-room";
import { handleActivateRiApi } from "./routes/activate-ri";
import { createMigratedSqliteD1 } from "./test-utils/sqlite-d1";

let closeDatabase: (() => void) | undefined;

afterEach(() => {
  closeDatabase?.();
  closeDatabase = undefined;
});

describe("Activate RI Ops Room D1 flow", () => {
  it("starts off, enrolls approved activators, and syncs idempotent messages", async () => {
    const database = createMigratedSqliteD1();
    closeDatabase = database.close;
    const env = testEnv(database.DB);
    const { cookie, activatorId } = await approvedActivator(env);

    const offResponse = await handleActivateRiApi(
      sessionRequest("/api/activate-ri-2026/ops/bootstrap", cookie),
      env,
    );
    expect(offResponse.status).toBe(503);

    const adminState = await handleActivateRiApi(
      adminRequest("/api/activate-ri-2026/admin/ops"),
      env,
    );
    await expect(adminState.json()).resolves.toMatchObject({
      ok: true,
      hardDisabled: false,
      settings: { room_mode: "off", rules_version: "activate-ri-ops-v1" },
      members: [{ activator_id: activatorId, status: "active" }],
    });

    const modeResponse = await handleActivateRiApi(
      adminRequest("/api/activate-ri-2026/admin/ops/settings", {
        method: "PATCH",
        headers: jsonHeaders(),
        body: JSON.stringify({ roomMode: "full" }),
      }),
      env,
    );
    expect(modeResponse.status).toBe(200);
    expect(modeResponse.headers.get("cache-control")).toBe("private, no-store");

    const unacceptedBootstrap = await handleActivateRiApi(
      sessionRequest("/api/activate-ri-2026/ops/bootstrap", cookie),
      env,
    );
    const bootstrapBody = await unacceptedBootstrap.json() as {
      cursor: number;
      membership: { acceptedRulesVersion?: string };
      upcomingStops: Array<{ id: string; parkReference: string }>;
    };
    expect(bootstrapBody.membership.acceptedRulesVersion).toBeUndefined();
    expect(bootstrapBody.upcomingStops[0].parkReference).toBe("US-2868");
    expect(bootstrapBody.cursor).toBe(1);

    const acceptResponse = await handleActivateRiApi(
      sessionRequest("/api/activate-ri-2026/ops/rules/accept", cookie, {
        method: "POST",
        headers: jsonHeaders(cookie),
        body: "{}",
      }),
      env,
    );
    expect(acceptResponse.status).toBe(200);

    const clientNonce = "5c6a5518-0a13-46d0-9bca-d5897ea8c198";
    const postMessage = () => handleActivateRiApi(
      sessionRequest("/api/activate-ri-2026/ops/messages", cookie, {
        method: "POST",
        headers: jsonHeaders(cookie),
        body: JSON.stringify({
          clientNonce,
          kind: "need-backup",
          body: "Vehicle trouble; I may not reach this stop.",
          context: { type: "stop", stopId: bootstrapBody.upcomingStops[0].id },
        }),
      }),
      env,
    );
    const first = await postMessage();
    const duplicate = await postMessage();
    const firstBody = await first.json() as { event: { sequence: number; message: { id: string } } };
    const duplicateBody = await duplicate.json() as typeof firstBody;
    expect(first.status).toBe(200);
    expect(duplicateBody.event).toEqual(firstBody.event);

    const eventsResponse = await handleActivateRiApi(
      sessionRequest(
        `/api/activate-ri-2026/ops/events?after=0&through=${firstBody.event.sequence}&limit=250`,
        cookie,
      ),
      env,
    );
    const eventsBody = await eventsResponse.json() as { events: unknown[]; hasMore: boolean };
    expect(eventsBody.events).toHaveLength(2);
    expect(eventsBody.events).toEqual([
      expect.objectContaining({ type: "room-mode-changed", mode: "full" }),
      expect.objectContaining({
        type: "message-created",
        message: expect.objectContaining({
          id: firstBody.event.message.id,
          parkReference: "US-2868",
          body: "Vehicle trouble; I may not reach this stop.",
        }),
      }),
    ]);

    const counts = await env.DB.prepare(
      `SELECT
         (SELECT COUNT(*) FROM activate_ri_ops_messages) AS messages,
         (SELECT COUNT(*) FROM activate_ri_ops_events WHERE event_type = 'message-created') AS created_events`,
    ).first<{ messages: number; created_events: number }>();
    expect(counts).toEqual({ messages: 1, created_events: 1 });

    const resolveResponse = await handleActivateRiApi(
      sessionRequest(
        `/api/activate-ri-2026/ops/messages/${firstBody.event.message.id}/resolve`,
        cookie,
        { method: "POST", headers: jsonHeaders(cookie) },
      ),
      env,
    );
    expect(resolveResponse.status).toBe(200);
    await expect(resolveResponse.json()).resolves.toMatchObject({
      event: { type: "message-resolved" },
    });

    const reopenResponse = await handleActivateRiApi(
      sessionRequest(
        `/api/activate-ri-2026/ops/messages/${firstBody.event.message.id}/reopen`,
        cookie,
        { method: "POST", headers: jsonHeaders(cookie) },
      ),
      env,
    );
    expect(reopenResponse.status).toBe(200);

    const removeResponse = await handleActivateRiApi(
      sessionRequest(
        `/api/activate-ri-2026/ops/messages/${firstBody.event.message.id}/remove`,
        cookie,
        { method: "POST", headers: jsonHeaders(cookie) },
      ),
      env,
    );
    const removeBody = await removeResponse.json() as { event: { sequence: number } };
    expect(removeResponse.status).toBe(200);
    const removed = await env.DB.prepare(
      `SELECT body, removed_by FROM activate_ri_ops_messages WHERE id = ?`,
    ).bind(firstBody.event.message.id).first<{ body: string; removed_by: string }>();
    expect(removed).toEqual({ body: "", removed_by: "author" });

    const removalCatchup = await handleActivateRiApi(
      sessionRequest(
        `/api/activate-ri-2026/ops/events?after=${firstBody.event.sequence}&through=${removeBody.event.sequence}`,
        cookie,
      ),
      env,
    );
    await expect(removalCatchup.json()).resolves.toMatchObject({
      events: [
        { type: "message-resolved" },
        { type: "message-reopened" },
        { type: "message-removed", removedBy: "author" },
      ],
    });
  });

  it("preserves a moderated membership when an activator is approved again", async () => {
    const database = createMigratedSqliteD1();
    closeDatabase = database.close;
    const env = testEnv(database.DB);
    const { activatorId } = await approvedActivator(env);
    await env.DB.prepare(
      `UPDATE activate_ri_ops_memberships SET status = 'muted' WHERE activator_id = ?`,
    ).bind(activatorId).run();
    await env.DB.prepare(
      `UPDATE activate_ri_activators SET status = 'pending' WHERE id = ?`,
    ).bind(activatorId).run();

    const response = await handleActivateRiApi(
      adminRequest(`/api/activate-ri-2026/admin/plans/${encodeURIComponent(activatorId)}/approve`, {
        method: "POST",
      }),
      env,
    );
    expect(response.status).toBe(200);
    const membership = await env.DB.prepare(
      `SELECT status FROM activate_ri_ops_memberships WHERE activator_id = ?`,
    ).bind(activatorId).first<{ status: string }>();
    expect(membership?.status).toBe("muted");
  });

  it("enforces exact Origin and the deployment hard-disable", async () => {
    const database = createMigratedSqliteD1();
    closeDatabase = database.close;
    const env = testEnv(database.DB);
    const { cookie } = await approvedActivator(env);

    const crossOrigin = await handleActivateRiApi(
      adminRequest("/api/activate-ri-2026/admin/ops/settings", {
        method: "PATCH",
        headers: {
          "content-type": "application/json",
          origin: "https://attacker.example",
        },
        body: JSON.stringify({ roomMode: "full" }),
      }),
      env,
    );
    expect(crossOrigin.status).toBe(403);

    await handleActivateRiApi(
      adminRequest("/api/activate-ri-2026/admin/ops/settings", {
        method: "PATCH",
        headers: jsonHeaders(),
        body: JSON.stringify({ roomMode: "full" }),
      }),
      env,
    );
    env.ACTIVATE_RI_OPS_HARD_DISABLED = "true";
    const bootstrap = await handleActivateRiApi(
      sessionRequest("/api/activate-ri-2026/ops/bootstrap", cookie),
      env,
    );
    expect(bootstrap.status).toBe(503);
  });

  it("keeps announcement email explicit and enforces moderation separately from plan access", async () => {
    const database = createMigratedSqliteD1();
    closeDatabase = database.close;
    const env = testEnv(database.DB);
    const send = vi.fn(async () => ({ messageId: "announcement-email" }));
    const { cookie, activatorId } = await approvedActivator(env);
    env.EMAIL = { send } as unknown as SendEmail;
    env.ACTIVATE_RI_EMAIL_FROM = "activate-ri-2026@ripota.org";
    const background: Promise<unknown>[] = [];
    const ctx = {
      waitUntil(promise: Promise<unknown>) {
        background.push(promise);
      },
    } as unknown as ExecutionContext;

    const announcement = await handleActivateRiApi(
      adminRequest("/api/activate-ri-2026/admin/ops/announcements", {
        method: "POST",
        headers: jsonHeaders(),
        body: JSON.stringify({
          clientNonce: "2ce0cb69-587e-4e87-8d86-66c28cfbec27",
          body: "Coastal winds are increasing after 6 PM.",
          context: null,
          pin: true,
          emailEligibleActivators: true,
        }),
      }),
      env,
      ctx,
    );
    expect(announcement.status).toBe(200);
    const announcementBody = await announcement.json() as {
      event: { message: { id: string } };
      broadcast: { id: string; recipientCount: number };
    };
    expect(announcementBody.broadcast.recipientCount).toBe(1);
    await Promise.all(background);
    expect(send).toHaveBeenCalledOnce();
    expect(send).toHaveBeenCalledWith(expect.objectContaining({
      to: "activate-ri-2026@ripota.org",
      bcc: ["rob@example.com"],
    }));

    const remove = await handleActivateRiApi(
      adminRequest(
        `/api/activate-ri-2026/admin/ops/messages/${announcementBody.event.message.id}/remove`,
        {
          method: "POST",
          headers: jsonHeaders(),
          body: JSON.stringify({ reason: "Superseded by a newer wind update." }),
        },
      ),
      env,
    );
    expect(remove.status).toBe(200);
    const stored = await env.DB.prepare(
      `SELECT body, removal_reason FROM activate_ri_ops_messages WHERE id = ?`,
    ).bind(announcementBody.event.message.id).first<{
      body: string;
      removal_reason: string;
    }>();
    expect(stored).toEqual({
      body: "",
      removal_reason: "Superseded by a newer wind update.",
    });
    const audits = await env.DB.prepare(
      `SELECT details_json FROM activate_ri_activity_events
       WHERE action = 'ops-message-removed'`,
    ).all<{ details_json: string }>();
    expect(JSON.stringify(audits.results)).not.toContain("Coastal winds");

    const ban = await handleActivateRiApi(
      adminRequest(`/api/activate-ri-2026/admin/ops/members/${encodeURIComponent(activatorId)}`, {
        method: "PATCH",
        headers: jsonHeaders(),
        body: JSON.stringify({ status: "banned", reason: "Test moderation." }),
      }),
      env,
    );
    expect(ban.status).toBe(200);
    const room = await handleActivateRiApi(
      sessionRequest("/api/activate-ri-2026/ops/bootstrap", cookie),
      env,
    );
    expect(room.status).toBe(403);
    const plans = await handleActivateRiApi(
      sessionRequest("/api/activate-ri-2026/activator/plans", cookie),
      env,
    );
    expect(plans.status).toBe(200);
  });

  it("revokes sessions separately and replaces all old secure links", async () => {
    const database = createMigratedSqliteD1();
    closeDatabase = database.close;
    const env = testEnv(database.DB);
    const send = vi.fn(async () => ({ messageId: "security-email" }));
    const { cookie, activatorId, editToken } = await approvedActivator(env);
    env.EMAIL = { send } as unknown as SendEmail;
    env.ACTIVATE_RI_EMAIL_FROM = "activate-ri-2026@ripota.org";

    const revoke = await handleActivateRiApi(
      adminRequest(`/api/activate-ri-2026/admin/activators/${encodeURIComponent(activatorId)}/revoke-sessions`, {
        method: "POST",
        headers: jsonHeaders(),
        body: "{}",
      }),
      env,
    );
    expect(revoke.status).toBe(200);
    const expiredSession = await handleActivateRiApi(
      sessionRequest("/api/activate-ri-2026/activator/session", cookie),
      env,
    );
    expect(expiredSession.status).toBe(401);
    const legacyBeforeReplace = await handleActivateRiApi(
      new Request(`https://ripota.org/api/activate-ri-2026/edit/${editToken}/plans`),
      env,
    );
    expect(legacyBeforeReplace.status).toBe(200);

    const replace = await handleActivateRiApi(
      adminRequest(`/api/activate-ri-2026/admin/activators/${encodeURIComponent(activatorId)}/replace-secure-links`, {
        method: "POST",
        headers: jsonHeaders(),
        body: "{}",
      }),
      env,
    );
    expect(replace.status).toBe(200);
    await expect(replace.json()).resolves.toEqual({ ok: true, emailStatus: "sent" });
    const legacyAfterReplace = await handleActivateRiApi(
      new Request(`https://ripota.org/api/activate-ri-2026/edit/${editToken}/plans`),
      env,
    );
    expect(legacyAfterReplace.status).toBe(404);
    expect(send).toHaveBeenCalledWith(expect.objectContaining({
      subject: "Your Activate All RI 2026 private links were replaced",
      text: expect.stringContaining("/activate-ri-2026/access/#"),
    }));
  });
});

async function approvedActivator(env: Env): Promise<{
  cookie: string;
  activatorId: string;
  editToken: string;
}> {
  const submit = await handleActivateRiApi(jsonRequest(
    "/api/activate-ri-2026/plans",
    volunteerPayload(),
  ), env);
  const submitBody = await submit.json() as { editUrl: string };
  const token = new URL(submitBody.editUrl).hash.slice(1);

  const plans = await handleActivateRiApi(
    adminRequest("/api/activate-ri-2026/admin/plans"),
    env,
  );
  const plansBody = await plans.json() as { plans: Array<{ id: string }> };
  const activatorId = plansBody.plans[0].id;
  const approval = await handleActivateRiApi(
    adminRequest(`/api/activate-ri-2026/admin/plans/${encodeURIComponent(activatorId)}/approve`, {
      method: "POST",
    }),
    env,
  );
  expect(approval.status).toBe(200);

  const session = await handleActivateRiApi(
    jsonRequest("/api/activate-ri-2026/activator/session", { token }),
    env,
  );
  const cookie = session.headers.get("set-cookie")?.split(";", 1)[0] ?? "";
  expect(cookie).toContain("__Host-activate-ri-session=");
  return { cookie, activatorId, editToken: token };
}

function testEnv(DB: D1Database): Env {
  const env: Env = {
    ACTIVATE_RI_EVENT_ID: "activate-ri-2026",
    SITE_ORIGIN: "https://ripota.org",
    TURNSTILE_REQUIRED: "false",
    ALLOW_ADMIN_HEADER_AUTH: "true",
    ALLOW_LOCAL_ADMIN_AUTH: "true",
    ASSETS: { fetch: async () => new Response("unused") } as unknown as Fetcher,
    DB,
  };
  const sockets: WebSocket[] = [];
  const state = {
    acceptWebSocket(socket: WebSocket) {
      sockets.push(socket);
    },
    getWebSockets() {
      return sockets;
    },
  } as unknown as DurableObjectState;
  const room = new ActivateRiOpsRoom(state, env);
  env.ACTIVATE_RI_OPS_ROOM = {
    getByName: () => ({
      fetch: (input: RequestInfo | URL, init?: RequestInit) =>
        room.fetch(new Request(input, init)),
    }),
  } as unknown as DurableObjectNamespace;
  return env;
}

function volunteerPayload() {
  return {
    submitterCallsign: "N1RWJ",
    submitterName: "Rob Jackson",
    submitterEmail: "rob@example.com",
    stops: [{
      parkReference: "US-2868",
      plannedDate: "2026-09-11",
      timeBlock: "09:00-12:00",
      bands: ["40m"],
      modes: ["SSB"],
    }],
  };
}

function jsonHeaders(cookie?: string): HeadersInit {
  return {
    "content-type": "application/json",
    origin: "https://ripota.org",
    ...(cookie ? { cookie } : {}),
  };
}

function jsonRequest(path: string, body: unknown): Request {
  return new Request(`https://ripota.org${path}`, {
    method: "POST",
    headers: jsonHeaders(),
    body: JSON.stringify(body),
  });
}

function adminRequest(path: string, init: RequestInit = {}): Request {
  return new Request(`https://ripota.org${path}`, {
    ...init,
    headers: {
      "Cf-Access-Authenticated-User-Email": "organizer@example.com",
      ...init.headers,
    },
  });
}

function sessionRequest(path: string, cookie: string, init: RequestInit = {}): Request {
  return new Request(`https://ripota.org${path}`, {
    ...init,
    headers: { cookie, ...init.headers },
  });
}
