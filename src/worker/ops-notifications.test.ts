import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Env } from "./env";
import { createMigratedSqliteD1 } from "./test-utils/sqlite-d1";
import { createAdminOpsAnnouncement, createOpsMessage } from "./ops-db";
import { opsEmailPreferencesResponse } from "./ops-email-preferences";
import { deliverOpsMessageEmails } from "./ops-notifications";

let database: ReturnType<typeof createMigratedSqliteD1>;
let env: Env;
let send: ReturnType<typeof vi.fn>;

beforeEach(async () => {
  database = createMigratedSqliteD1();
  send = vi.fn().mockResolvedValue({ messageId: "delivered" });
  env = { DB: database.DB, ACTIVATE_RI_EVENT_ID: "activate-ri-2026", SITE_ORIGIN: "https://ripota.org",
    ASSETS: {} as Fetcher, EMAIL: { send } as unknown as SendEmail, ACTIVATE_RI_EMAIL_FROM: "event@ripota.org" };
  for (const id of ["author", "subscriber", "quiet", "off"]) {
    await env.DB.prepare(`INSERT INTO activate_ri_activators
      (id, event_id, email_normalized, name, phone, club, primary_callsign, created_at, updated_at, public_notes, organizer_notes, status)
      VALUES (?, ?, ?, ?, '', '', ?, '2026-09-01', '2026-09-01', '', '', 'approved')`)
      .bind(id, env.ACTIVATE_RI_EVENT_ID, `${id}@example.com`, id, id).run();
    await env.DB.prepare(`INSERT INTO activate_ri_ops_memberships
      (event_id, activator_id, status, accepted_rules_version, created_at, updated_at)
      VALUES (?, ?, 'active', 'activate-ri-ops-v1', '2026-09-01', '2026-09-01')`)
      .bind(env.ACTIVATE_RI_EVENT_ID, id).run();
  }
  await env.DB.prepare(`UPDATE activate_ri_ops_settings SET room_mode = 'full'`).run();
  await env.DB.prepare(`INSERT INTO auth_users (id, webauthn_user_id, created_at, updated_at)
    VALUES ('admin', 'admin-webauthn', '2026-09-01', '2026-09-01')`).run();
  await env.DB.prepare(`INSERT INTO auth_user_emails (user_id, email_normalized, verified_at, created_at, updated_at)
    VALUES ('admin', 'admin@example.com', '2026-09-01', '2026-09-01', '2026-09-01')`).run();
  await env.DB.prepare(`INSERT INTO auth_event_roles (user_id, event_id, role, created_at)
    VALUES ('admin', ?, 'admin', '2026-09-01')`).bind(env.ACTIVATE_RI_EVENT_ID).run();
  await preferences("author", true, true);
  await preferences("subscriber", true, true);
  await preferences("off", false, true);
  await preferences("admin", true, true, "admin");
});

afterEach(() => database.close());

async function preferences(id: string, emailEnabled: boolean, chatMessages: boolean, adminUserId?: string) {
  const response = await opsEmailPreferencesResponse(new Request("https://ripota.org/api/activate-ri-2026/ops/preferences", {
    method: "PATCH", headers: { origin: "https://ripota.org", "content-type": "application/json" },
    body: JSON.stringify({ emailEnabled, chatMessages }),
  }), env, { email: `${id}@example.com`, adminUserId });
  expect(response.status).toBe(200);
}

async function message(nonce = crypto.randomUUID()) {
  return createOpsMessage(env, { type: "activator", activatorId: "author", label: "N1RWJ - Rob" },
    { clientNonce: nonce, kind: "chat", body: "Can someone help cover Beavertail at noon?", context: null });
}

