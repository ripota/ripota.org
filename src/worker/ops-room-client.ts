import type { CreateOpsMessageInput, OpsActor, OpsRoomMode } from "../lib/activate-ri/ops-types";
import type { Env } from "./env";

const roomName = "activate-ri-2026:ops-room";

export function opsRoomStub(env: Env): DurableObjectStub {
  if (!env.ACTIVATE_RI_OPS_ROOM) {
    throw new Error("ACTIVATE_RI_OPS_ROOM is not configured.");
  }
  return env.ACTIVATE_RI_OPS_ROOM.getByName(roomName, { locationHint: "enam" });
}

export async function postOpsMessageThroughRoom(
  env: Env,
  actor: Extract<OpsActor, { type: "activator" }>,
  input: CreateOpsMessageInput,
): Promise<Response> {
  return opsRoomStub(env).fetch("https://ops.internal/messages", {
    method: "POST",
    headers: actorHeaders(actor),
    body: JSON.stringify(input),
  });
}

export async function updateOpsModeThroughRoom(
  env: Env,
  roomMode: OpsRoomMode,
  actorEmail: string,
): Promise<Response> {
  return opsRoomStub(env).fetch("https://ops.internal/settings", {
    method: "PATCH",
    headers: {
      "content-type": "application/json",
      "x-ops-actor-type": "admin",
      "x-ops-admin-email": actorEmail,
      "x-ops-label": "Organizer",
    },
    body: JSON.stringify({ roomMode }),
  });
}

export async function mutateOpsMessageThroughRoom(
  env: Env,
  actor: Extract<OpsActor, { type: "activator" }>,
  messageId: string,
  action: "remove" | "resolve" | "reopen",
): Promise<Response> {
  return opsRoomStub(env).fetch(
    `https://ops.internal/messages/${encodeURIComponent(messageId)}/${action}`,
    { method: "POST", headers: actorHeaders(actor) },
  );
}

export async function getOpsRoomStats(env: Env): Promise<{ connectedClients: number }> {
  const response = await opsRoomStub(env).fetch("https://ops.internal/stats");
  if (!response.ok) {
    return { connectedClients: 0 };
  }
  const body = await response.json<{ connectedClients?: number }>();
  return { connectedClients: body.connectedClients ?? 0 };
}

export async function postOpsAnnouncementThroughRoom(
  env: Env,
  actorKey: string,
  actorEmail: string,
  input: unknown,
): Promise<Response> {
  return opsRoomStub(env).fetch("https://ops.internal/announcements", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-ops-actor-type": "admin",
      "x-ops-admin-key": actorKey,
      "x-ops-admin-email": actorEmail,
      "x-ops-label": "Organizer",
    },
    body: JSON.stringify(input),
  });
}

export async function moderateOpsMessageThroughRoom(
  env: Env,
  actorEmail: string,
  messageId: string,
  action: "remove" | "resolve" | "reopen",
  reason: string,
): Promise<Response> {
  return opsRoomStub(env).fetch(
    `https://ops.internal/moderation/messages/${encodeURIComponent(messageId)}/${action}`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-ops-actor-type": "admin",
        "x-ops-admin-email": actorEmail,
        "x-ops-label": "Organizer",
      },
      body: JSON.stringify({ reason }),
    },
  );
}

export async function updateOpsMemberThroughRoom(
  env: Env,
  actorEmail: string,
  activatorId: string,
  status: "active" | "muted" | "banned",
  reason: string,
): Promise<Response> {
  return opsRoomStub(env).fetch(
    `https://ops.internal/members/${encodeURIComponent(activatorId)}`,
    {
      method: "PATCH",
      headers: {
        "content-type": "application/json",
        "x-ops-actor-type": "admin",
        "x-ops-admin-email": actorEmail,
        "x-ops-label": "Organizer",
      },
      body: JSON.stringify({ status, reason }),
    },
  );
}

export async function disconnectOpsMember(
  env: Env,
  activatorId: string,
): Promise<Response> {
  return opsRoomStub(env).fetch("https://ops.internal/disconnect", {
    method: "POST",
    headers: { "x-ops-activator-id": activatorId },
  });
}

export function actorHeaders(actor: OpsActor): Headers {
  const headers = new Headers({
    "content-type": "application/json",
    "x-ops-actor-type": actor.type,
    "x-ops-label": actor.label,
  });
  if (actor.type === "activator") {
    headers.set("x-ops-activator-id", actor.activatorId);
  } else {
    headers.set("x-ops-admin-key", actor.key);
  }
  return headers;
}
