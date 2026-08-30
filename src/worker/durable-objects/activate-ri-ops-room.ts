import type { CreateOpsMessageInput, OpsActor, OpsEvent, OpsMembershipStatus } from "../../lib/activate-ri/ops-types";
import {
  createAdminOpsAnnouncement,
  createOpsMessage,
  moderateOpsMessage,
  removeOwnOpsMessage,
  setOwnOpsMessageResolved,
  updateOpsMembership,
  updateOpsRoomMode,
} from "../ops-db";
import type { Env } from "../env";
import { json } from "../http";

type ConnectionAttachment = {
  connectionId: string;
  actorType: "activator" | "admin";
  activatorId?: string;
  label: string;
  connectedAt: string;
};

export class ActivateRiOpsRoom implements DurableObject {
  constructor(
    private readonly state: DurableObjectState,
    private readonly env: Env,
  ) {}

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (request.method === "GET" && url.pathname === "/socket") {
      return this.acceptSocket(request);
    }
    if (request.method === "POST" && url.pathname === "/messages") {
      return this.createMessage(request);
    }
    const messageMutation = url.pathname.match(/^\/messages\/([^/]+)\/(remove|resolve|reopen)$/);
    if (request.method === "POST" && messageMutation) {
      return this.mutateMessage(request, messageMutation[1], messageMutation[2]);
    }
    if (request.method === "PATCH" && url.pathname === "/settings") {
      return this.updateRoomMode(request);
    }
    if (request.method === "POST" && url.pathname === "/announcements") {
      return this.createAnnouncement(request);
    }
    const moderation = url.pathname.match(/^\/moderation\/messages\/([^/]+)\/(remove|resolve|reopen)$/);
    if (request.method === "POST" && moderation) {
      return this.moderateMessage(request, moderation[1], moderation[2]);
    }
    const member = url.pathname.match(/^\/members\/([^/]+)$/);
    if (request.method === "PATCH" && member) {
      return this.updateMember(request, member[1]);
    }
    if (request.method === "GET" && url.pathname === "/stats") {
      return json({ ok: true, connectedClients: this.state.getWebSockets().length });
    }
    if (request.method === "POST" && url.pathname === "/disconnect") {
      const activatorId = request.headers.get("x-ops-activator-id");
      if (!activatorId) {
        return json({ ok: false, error: "Missing member" }, { status: 400 });
      }
      this.closeTagged(`member:${activatorId}`, 1008, "Room access changed");
      return json({ ok: true });
    }
    return json({ ok: false, error: "Not found" }, { status: 404 });
  }

  webSocketMessage(socket: WebSocket, _message: ArrayBuffer | string): void {
    socket.close(1008, "This socket receives server events only");
  }

  webSocketClose(_socket: WebSocket, _code: number, _reason: string, _wasClean: boolean): void {}

  webSocketError(socket: WebSocket): void {
    socket.close(1011, "WebSocket error");
  }

  private async acceptSocket(request: Request): Promise<Response> {
    const actor = actorFromHeaders(request.headers);
    if (!actor) {
      return json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    const attachment: ConnectionAttachment = {
      connectionId: crypto.randomUUID(),
      actorType: actor.type,
      ...(actor.type === "activator" ? { activatorId: actor.activatorId } : {}),
      label: actor.label,
      connectedAt: new Date().toISOString(),
    };
    server.serializeAttachment(attachment);
    const tags = actor.type === "activator"
      ? ["role:activator", `member:${actor.activatorId}`]
      : ["role:admin"];
    this.state.acceptWebSocket(server, tags);

    const cursor = await this.currentCursor();
    const membershipStatus = request.headers.get("x-ops-membership-status") as OpsMembershipStatus | null;
    server.send(JSON.stringify({
      type: "hello",
      highWatermark: cursor,
      roomMode: request.headers.get("x-ops-room-mode") ?? "off",
      membershipStatus: actor.type === "admin" ? "organizer" : membershipStatus,
    }));

    return new Response(null, { status: 101, webSocket: client });
  }

  private async createMessage(request: Request): Promise<Response> {
    const actor = actorFromHeaders(request.headers);
    if (!actor || actor.type !== "activator") {
      return json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }
    const input = await request.json<CreateOpsMessageInput>();
    const event = await createOpsMessage(this.env, actor, input);
    if (!event) {
      return json({ ok: false, error: "Message could not be posted" }, { status: 403 });
    }
    this.broadcast(event);
    return json({ ok: true, event });
  }

  private async updateRoomMode(request: Request): Promise<Response> {
    if (request.headers.get("x-ops-actor-type") !== "admin") {
      return json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }
    const actorEmail = request.headers.get("x-ops-admin-email");
    if (!actorEmail) {
      return json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }
    const payload = await request.json<{ roomMode: "full" | "announcements" | "off" }>();
    const event = await updateOpsRoomMode(this.env, payload.roomMode, actorEmail);
    this.broadcast(event);
    if (payload.roomMode === "off") {
      this.closeTagged("role:activator", 1001, "Ops Room is off");
    }
    return json({ ok: true, event });
  }

  private async mutateMessage(
    request: Request,
    encodedMessageId: string,
    action: string,
  ): Promise<Response> {
    const actor = actorFromHeaders(request.headers);
    if (!actor || actor.type !== "activator") {
      return json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }
    const messageId = decodePathSegment(encodedMessageId);
    const event = action === "remove"
      ? await removeOwnOpsMessage(this.env, actor.activatorId, messageId)
      : await setOwnOpsMessageResolved(
          this.env,
          actor.activatorId,
          messageId,
          action === "resolve",
        );
    if (!event) {
      return json({ ok: false, error: "Message not found" }, { status: 404 });
    }
    this.broadcast(event);
    return json({ ok: true, event });
  }

  private async createAnnouncement(request: Request): Promise<Response> {
    const actorEmail = adminEmail(request.headers);
    const actorKey = request.headers.get("x-ops-admin-key");
    if (!actorEmail || !actorKey) {
      return json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }
    const input = await request.json<{
      clientNonce: string;
      body: string;
      context: { type: "park"; parkReference: string } | null;
      pin: boolean;
    }>();
    const events = await createAdminOpsAnnouncement(this.env, actorKey, actorEmail, input);
    if (!events) {
      return json({ ok: false, error: "Announcement could not be posted" }, { status: 400 });
    }
    events.forEach((event) => this.broadcast(event));
    return json({ ok: true, event: events[0], events });
  }

  private async moderateMessage(
    request: Request,
    encodedMessageId: string,
    action: string,
  ): Promise<Response> {
    const actorEmail = adminEmail(request.headers);
    if (!actorEmail) return json({ ok: false, error: "Unauthorized" }, { status: 401 });
    const { reason = "" } = await request.json<{ reason?: string }>();
    const event = await moderateOpsMessage(
      this.env,
      decodePathSegment(encodedMessageId),
      action as "remove" | "resolve" | "reopen",
      actorEmail,
      reason,
    );
    if (!event) return json({ ok: false, error: "Message not found" }, { status: 404 });
    this.broadcast(event);
    return json({ ok: true, event });
  }

  private async updateMember(request: Request, encodedActivatorId: string): Promise<Response> {
    const actorEmail = adminEmail(request.headers);
    if (!actorEmail) return json({ ok: false, error: "Unauthorized" }, { status: 401 });
    const payload = await request.json<{
      status: OpsMembershipStatus;
      reason: string;
    }>();
    const activatorId = decodePathSegment(encodedActivatorId);
    const updated = await updateOpsMembership(
      this.env,
      activatorId,
      payload.status,
      payload.reason,
      actorEmail,
    );
    if (!updated) return json({ ok: false, error: "Member not found" }, { status: 404 });
    const control = JSON.stringify({ type: "membership-changed", status: payload.status });
    for (const socket of this.state.getWebSockets(`member:${activatorId}`)) {
      socket.send(control);
    }
    if (payload.status === "banned") {
      this.closeTagged(`member:${activatorId}`, 1008, "Ops Room access revoked");
    }
    return json({ ok: true, status: payload.status });
  }

  private broadcast(event: OpsEvent): void {
    const payload = JSON.stringify(event);
    for (const socket of this.state.getWebSockets()) {
      try {
        socket.send(payload);
      } catch {
        socket.close(1011, "Delivery failed");
      }
    }
  }

  private closeTagged(tag: string, code: number, reason: string): void {
    for (const socket of this.state.getWebSockets(tag)) {
      socket.close(code, reason);
    }
  }

  private async currentCursor(): Promise<number> {
    const row = await this.env.DB.prepare(
      `SELECT COALESCE(MAX(sequence), 0) AS cursor
       FROM activate_ri_ops_events WHERE event_id = ?`,
    ).bind(this.env.ACTIVATE_RI_EVENT_ID).first<{ cursor: number }>();
    return row?.cursor ?? 0;
  }
}

function actorFromHeaders(headers: Headers): OpsActor | null {
  const type = headers.get("x-ops-actor-type");
  const label = headers.get("x-ops-label");
  if (type === "activator" && label) {
    const activatorId = headers.get("x-ops-activator-id");
    return activatorId ? { type, activatorId, label } : null;
  }
  if (type === "admin" && label === "Organizer") {
    const key = headers.get("x-ops-admin-key") ?? "admin";
    return { type, key, label };
  }
  return null;
}

function adminEmail(headers: Headers): string | null {
  return headers.get("x-ops-actor-type") === "admin"
    ? headers.get("x-ops-admin-email")
    : null;
}

function decodePathSegment(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return "";
  }
}