describe("Ops Room notification delivery", () => {
  it("emails opted-in activators and admins without emailing the author or default-off chat audience", async () => {
    const nonce = crypto.randomUUID();
    await message(nonce);
    await message(nonce);
    await Promise.all([deliverOpsMessageEmails(env), deliverOpsMessageEmails(env)]);
    expect(send).toHaveBeenCalledTimes(2);
    expect(send.mock.calls.map(([email]) => email.to).sort()).toEqual(["admin@example.com", "subscriber@example.com"]);
    expect(send.mock.calls[0][0].text).toContain("Can someone help cover Beavertail at noon?");
    expect(send.mock.calls[0][0].subject).toContain("N1RWJ - Rob");
    const adminEmail = send.mock.calls.find(([email]) => email.to === "admin@example.com")![0];
    expect(adminEmail.html).toContain("/activate-ri-2026/admin/?view=ops#ops-message-");
    await preferences("quiet", true, true);
    await message(nonce);
    await deliverOpsMessageEmails(env);
    expect(send).toHaveBeenCalledTimes(2);
  });

  it("sends explicit announcements by default and deduplicates people subscribed to chat", async () => {
    await createAdminOpsAnnouncement(env, "admin:organizer", "organizer@example.com", {
      clientNonce: crypto.randomUUID(), body: "The north entrance is closed.", context: null,
      pin: true, emailEligibleActivators: true,
    });
    await deliverOpsMessageEmails(env);
    expect(send.mock.calls.map(([email]) => email.to).sort())
      .toEqual(["admin@example.com", "author@example.com", "quiet@example.com", "subscriber@example.com"]);
    expect(send.mock.calls.find(([email]) => email.to === "quiet@example.com")![0].subject)
      .toBe("Activate All RI 2026 organizer announcement");
  });

  it("does not turn a room-only announcement into a broadcast", async () => {
    await createAdminOpsAnnouncement(env, "admin:organizer", "organizer@example.com", {
      clientNonce: crypto.randomUUID(), body: "Thanks for checking in.", context: null, pin: false,
    });
    await deliverOpsMessageEmails(env);
    expect(send.mock.calls.map(([email]) => email.to).sort())
      .toEqual(["admin@example.com", "author@example.com", "subscriber@example.com"]);
  });

  it("rechecks opt-outs and revoked administrator access before sending", async () => {
    await message();
    await preferences("subscriber", false, true);
    await env.DB.prepare(`UPDATE auth_event_roles SET revoked_at = '2026-09-06' WHERE user_id = 'admin'`).run();
    await deliverOpsMessageEmails(env);
    expect(send).not.toHaveBeenCalled();
    const rows = await env.DB.prepare(`SELECT status FROM activate_ri_ops_email_deliveries`).all<{ status: string }>();
    expect(rows.results.map((row) => row.status)).toEqual(["skipped", "skipped"]);
  });

  it("retries temporary failures and leaves successful deliveries alone", async () => {
    send.mockRejectedValueOnce(new Error("Provider unavailable"));
    await message();
    await deliverOpsMessageEmails(env);
    expect(send).toHaveBeenCalledTimes(2);
    await deliverOpsMessageEmails(env);
    expect(send).toHaveBeenCalledTimes(2);
    await env.DB.prepare(`UPDATE activate_ri_ops_email_deliveries SET next_attempt_at = '2026-01-01' WHERE status = 'failed'`).run();
    await deliverOpsMessageEmails(env);
    expect(send).toHaveBeenCalledTimes(3);
    const count = await env.DB.prepare(`SELECT COUNT(*) AS n FROM activate_ri_ops_email_deliveries WHERE status = 'sent'`).first<{ n: number }>();
    expect(count?.n).toBe(2);
  });

  it("suppresses removed messages and newly banned members", async () => {
    await message();
    await env.DB.prepare(`UPDATE activate_ri_ops_memberships SET status = 'banned' WHERE activator_id = 'subscriber'`).run();
    await env.DB.prepare(`UPDATE activate_ri_ops_messages SET removed_at = '2026-09-06'`).run();
    await deliverOpsMessageEmails(env);
    expect(send).not.toHaveBeenCalled();
  });
});
