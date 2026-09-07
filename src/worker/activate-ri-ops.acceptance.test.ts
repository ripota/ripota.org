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
