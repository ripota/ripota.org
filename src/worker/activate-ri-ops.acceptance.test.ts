import { afterEach, describe, expect, it, vi } from "vitest";
import type { Env } from "./env";
import { ActivateRiOpsRoom } from "./durable-objects/activate-ri-ops-room";
import { handleActivateRiApi } from "./routes/activate-ri";
import { createAdminOpsMessage, moderateOpsMessage } from "./ops-db";
import { createMigratedSqliteD1 } from "./test-utils/sqlite-d1";
import type { CreateOpsMessageInput, OpsEvent, OpsMessageDto } from "../lib/activate-ri/ops-types";

let closeDatabase: (() => void) | undefined;

afterEach(() => {
  closeDatabase?.();
  closeDatabase = undefined;
  vi.useRealTimers();
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
    await expect(env.DB.prepare(
      `SELECT feature, subject_id, use_count FROM analytics_feature_usage
       WHERE scope = ? AND subject_type = 'activator'`,
    ).bind("activate-ri-2026").first()).resolves.toEqual({
      feature: "ops_room",
      subject_id: activatorId,
      use_count: 1,
    });

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
          authorLabel: "N1RWJ - Rob",
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

  it("fills participant history with 50 surviving messages while retaining moderation records and cursors", async () => {
    const database = createMigratedSqliteD1();
    closeDatabase = database.close;
    const env = testEnv(database.DB);
    const { cookie } = await approvedActivator(env);
    const mode = await handleActivateRiApi(adminRequest("/api/activate-ri-2026/admin/ops/settings", {
      method: "PATCH", headers: jsonHeaders(), body: JSON.stringify({ roomMode: "full" }),
    }), env);
    expect(mode.status).toBe(200);

    const survivingIds: string[] = [];
    const removedIds: string[] = [];
    let cursor = 0;
    // All of the newest 50 records are removed; 51 older messages remain available.
    for (let index = 0; index < 101; index += 1) {
      const createdAt = new Date(Date.UTC(2026, 8, 7, 12, index)).toISOString();
      const created = await createAdminOpsMessage(env, "admin:organizer@example.com", "Organizer", {
        clientNonce: crypto.randomUUID(), kind: "chat", body: `Room update ${index}`, context: null,
      }, createdAt);
      if (created?.type !== "message-created") throw new Error("Expected a seeded room message");
      cursor = created.sequence;
      if (index < 51) {
        survivingIds.push(created.message.id);
      } else {
        removedIds.push(created.message.id);
        const removed = await moderateOpsMessage(env, created.message.id, "remove", "organizer@example.com", "Superseded update", createdAt);
        if (removed?.type !== "message-removed") throw new Error("Expected a removal event");
        cursor = removed.sequence;
      }
    }

    const bootstrap = await handleActivateRiApi(sessionRequest("/api/activate-ri-2026/ops/bootstrap", cookie), env);
    const initial = await bootstrap.json() as { cursor: number; messages: Array<{ id: string; removed: boolean }> };
    expect(initial.messages.map((message) => message.id)).toEqual(survivingIds.slice(1));
    expect(initial.messages.every((message) => !message.removed)).toBe(true);
    expect(initial.cursor).toBe(cursor);

    const admin = await handleActivateRiApi(adminRequest("/api/activate-ri-2026/admin/ops"), env);
    const moderation = await admin.json() as typeof initial;
    expect(moderation.messages).toHaveLength(100);
    expect(moderation.messages.filter((message) => message.removed).map((message) => message.id).sort()).toEqual([...removedIds].sort());
    expect(moderation.cursor).toBe(cursor);
    const history = await handleActivateRiApi(sessionRequest(
      `/api/activate-ri-2026/ops/events?after=0&through=${cursor}&limit=250`, cookie,
    ), env);
    const events = await history.json() as { events: Array<{ sequence: number; type: string }>; nextCursor: number };
    expect(events.events.filter((event) => event.type === "message-removed")).toHaveLength(50);
    expect(events.nextCursor).toBe(cursor);

    const removedId = survivingIds.at(-1)!;
    const remove = await handleActivateRiApi(adminRequest(`/api/activate-ri-2026/admin/ops/messages/${removedId}/remove`, {
      method: "POST", headers: jsonHeaders(), body: JSON.stringify({ reason: "Another superseded update" }),
    }), env);
    expect(remove.status).toBe(200);
    const removal = await remove.json() as { event: { sequence: number; type: string; messageId: string } };
    expect(removal.event).toMatchObject({ type: "message-removed", messageId: removedId, sequence: cursor + 1 });
    const refreshed = await handleActivateRiApi(sessionRequest("/api/activate-ri-2026/ops/bootstrap", cookie), env);
    const afterRemoval = await refreshed.json() as typeof initial;
    expect(afterRemoval.messages.map((message) => message.id)).toEqual(survivingIds.slice(0, -1));
    expect(afterRemoval.cursor).toBe(removal.event.sequence);
    const catchup = await handleActivateRiApi(sessionRequest(
      `/api/activate-ri-2026/ops/events?after=${cursor}&through=${removal.event.sequence}`, cookie,
    ), env);
    await expect(catchup.json()).resolves.toMatchObject({
      events: [{ type: "message-removed", messageId: removedId, sequence: removal.event.sequence }],
      nextCursor: removal.event.sequence, hasMore: false,
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

  it("migrates existing chat profiles with the first-name default and saves independent display names", async () => {
    const database = createMigratedSqliteD1({ through: "0023_ops_notification_categories.sql" });
    closeDatabase = database.close;
    const env = testEnv(database.DB);
    const { cookie, activatorId } = await approvedActivator(env);
    database.applyMigrationFile("0024_ops_chat_display_name.sql");
    const path = "/api/activate-ri-2026/ops/profile";

    const initial = await handleActivateRiApi(sessionRequest(path, cookie), env);
    expect(initial.status).toBe(200);
    expect(initial.headers.get("cache-control")).toBe("private, no-store");
    await expect(initial.json()).resolves.toEqual({
      ok: true, callsign: "N1RWJ", displayName: "Rob", authorLabel: "N1RWJ - Rob",
    });
    env.ACTIVATE_RI_OPS_HARD_DISABLED = "true";
    for (const [input, displayName] of [["  Rob J.  ", "Rob J."], ["   ", ""], [null, "Rob"]] as const) {
      const changed = await handleActivateRiApi(sessionRequest(path, cookie, {
        method: "PATCH", headers: jsonHeaders(), body: JSON.stringify({ displayName: input }),
      }), env);
      const expected = {
        ok: true, callsign: "N1RWJ", displayName,
        authorLabel: displayName ? `N1RWJ - ${displayName}` : "N1RWJ",
      };
      expect(changed.status).toBe(200);
      await expect(changed.json()).resolves.toEqual(expected);
      const reloaded = await handleActivateRiApi(sessionRequest(path, cookie), env);
      await expect(reloaded.json()).resolves.toEqual(expected);
      await expect(env.DB.prepare(
        `SELECT chat_display_name FROM activate_ri_ops_memberships WHERE event_id = ? AND activator_id = ?`,
      ).bind(env.ACTIVATE_RI_EVENT_ID, activatorId).first()).resolves.toEqual({
        chat_display_name: input === null ? null : displayName,
      });
    }
    await expect(env.DB.prepare(
      `SELECT name FROM activate_ri_activators WHERE id = ?`,
    ).bind(activatorId).first()).resolves.toEqual({ name: "Rob Jackson" });
    await env.DB.prepare(`UPDATE activate_ri_activators SET name = 'n1rwj' WHERE id = ?`).bind(activatorId).run();
    const callsignDefault = await handleActivateRiApi(sessionRequest(path, cookie), env);
    await expect(callsignDefault.json()).resolves.toEqual({
      ok: true, callsign: "N1RWJ", displayName: "", authorLabel: "N1RWJ",
    });
  });

  it("validates chat profiles before changing their saved names", async () => {
    const database = createMigratedSqliteD1();
    closeDatabase = database.close;
    const env = testEnv(database.DB);
    const { cookie } = await approvedActivator(env);
    const path = "/api/activate-ri-2026/ops/profile";
    const invalidPayloads: unknown[] = [
      null, [], "Rob", {}, { displayName: 123 }, { displayName: false }, { displayName: {} },
      { displayName: "R".repeat(41) }, { displayName: "Rob\nJackson" }, { displayName: "Rob\rJackson" },
      { displayName: "\tRob" }, { displayName: "Rob\u0000" }, { displayName: "Rob\u007f" },
      { displayName: "Rob\u0085" }, { displayName: "Rob\u2028Jackson" }, { displayName: "Rob\u2029Jackson" },
    ];
    for (const payload of invalidPayloads) {
      const response = await handleActivateRiApi(sessionRequest(path, cookie, {
        method: "PATCH", headers: jsonHeaders(), body: JSON.stringify(payload),
      }), env);
      expect(response.status, JSON.stringify(payload)).toBe(400);
    }
    const malformed = await handleActivateRiApi(sessionRequest(path, cookie, {
      method: "PATCH", headers: jsonHeaders(), body: "{",
    }), env);
    expect(malformed.status).toBe(400);
    const wrongContentType = await handleActivateRiApi(sessionRequest(path, cookie, {
      method: "PATCH", headers: { origin: "https://ripota.org" }, body: JSON.stringify({ displayName: "Rob" }),
    }), env);
    expect(wrongContentType.status).toBe(415);
    const unchanged = await handleActivateRiApi(sessionRequest(path, cookie), env);
    await expect(unchanged.json()).resolves.toMatchObject({ displayName: "Rob" });
    const limit = await handleActivateRiApi(sessionRequest(path, cookie, {
      method: "PATCH", headers: jsonHeaders(), body: JSON.stringify({ displayName: ` ${"É".repeat(40)} ` }),
    }), env);
    expect(limit.status).toBe(200);
    await expect(limit.json()).resolves.toMatchObject({ displayName: "É".repeat(40) });
  });

  it("scopes chat profile access to the authenticated activator's event membership and trusted origin", async () => {
    const database = createMigratedSqliteD1();
    closeDatabase = database.close;
    const env = testEnv(database.DB);
    const { cookie, activatorId } = await approvedActivator(env);
    const other = await approvedActivator(env, {
      submitterCallsign: "K1ABC", submitterName: "María Rivera", submitterEmail: "maria@example.com",
    });
    const path = "/api/activate-ri-2026/ops/profile";
    await env.DB.prepare(
      `INSERT INTO activate_ri_ops_memberships (event_id, activator_id, status, created_at, updated_at, chat_display_name)
       VALUES ('another-event', ?, 'active', '2026-09-01', '2026-09-01', 'Other event')`,
    ).bind(activatorId).run();
    for (const method of ["GET", "PATCH"]) {
      const init = method === "PATCH"
        ? { method, headers: jsonHeaders(), body: JSON.stringify({ displayName: "Changed" }) }
        : {};
      const unauthenticated = await handleActivateRiApi(new Request(`https://ripota.org${path}`, init), env);
      expect(unauthenticated.status).toBe(401);
      const wrongEvent = await handleActivateRiApi(sessionRequest(path, cookie, init), {
        ...env, ACTIVATE_RI_EVENT_ID: "another-event" as Env["ACTIVATE_RI_EVENT_ID"],
      });
      expect(wrongEvent.status).toBe(401);
    }
    for (const origin of ["https://attacker.example", "https://ripota.org.attacker.example", null]) {
      const headers = new Headers(jsonHeaders());
      if (origin === null) headers.delete("origin");
      else headers.set("origin", origin);
      headers.set("cookie", cookie);
      const forbidden = await handleActivateRiApi(new Request(`https://ripota.org${path}`, {
        method: "PATCH", headers, body: JSON.stringify({ displayName: "Changed" }),
      }), env);
      expect(forbidden.status).toBe(403);
    }
    const saved = await handleActivateRiApi(sessionRequest(path, cookie, {
      method: "PATCH", headers: jsonHeaders(),
      body: JSON.stringify({ displayName: "Rob J.", activatorId: other.activatorId, eventId: "another-event", callsign: "K1FAKE" }),
    }), env);
    await expect(saved.json()).resolves.toEqual({
      ok: true, callsign: "N1RWJ", displayName: "Rob J.", authorLabel: "N1RWJ - Rob J.",
    });
    const otherProfile = await handleActivateRiApi(sessionRequest(path, other.cookie), env);
    await expect(otherProfile.json()).resolves.toMatchObject({ callsign: "K1ABC", displayName: "María" });
    await expect(env.DB.prepare(
      `SELECT chat_display_name FROM activate_ri_ops_memberships WHERE event_id = 'another-event' AND activator_id = ?`,
    ).bind(activatorId).first()).resolves.toEqual({ chat_display_name: "Other event" });
    const unsupported = await handleActivateRiApi(sessionRequest(path, cookie, { method: "DELETE" }), env);
    expect(unsupported.status).toBe(405);
    await env.DB.prepare(
      `DELETE FROM activate_ri_ops_memberships WHERE event_id = ? AND activator_id = ?`,
    ).bind(env.ACTIVATE_RI_EVENT_ID, activatorId).run();
    for (const method of ["GET", "PATCH"]) {
      const missingMembership = await handleActivateRiApi(sessionRequest(path, cookie, {
        method, headers: jsonHeaders(),
        ...(method === "PATCH" ? { body: JSON.stringify({ displayName: "Changed" }) } : {}),
      }), env);
      expect(missingMembership.status).toBe(403);
    }
  });

  it("attributes new messages to the complete saved chat name without rewriting earlier messages", async () => {
    const database = createMigratedSqliteD1();
    closeDatabase = database.close;
    const env = testEnv(database.DB);
    const { cookie } = await approvedActivator(env);
    const mode = await handleActivateRiApi(adminRequest("/api/activate-ri-2026/admin/ops/settings", {
      method: "PATCH", headers: jsonHeaders(), body: JSON.stringify({ roomMode: "full" }),
    }), env);
    expect(mode.status).toBe(200);
    const rules = await handleActivateRiApi(sessionRequest("/api/activate-ri-2026/ops/rules/accept", cookie, {
      method: "POST", headers: jsonHeaders(), body: "{}",
    }), env);
    expect(rules.status).toBe(200);
    const expectedLabels = ["N1RWJ - Rob", "N1RWJ - Rob J.", "N1RWJ"];
    for (const [index, displayName] of [null, "Rob J.", ""].entries()) {
      const saved = await handleActivateRiApi(sessionRequest("/api/activate-ri-2026/ops/profile", cookie, {
        method: "PATCH", headers: jsonHeaders(), body: JSON.stringify({ displayName }),
      }), env);
      expect(saved.status).toBe(200);
      const posted = await handleActivateRiApi(sessionRequest("/api/activate-ri-2026/ops/messages", cookie, {
        method: "POST", headers: jsonHeaders(), body: JSON.stringify({
          clientNonce: crypto.randomUUID(), kind: "chat", body: `Message ${index + 1}`, context: null,
          authorLabel: "K1FAKE - Spoofed",
        }),
      }), env);
      expect(posted.status).toBe(200);
      await expect(posted.json()).resolves.toMatchObject({ event: { message: { authorLabel: expectedLabels[index] } } });
    }
    const bootstrap = await handleActivateRiApi(sessionRequest("/api/activate-ri-2026/ops/bootstrap", cookie), env);
    await expect(bootstrap.json()).resolves.toMatchObject({ messages: expectedLabels.map((authorLabel, index) => ({
      body: `Message ${index + 1}`, authorLabel,
    })) });
  });

  it("lets authenticated organizers rehearse in the live room without participant records", async () => {
    const database = createMigratedSqliteD1();
    closeDatabase = database.close;
    const env = testEnv(database.DB);

    const closedPost = await handleActivateRiApi(
      adminRequest("/api/activate-ri-2026/admin/ops/messages", {
        method: "POST",
        headers: jsonHeaders(),
        body: JSON.stringify({
          clientNonce: "0af14d67-568f-4955-91be-2ecb367f4c6e",
          kind: "chat",
          body: "Sound check before opening.",
          context: null,
        }),
      }),
      env,
    );
    expect(closedPost.status).toBe(403);

    await handleActivateRiApi(
      adminRequest("/api/activate-ri-2026/admin/ops/settings", {
        method: "PATCH",
        headers: jsonHeaders(),
        body: JSON.stringify({ roomMode: "full" }),
      }),
      env,
    );
    const posted = await handleActivateRiApi(
      adminRequest("/api/activate-ri-2026/admin/ops/messages", {
        method: "POST",
        headers: jsonHeaders(),
        body: JSON.stringify({
          clientNonce: "76759270-b3a3-41ac-9582-c76e80e274d6",
          kind: "access-note",
          body: "Organizer test: east entrance is clear.",
          context: { type: "park", parkReference: "US-2868" },
        }),
      }),
      env,
    );
    expect(posted.status).toBe(200);
    const postedBody = await posted.json() as { event: { sequence: number } };

    const state = await handleActivateRiApi(
      adminRequest("/api/activate-ri-2026/admin/ops"),
      env,
    );
    await expect(state.json()).resolves.toMatchObject({
      members: [],
      messages: [{
        authorType: "admin",
        authorLabel: "Organizer (organizer)",
        kind: "access-note",
        parkReference: "US-2868",
      }],
    });

    const events = await handleActivateRiApi(
      adminRequest(`/api/activate-ri-2026/admin/ops/events?after=0&through=${postedBody.event.sequence}`),
      env,
    );
    await expect(events.json()).resolves.toMatchObject({
      ok: true,
      events: [
        { type: "room-mode-changed", mode: "full" },
        { type: "message-created", message: { body: "Organizer test: east entrance is clear." } },
      ],
    });
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
    const crossOriginSocket = await handleActivateRiApi(
      new Request("https://ripota.org/api/activate-ri-2026/ops/socket", {
        headers: {
          cookie,
          origin: "https://attacker.example",
          upgrade: "websocket",
        },
      }),
      env,
    );
    expect(crossOriginSocket.status).toBe(403);
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
    const preferencePath = "/api/activate-ri-2026/ops/preferences";
    const preference = await handleActivateRiApi(sessionRequest(preferencePath, cookie), env);
    await expect(preference.json()).resolves.toMatchObject({ emailEnabled: true, chatMessages: false });
    const optIn = await handleActivateRiApi(sessionRequest(preferencePath, cookie, {
      method: "PATCH", headers: jsonHeaders(), body: JSON.stringify({ emailEnabled: true, chatMessages: true }),
    }), env);
    expect(optIn.status).toBe(200);
    const forbidden = await handleActivateRiApi(sessionRequest(preferencePath, cookie, {
      method: "PATCH", headers: { ...jsonHeaders(), origin: "https://attacker.example" },
      body: JSON.stringify({ emailEnabled: false, chatMessages: true }),
    }), env);
    expect(forbidden.status).toBe(403);
    env.ACTIVATE_RI_OPS_HARD_DISABLED = "true";
    const optOut = await handleActivateRiApi(sessionRequest(preferencePath, cookie, {
      method: "PATCH", headers: jsonHeaders(), body: JSON.stringify({ emailEnabled: false, chatMessages: true }),
    }), env);
    await expect(optOut.json()).resolves.toMatchObject({ emailEnabled: false, chatMessages: true });
    env.ACTIVATE_RI_OPS_HARD_DISABLED = "false";
    await handleActivateRiApi(sessionRequest(preferencePath, cookie, {
      method: "PATCH", headers: jsonHeaders(), body: JSON.stringify({ emailEnabled: true, chatMessages: true }),
    }), env);
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
      to: "rob@example.com",
    }));

    const pinnedState = await handleActivateRiApi(
      adminRequest("/api/activate-ri-2026/admin/ops"),
      env,
    );
    await expect(pinnedState.json()).resolves.toMatchObject({
      pinnedMessage: {
        id: announcementBody.event.message.id,
        body: "Coastal winds are increasing after 6 PM.",
      },
    });
    const clearPin = await handleActivateRiApi(
      adminRequest("/api/activate-ri-2026/admin/ops/pin", {
        method: "DELETE",
        headers: jsonHeaders(),
      }),
      env,
    );
    expect(clearPin.status).toBe(200);
    await expect(clearPin.json()).resolves.toMatchObject({
      event: { type: "pin-changed", pinnedMessage: null },
    });

    const replacement = await handleActivateRiApi(
      adminRequest("/api/activate-ri-2026/admin/ops/announcements", {
        method: "POST",
        headers: jsonHeaders(),
        body: JSON.stringify({
          clientNonce: "66cd9f85-9729-4860-ae6c-69244b73883a",
          body: "Replacement organizer announcement.",
          context: null,
          pin: true,
          emailEligibleActivators: false,
        }),
      }),
      env,
    );
    const replacementBody = await replacement.json() as {
      event: { message: { id: string } };
    };

    const remove = await handleActivateRiApi(
      adminRequest(
        `/api/activate-ri-2026/admin/ops/messages/${replacementBody.event.message.id}/remove`,
        {
          method: "POST",
          headers: jsonHeaders(),
          body: JSON.stringify({ reason: "Superseded by a newer wind update." }),
        },
      ),
      env,
    );
    expect(remove.status).toBe(200);
    await expect(remove.clone().json()).resolves.toMatchObject({
      events: [
        { type: "message-removed" },
        { type: "pin-changed", pinnedMessage: null },
      ],
    });
    const stored = await env.DB.prepare(
      `SELECT body, removal_reason FROM activate_ri_ops_messages WHERE id = ?`,
    ).bind(replacementBody.event.message.id).first<{
      body: string;
      removal_reason: string;
    }>();
    expect(stored).toEqual({
      body: "",
      removal_reason: "Superseded by a newer wind update.",
    });
    const settings = await env.DB.prepare(
      `SELECT pinned_message_id FROM activate_ri_ops_settings WHERE event_id = ?`,
    ).bind(env.ACTIVATE_RI_EVENT_ID).first<{ pinned_message_id: string | null }>();
    expect(settings?.pinned_message_id).toBeNull();
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

  it("revokes sessions separately and can revoke all legacy access", async () => {
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
      adminRequest(`/api/activate-ri-2026/admin/activators/${encodeURIComponent(activatorId)}/revoke-legacy-access`, {
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
      subject: "Your Activate All RI 2026 access was reset",
      text: expect.stringContaining("/activate-ri-2026/activator/plan/"),
    }));
  });
});

describe("Activate RI Ops Room message editing", () => {
  it("persists a correction for refresh and catch-up without changing message metadata or sending another email", async () => {
    const { env, cookie } = await editableOpsRoom();
    const recipient = await approvedActivator(env, {
      submitterCallsign: "K1ABC", submitterName: "María Rivera", submitterEmail: "maria@example.com",
    });
    const subscribed = await handleActivateRiApi(sessionRequest("/api/activate-ri-2026/ops/preferences", recipient.cookie, {
      method: "PATCH", headers: jsonHeaders(), body: JSON.stringify({ emailEnabled: true, chatMessages: true }),
    }), env);
    expect(subscribed.status).toBe(200);
    const send = vi.fn(async () => ({ messageId: "chat-email" }));
    env.EMAIL = { send } as unknown as SendEmail;
    env.ACTIVATE_RI_EMAIL_FROM = "activate-ri-2026@ripota.org";
    const bootstrap = await handleActivateRiApi(sessionRequest("/api/activate-ri-2026/ops/bootstrap", cookie), env);
    const initial = await bootstrap.json() as { upcomingStops: Array<{ id: string }> };
    const created = await postEditableMessage(env, cookie, {
      kind: "need-backup", body: "Vehicle truble at the park.",
      context: { type: "stop", stopId: initial.upcomingStops[0].id },
    });
    expect(send).toHaveBeenCalledOnce();
    const resolved = await handleActivateRiApi(sessionRequest(
      `/api/activate-ri-2026/ops/messages/${created.message.id}/resolve`, cookie,
      { method: "POST", headers: jsonHeaders() },
    ), env);
    expect(resolved.status).toBe(200);
    const resolvedBody = await resolved.json() as { event: { sequence: number } };
    const before = await env.DB.prepare(`SELECT * FROM activate_ri_ops_messages WHERE id = ?`)
      .bind(created.message.id).first<Record<string, unknown>>();
    const deliveryBefore = await env.DB.prepare(`SELECT * FROM activate_ri_ops_email_deliveries WHERE message_id = ?`)
      .bind(created.message.id).all();
    const changedName = await handleActivateRiApi(sessionRequest("/api/activate-ri-2026/ops/profile", cookie, {
      method: "PATCH", headers: jsonHeaders(), body: JSON.stringify({ displayName: "Different name" }),
    }), env);
    expect(changedName.status).toBe(200);

    const editedAt = new Date(Date.parse(created.message.createdAt) + 5 * 60_000).toISOString();
    vi.setSystemTime(new Date(editedAt));
    const response = await editMessage(env, cookie, created.message.id, {
      body: "  Vehicle trouble at the park.\r\nHelp has arrived.  ",
      kind: "chat", context: null, authorActivatorId: recipient.activatorId,
      authorLabel: "Someone else", createdAt: editedAt, resolved: false,
    });
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    const correction = await response.json() as { event: OpsEvent };
    const body = "Vehicle trouble at the park.\nHelp has arrived.";
    expect(correction).toEqual({ ok: true, event: {
      sequence: resolvedBody.event.sequence + 1, type: "message-edited", messageId: created.message.id, body, editedAt,
    } });
    await expect(env.DB.prepare(`SELECT * FROM activate_ri_ops_messages WHERE id = ?`)
      .bind(created.message.id).first()).resolves.toEqual({ ...before, body, edited_at: editedAt });
    const deliveryAfter = await env.DB.prepare(`SELECT * FROM activate_ri_ops_email_deliveries WHERE message_id = ?`)
      .bind(created.message.id).all();
    expect(deliveryAfter.results).toEqual(deliveryBefore.results);
    expect(send).toHaveBeenCalledOnce();

    const refreshed = await handleActivateRiApi(sessionRequest("/api/activate-ri-2026/ops/bootstrap", recipient.cookie), env);
    await expect(refreshed.json()).resolves.toMatchObject({
      messages: [{ ...created.message, body, editedAt, resolved: true }], cursor: correction.event.sequence,
    });
    const catchup = await handleActivateRiApi(sessionRequest(
      `/api/activate-ri-2026/ops/events?after=${resolvedBody.event.sequence}&through=${correction.event.sequence}`, recipient.cookie,
    ), env);
    await expect(catchup.json()).resolves.toMatchObject({ events: [correction.event], nextCursor: correction.event.sequence });
  });

  it("allows edits until exactly 20 minutes from creation without restarting the clock after a correction", async () => {
    const { env, cookie } = await editableOpsRoom();
    const created = await postEditableMessage(env, cookie);
    const createdAt = Date.parse(created.message.createdAt);
    for (const [elapsed, body] of [[0, "First correction"], [10 * 60_000, "Second correction"], [20 * 60_000 - 1, "Last correction"]] as const) {
      vi.setSystemTime(new Date(createdAt + elapsed));
      const response = await editMessage(env, cookie, created.message.id, { body });
      expect(response.status, `Edit at ${elapsed} ms`).toBe(200);
    }
    for (const elapsed of [20 * 60_000, 20 * 60_000 + 1, 25 * 60_000]) {
      vi.setSystemTime(new Date(createdAt + elapsed));
      const response = await editMessage(env, cookie, created.message.id, { body: "Too late" });
      expect(response.status, `Edit at ${elapsed} ms`).toBe(409);
    }
    await expect(env.DB.prepare(`SELECT body, created_at, edited_at FROM activate_ri_ops_messages WHERE id = ?`)
      .bind(created.message.id).first()).resolves.toEqual({
      body: "Last correction", created_at: created.message.createdAt,
      edited_at: new Date(createdAt + 20 * 60_000 - 1).toISOString(),
    });
    await expect(env.DB.prepare(`SELECT COUNT(*) AS count FROM activate_ri_ops_events WHERE event_type = 'message-edited'`)
      .first()).resolves.toEqual({ count: 3 });
  });

  it("validates replacement text and preserves the saved message for invalid requests", async () => {
    const { env, cookie } = await editableOpsRoom();
    const created = await postEditableMessage(env, cookie);
    const invalid: unknown[] = [
      null, [], "Text", {}, { body: null }, { body: 123 }, { body: false }, { body: {} },
      { body: "  \r\n\t" }, { body: "x".repeat(1_001) }, { body: "📻".repeat(1_001) },
      { body: Array.from({ length: 13 }, () => "Line").join("\n") }, { body: "Bad\u0000text" },
      { body: "Bad\u000btext" }, { body: "Bad\u007ftext" },
    ];
    for (const payload of invalid) {
      const response = await editMessage(env, cookie, created.message.id, payload);
      expect(response.status, JSON.stringify(payload)).toBe(400);
    }
    const path = `/api/activate-ri-2026/ops/messages/${created.message.id}/edit`;
    const malformed = await handleActivateRiApi(sessionRequest(path, cookie, {
      method: "POST", headers: jsonHeaders(), body: "{",
    }), env);
    expect(malformed.status).toBe(400);
    const wrongContentType = await handleActivateRiApi(sessionRequest(path, cookie, {
      method: "POST", headers: { origin: "https://ripota.org" }, body: JSON.stringify({ body: "Text" }),
    }), env);
    expect(wrongContentType.status).toBe(415);
    await expect(env.DB.prepare(`SELECT body, edited_at FROM activate_ri_ops_messages WHERE id = ?`)
      .bind(created.message.id).first()).resolves.toEqual({ body: created.message.body, edited_at: null });
    await expect(env.DB.prepare(`SELECT COUNT(*) AS count FROM activate_ri_ops_events WHERE event_type = 'message-edited'`)
      .first()).resolves.toEqual({ count: 0 });
    for (const body of ["📻".repeat(1_000), Array.from({ length: 12 }, () => "Line\ttext").join("\r\n")]) {
      const response = await editMessage(env, cookie, created.message.id, { body });
      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toMatchObject({ event: { body: body.replaceAll("\r\n", "\n") } });
    }
  });

  it("enforces authentication, ownership, current room access, trusted origin, and both rate limits", async () => {
    const { env, cookie, activatorId } = await editableOpsRoom();
    const created = await postEditableMessage(env, cookie);
    const other = await approvedActivator(env, {
      submitterCallsign: "K1ABC", submitterName: "María Rivera", submitterEmail: "maria@example.com",
    });
    const acceptOther = await handleActivateRiApi(sessionRequest("/api/activate-ri-2026/ops/rules/accept", other.cookie, {
      method: "POST", headers: jsonHeaders(), body: "{}",
    }), env);
    expect(acceptOther.status).toBe(200);
    const path = `/api/activate-ri-2026/ops/messages/${created.message.id}/edit`;
    expect((await handleActivateRiApi(jsonRequest(path, { body: "Unauthorized" }), env)).status).toBe(401);
    expect((await editMessage(env, other.cookie, created.message.id, { body: "Other author" })).status).toBe(404);
    expect((await editMessage(env, cookie, "missing-message", { body: "Missing" })).status).toBe(404);
    for (const origin of ["https://attacker.example", "https://ripota.org.attacker.example", null]) {
      const headers = new Headers(jsonHeaders(cookie));
      if (origin === null) headers.delete("origin");
      else headers.set("origin", origin);
      const response = await handleActivateRiApi(new Request(`https://ripota.org${path}`, {
        method: "POST", headers, body: JSON.stringify({ body: "Untrusted" }),
      }), env);
      expect(response.status).toBe(403);
    }
    for (const status of ["muted", "banned"]) {
      await env.DB.prepare(`UPDATE activate_ri_ops_memberships SET status = ? WHERE activator_id = ?`)
        .bind(status, activatorId).run();
      expect((await editMessage(env, cookie, created.message.id, { body: "Unavailable" })).status).toBe(403);
    }
    await env.DB.prepare(`UPDATE activate_ri_ops_memberships SET status = 'active', accepted_rules_version = NULL WHERE activator_id = ?`)
      .bind(activatorId).run();
    expect((await editMessage(env, cookie, created.message.id, { body: "Unaccepted rules" })).status).toBe(409);
    await env.DB.prepare(`UPDATE activate_ri_ops_memberships SET accepted_rules_version = 'activate-ri-ops-v1' WHERE activator_id = ?`)
      .bind(activatorId).run();
    for (const [mode, status] of [["announcements", 403], ["off", 503]] as const) {
      await env.DB.prepare(`UPDATE activate_ri_ops_settings SET room_mode = ? WHERE event_id = ?`)
        .bind(mode, env.ACTIVATE_RI_EVENT_ID).run();
      expect((await editMessage(env, cookie, created.message.id, { body: "Unavailable mode" })).status).toBe(status);
    }
    await env.DB.prepare(`UPDATE activate_ri_ops_settings SET room_mode = 'full' WHERE event_id = ?`)
      .bind(env.ACTIVATE_RI_EVENT_ID).run();
    env.ACTIVATE_RI_OPS_HARD_DISABLED = "true";
    expect((await editMessage(env, cookie, created.message.id, { body: "Disabled" })).status).toBe(503);
    env.ACTIVATE_RI_OPS_HARD_DISABLED = "false";
    const burst = vi.fn(async () => ({ success: false }));
    const sustained = vi.fn(async () => ({ success: true }));
    env.OPS_RATE_LIMIT_BURST = { limit: burst } as RateLimit;
    env.OPS_RATE_LIMIT_SUSTAINED = { limit: sustained } as RateLimit;
    expect((await editMessage(env, cookie, created.message.id, { body: "Rate limited" })).status).toBe(429);
    burst.mockResolvedValue({ success: true });
    sustained.mockResolvedValue({ success: false });
    expect((await editMessage(env, cookie, created.message.id, { body: "Still rate limited" })).status).toBe(429);
    expect(burst).toHaveBeenCalledWith({ key: `activator:${activatorId}` });
    expect(sustained).toHaveBeenCalledWith({ key: `activator:${activatorId}` });
    await expect(env.DB.prepare(`SELECT body, edited_at FROM activate_ri_ops_messages WHERE id = ?`)
      .bind(created.message.id).first()).resolves.toEqual({ body: created.message.body, edited_at: null });
    await expect(env.DB.prepare(`SELECT COUNT(*) AS count FROM activate_ri_ops_events WHERE event_type = 'message-edited'`)
      .first()).resolves.toEqual({ count: 0 });
  });

  it.each(["author", "organizer"] as const)("redacts edit history after %s removal and refuses further edits", async (removedBy) => {
    const { env, cookie } = await editableOpsRoom();
    const created = await postEditableMessage(env, cookie, { body: "Original private detail" });
    const edited = await editMessage(env, cookie, created.message.id, { body: "Corrected private detail" });
    expect(edited.status).toBe(200);
    const remove = removedBy === "author"
      ? sessionRequest(`/api/activate-ri-2026/ops/messages/${created.message.id}/remove`, cookie, {
          method: "POST", headers: jsonHeaders(),
        })
      : adminRequest(`/api/activate-ri-2026/admin/ops/messages/${created.message.id}/remove`, {
          method: "POST", headers: jsonHeaders(), body: JSON.stringify({ reason: "Remove private details" }),
        });
    const removed = await handleActivateRiApi(remove, env);
    expect(removed.status).toBe(200);
    const removal = await removed.json() as { event: { sequence: number } };
    expect((await editMessage(env, cookie, created.message.id, { body: "Restore content" })).status).toBe(409);
    const history = await handleActivateRiApi(sessionRequest(
      `/api/activate-ri-2026/ops/events?after=0&through=${removal.event.sequence}`, cookie,
    ), env);
    const replay = await history.json() as { events: OpsEvent[] };
    expect(replay.events).toEqual([
      expect.objectContaining({ type: "room-mode-changed" }),
      expect.objectContaining({ type: "message-created", message: expect.objectContaining({ body: "", removed: true }) }),
      expect.objectContaining({ type: "message-edited", messageId: created.message.id, body: "" }),
      expect.objectContaining({ type: "message-removed", messageId: created.message.id, removedBy }),
    ]);
    expect(JSON.stringify(replay)).not.toContain("private detail");
    const stored = await env.DB.prepare(`SELECT metadata_json FROM activate_ri_ops_events WHERE message_id = ?`)
      .bind(created.message.id).all();
    expect(JSON.stringify(stored.results)).not.toContain("private detail");
    const refreshed = await handleActivateRiApi(sessionRequest("/api/activate-ri-2026/ops/bootstrap", cookie), env);
    await expect(refreshed.json()).resolves.toMatchObject({ messages: [] });
  });
});

async function editableOpsRoom() {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-09-08T12:00:00.000Z"));
  const database = createMigratedSqliteD1();
  closeDatabase = database.close;
  const env = testEnv(database.DB);
  const identity = await approvedActivator(env);
  const mode = await handleActivateRiApi(adminRequest("/api/activate-ri-2026/admin/ops/settings", {
    method: "PATCH", headers: jsonHeaders(), body: JSON.stringify({ roomMode: "full" }),
  }), env);
  expect(mode.status).toBe(200);
  const accepted = await handleActivateRiApi(sessionRequest("/api/activate-ri-2026/ops/rules/accept", identity.cookie, {
    method: "POST", headers: jsonHeaders(), body: "{}",
  }), env);
  expect(accepted.status).toBe(200);
  return { env, ...identity };
}

async function postEditableMessage(env: Env, cookie: string, overrides: Partial<CreateOpsMessageInput> = {}) {
  const response = await handleActivateRiApi(sessionRequest("/api/activate-ri-2026/ops/messages", cookie, {
    method: "POST", headers: jsonHeaders(), body: JSON.stringify({
      clientNonce: crypto.randomUUID(), kind: "chat", body: "A message with a tpyo.", context: null, ...overrides,
    }),
  }), env);
  expect(response.status).toBe(200);
  return (await response.json() as { event: { sequence: number; type: "message-created"; message: OpsMessageDto } }).event;
}

function editMessage(env: Env, cookie: string, messageId: string, payload: unknown) {
  return handleActivateRiApi(sessionRequest(`/api/activate-ri-2026/ops/messages/${messageId}/edit`, cookie, {
    method: "POST", headers: jsonHeaders(), body: JSON.stringify(payload),
  }), env);
}

async function approvedActivator(env: Env, overrides: Partial<ReturnType<typeof volunteerPayload>> = {}): Promise<{
  cookie: string;
  activatorId: string;
  editToken: string;
}> {
  const payload = { ...volunteerPayload(), ...overrides };
  const submit = await handleActivateRiApi(jsonRequest(
    "/api/activate-ri-2026/plans",
    payload,
  ), env);
  const submitBody = await submit.json() as { editUrl: string };
  const token = new URL(submitBody.editUrl).hash.slice(1);

  const plans = await handleActivateRiApi(
    adminRequest("/api/activate-ri-2026/admin/plans"),
    env,
  );
  const plansBody = await plans.json() as { plans: Array<{ id: string; submitter_email: string }> };
  const activatorId = plansBody.plans.find((plan) => plan.submitter_email === payload.submitterEmail)!.id;
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
  expect(session.status, await session.clone().text()).toBe(200);
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
