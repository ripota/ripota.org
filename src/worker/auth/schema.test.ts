import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createMigratedSqliteD1 } from "../test-utils/sqlite-d1";

let database: ReturnType<typeof createMigratedSqliteD1>;

beforeEach(() => {
  database = createMigratedSqliteD1();
});

afterEach(() => database.close());

describe("unified auth migration", () => {
  it("enforces identity ownership and round-trips credential public keys", async () => {
    const now = "2026-08-30T12:00:00.000Z";
    await database.DB.prepare(
      `INSERT INTO auth_users (id, webauthn_user_id, display_name, created_at, updated_at)
       VALUES ('u1', 'w1', 'One', ?, ?), ('u2', 'w2', 'Two', ?, ?)`,
    ).bind(now, now, now, now).run();
    await database.DB.prepare(
      `INSERT INTO auth_user_emails (
         user_id, email_normalized, is_primary, verified_at, created_at, updated_at
       ) VALUES ('u1', 'one@example.com', 1, ?, ?, ?)`,
    ).bind(now, now, now).run();
    await expect(database.DB.prepare(
      `INSERT INTO auth_user_emails (
         user_id, email_normalized, is_primary, verified_at, created_at, updated_at
       ) VALUES ('u2', 'one@example.com', 1, ?, ?, ?)`,
    ).bind(now, now, now).run()).rejects.toThrow();

    const publicKey = new Uint8Array([1, 2, 3, 255]);
    await database.DB.prepare(
      `INSERT INTO auth_passkey_credentials (
         id, credential_id, user_id, public_key, device_type, created_at
       ) VALUES ('p1', 'credential', 'u1', ?, 'multiDevice', ?)`,
    ).bind(publicKey, now).run();
    const stored = await database.DB.prepare(
      `SELECT public_key FROM auth_passkey_credentials WHERE id = 'p1'`,
    ).first<{ public_key: Uint8Array }>();
    expect([...stored!.public_key]).toEqual([...publicKey]);
  });

  it("allows only one active membership per event user and activator", async () => {
    const now = "2026-08-30T12:00:00.000Z";
    await database.DB.prepare(
      `INSERT INTO auth_users (id, webauthn_user_id, created_at, updated_at)
       VALUES ('u1', 'w1', ?, ?), ('u2', 'w2', ?, ?)`,
    ).bind(now, now, now, now).run();
    await database.DB.prepare(
      `INSERT INTO activate_ri_activators (
         id, event_id, email_normalized, name, phone, club, primary_callsign,
         created_at, updated_at, public_notes, organizer_notes, status
       ) VALUES
         ('a1', 'activate-ri-2026', 'a1@example.com', 'A1', '', '', 'N1A', ?, ?, '', '', 'approved'),
         ('a2', 'activate-ri-2026', 'a2@example.com', 'A2', '', '', 'N2A', ?, ?, '', '', 'approved')`,
    ).bind(now, now, now, now).run();
    await database.DB.prepare(
      `INSERT INTO auth_activator_memberships (id, user_id, event_id, activator_id, created_at)
       VALUES ('m1', 'u1', 'activate-ri-2026', 'a1', ?)`,
    ).bind(now).run();
    await expect(database.DB.prepare(
      `INSERT INTO auth_activator_memberships (id, user_id, event_id, activator_id, created_at)
       VALUES ('m2', 'u1', 'activate-ri-2026', 'a2', ?)`,
    ).bind(now).run()).rejects.toThrow();
    await expect(database.DB.prepare(
      `INSERT INTO auth_activator_memberships (id, user_id, event_id, activator_id, created_at)
       VALUES ('m3', 'u2', 'activate-ri-2026', 'a1', ?)`,
    ).bind(now).run()).rejects.toThrow();
  });

  it("rolls back every statement when a D1 batch fails", async () => {
    const now = "2026-08-30T12:00:00.000Z";
    await expect(database.DB.batch([
      database.DB.prepare(
        `INSERT INTO auth_users (id, webauthn_user_id, created_at, updated_at)
         VALUES ('rollback-user', 'rollback-webauthn', ?, ?)`,
      ).bind(now, now),
      database.DB.prepare(
        `INSERT INTO auth_user_emails (
           user_id, email_normalized, is_primary, verified_at, created_at, updated_at
         ) VALUES ('missing-user', 'rollback@example.com', 1, ?, ?, ?)`,
      ).bind(now, now, now),
    ])).rejects.toThrow();
    const row = await database.DB.prepare(
      `SELECT id FROM auth_users WHERE id = 'rollback-user'`,
    ).first<{ id: string }>();
    expect(row).toBeNull();
  });
});
