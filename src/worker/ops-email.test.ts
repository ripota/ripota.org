import { afterEach, describe, expect, it, vi } from "vitest";
import type { Env } from "./env";
import { createOpsEmailBroadcast, sendOpsEmailBroadcast } from "./ops-email";
import { createMigratedSqliteD1 } from "./test-utils/sqlite-d1";

let closeDatabase: (() => void) | undefined;

afterEach(() => {
  closeDatabase?.();
  closeDatabase = undefined;
});

describe("Ops announcement email broadcasts", () => {
  it("uses privacy-safe batches of 49 and retries failed recipients only", async () => {
    const database = createMigratedSqliteD1();
    closeDatabase = database.close;
    const send = vi.fn()
      .mockResolvedValueOnce({ messageId: "batch-1" })
      .mockRejectedValueOnce(new Error("Temporary provider failure"));
    const env: Env = {
      ACTIVATE_RI_EVENT_ID: "activate-ri-2026",
      SITE_ORIGIN: "https://ripota.org",
      ACTIVATE_RI_EMAIL_FROM: "activate-ri-2026@ripota.org",
      ACTIVATE_RI_EMAIL_FROM_NAME: "RI POTA",
      ASSETS: {} as Fetcher,
      DB: database.DB,
      EMAIL: { send } as unknown as SendEmail,
    };
    const now = "2026-09-11T13:00:00.000Z";
    const statements: D1PreparedStatement[] = [];
    for (let index = 0; index < 50; index += 1) {
      const id = `activator-${index}`;
      statements.push(
        env.DB.prepare(
          `INSERT INTO activate_ri_activators (
             id, event_id, email_normalized, name, phone, club, primary_callsign,
             created_at, updated_at, public_notes, organizer_notes, status
           ) VALUES (?, ?, ?, ?, '', '', ?, ?, ?, '', '', 'approved')`,
        ).bind(
          id,
          env.ACTIVATE_RI_EVENT_ID,
          `activator-${index}@example.com`,
          `Activator ${index}`,
          `N0A${String(index).padStart(2, "0")}`,
          now,
          now,
        ),
        env.DB.prepare(
          `INSERT INTO activate_ri_ops_memberships (
             event_id, activator_id, status, created_at, updated_at
           ) VALUES (?, ?, 'active', ?, ?)`,
        ).bind(env.ACTIVATE_RI_EVENT_ID, id, now, now),
      );
    }
    statements.push(env.DB.prepare(
      `INSERT INTO activate_ri_ops_messages (
         id, event_id, author_type, author_key, author_label, kind, body,
         client_nonce, created_at
       ) VALUES ('announcement-1', ?, 'admin', 'admin:test', 'Organizer',
         'announcement', 'Wind advisory.', 'nonce-1', ?)`,
    ).bind(env.ACTIVATE_RI_EVENT_ID, now));
    await env.DB.batch(statements);

    const broadcast = await createOpsEmailBroadcast(
      env,
      "announcement-1",
      "organizer@example.com",
      now,
    );
    expect(broadcast.recipientCount).toBe(50);
    await sendOpsEmailBroadcast(env, broadcast.id);

    expect(send).toHaveBeenCalledTimes(2);
    expect(send.mock.calls[0][0]).toMatchObject({
      to: "activate-ri-2026@ripota.org",
    });
    expect(send.mock.calls[0][0].bcc).toHaveLength(49);
    expect(send.mock.calls[1][0].bcc).toHaveLength(1);
    expect(send.mock.calls[0][0].to).not.toEqual(send.mock.calls[0][0].bcc);
    await expect(broadcastState(env, broadcast.id)).resolves.toMatchObject({
      status: "partial",
      sent_count: 49,
      failed_count: 1,
    });

    send.mockResolvedValueOnce({ messageId: "retry" });
    await sendOpsEmailBroadcast(env, broadcast.id, true);
    expect(send).toHaveBeenCalledTimes(3);
    expect(send.mock.calls[2][0].bcc).toHaveLength(1);
    await expect(broadcastState(env, broadcast.id)).resolves.toMatchObject({
      status: "sent",
      sent_count: 50,
      failed_count: 0,
    });
  });
});

function broadcastState(env: Env, id: string) {
  return env.DB.prepare(
    `SELECT status, sent_count, failed_count
     FROM activate_ri_ops_email_broadcasts WHERE id = ?`,
  ).bind(id).first<{
    status: string;
    sent_count: number;
    failed_count: number;
  }>();
}
