import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Env } from "../env";
import { tokenHash } from "../edit-token";
import { createMigratedSqliteD1 } from "../test-utils/sqlite-d1";
import { ActivateRiOpsRoom } from "./activate-ri-ops-room";

type FakeSocket = {
  tags: string[];
  send: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
};

let database: ReturnType<typeof createMigratedSqliteD1>;
let env: Env;
let sockets: FakeSocket[];
let room: ActivateRiOpsRoom;

beforeEach(async () => {
  database = createMigratedSqliteD1();
  env = {
    ACTIVATE_RI_EVENT_ID: "activate-ri-2026",
    SITE_ORIGIN: "https://ripota.org",
    ASSETS: {} as Fetcher,
    DB: database.DB,
  };
  sockets = [];
  const state = {
    acceptWebSocket(socket: WebSocket, tags: string[] = []) {
      sockets.push(Object.assign(socket, { tags }) as unknown as FakeSocket);
    },
    getWebSockets(tag?: string) {
      return sockets
        .filter((socket) => !tag || socket.tags.includes(tag))
        .map((socket) => socket as unknown as WebSocket);
    },
  } as unknown as DurableObjectState;
  room = new ActivateRiOpsRoom(state, env);

  await env.DB.prepare(
    `INSERT INTO activate_ri_activators (
       id, event_id, email_normalized, name, phone, club, primary_callsign,
       created_at, updated_at, public_notes, organizer_notes, status
     ) VALUES ('activator-1', 'activate-ri-2026', 'rob@example.com', 'Rob', '', '',
       'N1RWJ', ?, ?, '', '', 'approved')`,
  ).bind("2026-08-29T12:00:00.000Z", "2026-08-29T12:00:00.000Z").run();
  await env.DB.prepare(
    `INSERT INTO activate_ri_ops_memberships (
       event_id, activator_id, status, accepted_rules_version,
       accepted_rules_at, created_at, updated_at
     ) VALUES ('activate-ri-2026', 'activator-1', 'active',
       'activate-ri-ops-v1', ?, ?, ?)`,
  ).bind(
    "2026-08-29T12:00:00.000Z",
    "2026-08-29T12:00:00.000Z",
    "2026-08-29T12:00:00.000Z",
  ).run();
  await env.DB.prepare(
    `UPDATE activate_ri_ops_settings SET room_mode = 'full' WHERE event_id = ?`,
  ).bind(env.ACTIVATE_RI_EVENT_ID).run();
});

afterEach(() => database.close());

describe("ActivateRiOpsRoom", () => {
  it("broadcasts only after committing a canonical idempotent message event", async () => {
    const participant = fakeSocket(["role:activator", "member:activator-1"]);
    const organizer = fakeSocket(["role:admin"]);
    sockets.push(participant, organizer);
    const nonce = "5c6a5518-0a13-46d0-9bca-d5897ea8c198";
    const request = () => internalRequest("https://ops.internal/messages", {
      method: "POST",
      headers: activatorHeaders(),
      body: JSON.stringify({
        clientNonce: nonce,
        kind: "chat",
        body: "Checking in from the park.",
        context: null,
      }),
    });

    const first = await room.fetch(request());
    const second = await room.fetch(request());
    const firstBody = await first.json() as { event: unknown };
    const secondBody = await second.json() as { event: unknown };

    expect(firstBody.event).toEqual(secondBody.event);
    expect(participant.send).toHaveBeenCalledTimes(2);
    expect(organizer.send).toHaveBeenCalledTimes(2);
    expect(JSON.parse(participant.send.mock.calls[0][0])).toEqual(firstBody.event);
    const persisted = await env.DB.prepare(
      `SELECT m.body, e.sequence
       FROM activate_ri_ops_messages m
       INNER JOIN activate_ri_ops_events e ON e.message_id = m.id
       WHERE m.client_nonce = ?`,
    ).bind(nonce).first<{ body: string; sequence: number }>();
    expect(persisted).toMatchObject({ body: "Checking in from the park.", sequence: 1 });
  });

  it("broadcasts mode changes and closes participant sockets when turned off", async () => {
    const participant = fakeSocket(["role:activator", "member:activator-1"]);
    const organizer = fakeSocket(["role:admin"]);
    sockets.push(participant, organizer);

    const response = await room.fetch(internalRequest("https://ops.internal/settings", {
      method: "PATCH",
      headers: {
        "content-type": "application/json",
        "x-ops-actor-type": "admin",
        "x-ops-admin-email": "organizer@example.com",
        "x-ops-label": "Organizer",
      },
      body: JSON.stringify({ roomMode: "off" }),
    }));

    expect(response.status).toBe(200);
    expect(participant.send).toHaveBeenCalledOnce();
    expect(organizer.send).toHaveBeenCalledOnce();
    expect(participant.close).toHaveBeenCalledWith(1001, "Ops Room is off");
    expect(organizer.close).not.toHaveBeenCalled();
  });

  it("closes a socket that sends an unexpected client data frame", () => {
    const socket = fakeSocket([]);
    room.webSocketMessage(socket as unknown as WebSocket, "unexpected");
    expect(socket.close).toHaveBeenCalledWith(
      1008,
      "This socket receives server events only",
    );
  });

  it("targets a banned member without disconnecting other room clients", async () => {
    const target = fakeSocket(["role:activator", "member:activator-1"]);
    const other = fakeSocket(["role:activator", "member:activator-2"]);
    const organizer = fakeSocket(["role:admin"]);
    sockets.push(target, other, organizer);

    const response = await room.fetch(internalRequest(
      "https://ops.internal/members/activator-1",
      {
        method: "PATCH",
        headers: {
          "content-type": "application/json",
          "x-ops-actor-type": "admin",
          "x-ops-admin-email": "organizer@example.com",
          "x-ops-label": "Organizer",
        },
        body: JSON.stringify({ status: "banned", reason: "Test moderation." }),
      },
    ));

    expect(response.status).toBe(200);
    expect(target.send).toHaveBeenCalledWith(JSON.stringify({
      type: "membership-changed",
      status: "banned",
    }));
    expect(target.close).toHaveBeenCalledWith(1008, "Ops Room access revoked");
    expect(other.close).not.toHaveBeenCalled();
    expect(organizer.close).not.toHaveBeenCalled();
  });

  it("derives admin actor keys without exposing the email", async () => {
    expect(await tokenHash("organizer@example.com")).toMatch(/^[a-f0-9]{64}$/);
  });
});

function fakeSocket(tags: string[]): FakeSocket {
  return { tags, send: vi.fn(), close: vi.fn() };
}

function activatorHeaders(): HeadersInit {
  return {
    "content-type": "application/json",
    "x-ops-actor-type": "activator",
    "x-ops-activator-id": "activator-1",
    "x-ops-label": "N1RWJ",
  };
}

function internalRequest(url: string, init?: RequestInit): Request {
  return new Request(url, init);
}
