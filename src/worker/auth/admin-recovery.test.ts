import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WebAuthnCredential } from "@simplewebauthn/server";
import type { Env } from "../env";
import { createMigratedSqliteD1 } from "../test-utils/sqlite-d1";
import {
  consumePasskeyReset,
  disableAccount,
  listAdminAccounts,
  requestPasskeyReset,
  revokeAccountSessions,
} from "./admin-recovery";
import {
  createUserWithVerifiedEmail,
  grantAdminRole,
  insertPasskey,
  linkActivatorMembership,
  replacePasskeysForRecovery,
} from "./db";
import { createAuthSession } from "./session";

let database: ReturnType<typeof createMigratedSqliteD1>;
let env: Env;
let actorId: string;
let subjectId: string;
let send: ReturnType<typeof vi.fn>;

beforeEach(async () => {
  database = createMigratedSqliteD1();
  send = vi.fn(async () => ({ messageId: "sent" }));
  env = {
    ACTIVATE_RI_EVENT_ID: "activate-ri-2026",
    SITE_ORIGIN: "https://ripota.org",
    ACTIVATE_RI_EMAIL_FROM: "activate-ri-2026@ripota.org",
    EMAIL: { send } as SendEmail,
    ASSETS: null as never,
    DB: database.DB,
  };
  const now = "2026-08-30T12:00:00.000Z";
  await env.DB.prepare(
    `INSERT INTO activate_ri_activators (
       id, event_id, email_normalized, name, phone, club, primary_callsign,
       created_at, updated_at, public_notes, organizer_notes, status
     ) VALUES
       ('claimed', 'activate-ri-2026', 'user@example.com', 'User', '', '', 'N1ABC', ?, ?, '', '', 'approved'),
       ('unclaimed', 'activate-ri-2026', 'other@example.com', 'Other', '', '', 'N2ABC', ?, ?, '', '', 'approved')`,
  ).bind(now, now, now, now).run();
  const actor = await createUserWithVerifiedEmail(env, "admin@example.com", "Admin", now);
  const subject = await createUserWithVerifiedEmail(env, "user@example.com", "User", now);
  actorId = actor.id;
  subjectId = subject.id;
  await grantAdminRole(env, actorId, null, now);
  await linkActivatorMembership(env, subjectId, "claimed", now);
  await insertPasskey(env, {
    userId: subjectId,
    credential: oldCredential,
    deviceType: "multiDevice",
    backedUp: true,
  }, now);
  await createAuthSession(env, { userId: subjectId, authenticationMethod: "passkey", passkeyVerified: true }, new Date(now));
});
afterEach(() => database.close());

describe("administrator account recovery", () => {
  it("lists only event-related accounts and reports unclaimed activators", async () => {
    const accounts = await listAdminAccounts(env);
    expect(accounts).toEqual(expect.arrayContaining([
      expect.objectContaining({ userId: actorId, admin: true, claimed: true }),
      expect.objectContaining({ userId: subjectId, callsign: "N1ABC", passkeyCount: 1 }),
      expect.objectContaining({ userId: null, callsign: "N2ABC", claimed: false }),
    ]));
  });

  it("leaves access intact until reset completion, then replaces credentials and sessions", async () => {
    expect(await requestPasskeyReset(request(), env, actorId, subjectId)).toBe("sent");
    expect(await activeCount("auth_passkey_credentials", "user_id", subjectId)).toBe(1);
    expect(await activeCount("auth_sessions", "user_id", subjectId)).toBe(1);
    const sent = send.mock.calls[0][0] as { text: string };
    const accessUrl = sent.text.split("\n").find((line) => line.includes("/account/access/?purpose=passkey-reset#"));
    const token = new URL(accessUrl!).hash.slice(1);
    const recovery = await consumePasskeyReset(env, token, new Date("2026-08-30T12:05:00.000Z"));
    expect(recovery).not.toBeNull();
    await expect(consumePasskeyReset(env, token)).resolves.toBeNull();

    await replacePasskeysForRecovery(env, {
      userId: subjectId,
      credential: replacementCredential,
      deviceType: "multiDevice",
      backedUp: true,
    }, "2026-08-30T12:06:00.000Z");
    const active = await env.DB.prepare(
      `SELECT credential_id FROM auth_passkey_credentials WHERE user_id = ? AND revoked_at IS NULL`,
    ).bind(subjectId).all<{ credential_id: string }>();
    expect(active.results).toEqual([{ credential_id: replacementCredential.id }]);
    expect(await activeCount("auth_sessions", "user_id", subjectId)).toBe(0);
  });

  it("revokes sessions without credentials and emergency-disables only with typed confirmation", async () => {
    expect(await revokeAccountSessions(env, actorId, subjectId)).toBe(true);
    expect(await activeCount("auth_sessions", "user_id", subjectId)).toBe(0);
    expect(await activeCount("auth_passkey_credentials", "user_id", subjectId)).toBe(1);
    expect(await disableAccount(env, actorId, subjectId, "wrong")).toBe("confirmation");
    expect(await disableAccount(env, actorId, subjectId, "N1ABC")).toBe("disabled");
    expect(await activeCount("auth_passkey_credentials", "user_id", subjectId)).toBe(0);
  });

  it("refuses to target an unrelated site-wide user", async () => {
    const unrelated = await createUserWithVerifiedEmail(env, "unrelated@example.com", "Unrelated");
    expect(await requestPasskeyReset(request(), env, actorId, unrelated.id)).toBe("not-found");
    expect(await disableAccount(env, actorId, unrelated.id, "unrelated@example.com")).toBe("not-found");
  });
});

const oldCredential: WebAuthnCredential = { id: "old", publicKey: new Uint8Array([1]), counter: 0 };
const replacementCredential: WebAuthnCredential = { id: "replacement", publicKey: new Uint8Array([2]), counter: 0 };

function request(): Request {
  return new Request("https://ripota.org/api/activate-ri-2026/admin/accounts/user/passkey-reset", {
    method: "POST",
    headers: { origin: "https://ripota.org" },
  });
}

async function activeCount(table: "auth_sessions" | "auth_passkey_credentials", field: "user_id", value: string): Promise<number> {
  const row = await env.DB.prepare(
    `SELECT COUNT(*) AS count FROM ${table} WHERE ${field} = ? AND revoked_at IS NULL`,
  ).bind(value).first<{ count: number }>();
  return row?.count ?? 0;
}
