import references from "../../data/ri-references.json";
import type {
  CreateOpsMessageInput,
  OpsMessageContext,
  OpsMessageKind,
  OpsRoomMode,
} from "./ops-types";

const parkReferences = new Set(references.map((reference) => reference.reference));
const clientNoncePattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const messageKinds = new Set<OpsMessageKind>([
  "chat",
  "access-note",
  "running-late",
  "need-backup",
]);
const roomModes = new Set<OpsRoomMode>(["full", "announcements", "off"]);
const disallowedControls = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/u;

export type OpsValidationResult<T> =
  | { ok: true; value: T }
  | { ok: false; errors: string[] };

export function validateOpsMessage(
  input: unknown,
): OpsValidationResult<CreateOpsMessageInput> {
  if (!isRecord(input)) {
    return { ok: false, errors: ["Enter a valid message."] };
  }

  const errors: string[] = [];
  const clientNonce = typeof input.clientNonce === "string"
    ? input.clientNonce.trim()
    : "";
  const kind = typeof input.kind === "string" && messageKinds.has(input.kind as OpsMessageKind)
    ? input.kind as OpsMessageKind
    : null;
  const body = typeof input.body === "string"
    ? input.body.replace(/\r\n?/g, "\n").trim()
    : "";

  if (!clientNoncePattern.test(clientNonce)) {
    errors.push("Message nonce must be a UUID.");
  }
  if (!kind) {
    errors.push("Choose a valid participant message type.");
  }
  if (body.length === 0) {
    errors.push("Enter a message.");
  }
  if ([...body].length > 1_000) {
    errors.push("Message must be 1,000 characters or fewer.");
  }
  if (body.split("\n").length > 12) {
    errors.push("Message may contain at most 12 lines.");
  }
  if (disallowedControls.test(body)) {
    errors.push("Message contains unsupported control characters.");
  }

  const context = validateContext(input.context, errors);
  if ((kind === "running-late" || kind === "need-backup") && context?.type !== "stop") {
    errors.push("This update must be associated with one of your scheduled stops.");
  }
  if (context?.type === "park" && kind !== "chat" && kind !== "access-note") {
    errors.push("This message type cannot use general park context.");
  }

  return errors.length > 0 || !kind
    ? { ok: false, errors }
    : { ok: true, value: { clientNonce, kind, body, context } };
}

export function validateOpsRoomMode(input: unknown): OpsValidationResult<OpsRoomMode> {
  if (!isRecord(input) || typeof input.roomMode !== "string" ||
    !roomModes.has(input.roomMode as OpsRoomMode)) {
    return { ok: false, errors: ["Choose full, announcements, or off."] };
  }
  return { ok: true, value: input.roomMode as OpsRoomMode };
}

export function validateOpsAnnouncement(input: unknown): OpsValidationResult<{
  clientNonce: string;
  body: string;
  context: OpsMessageContext;
  pin: boolean;
  emailEligibleActivators: boolean;
}> {
  if (!isRecord(input)) {
    return { ok: false, errors: ["Enter a valid announcement."] };
  }
  const errors: string[] = [];
  const clientNonce = typeof input.clientNonce === "string" ? input.clientNonce.trim() : "";
  const body = typeof input.body === "string"
    ? input.body.replace(/\r\n?/g, "\n").trim()
    : "";
  if (!clientNoncePattern.test(clientNonce)) errors.push("Announcement nonce must be a UUID.");
  if (!body) errors.push("Enter an announcement.");
  if ([...body].length > 1_000) errors.push("Announcement must be 1,000 characters or fewer.");
  if (body.split("\n").length > 12) errors.push("Announcement may contain at most 12 lines.");
  if (disallowedControls.test(body)) errors.push("Announcement contains unsupported control characters.");
  const context = validateContext(input.context, errors);
  if (context?.type === "stop") {
    errors.push("Organizer announcements may use park context, not participant stop context.");
  }
  return errors.length > 0
    ? { ok: false, errors }
    : {
        ok: true,
        value: {
          clientNonce,
          body,
          context,
          pin: input.pin === true,
          emailEligibleActivators: input.emailEligibleActivators === true,
        },
      };
}

export function validateOpsMembershipPatch(input: unknown): OpsValidationResult<{
  status: "active" | "muted" | "banned";
  reason: string;
}> {
  if (!isRecord(input) || !["active", "muted", "banned"].includes(String(input.status))) {
    return { ok: false, errors: ["Choose active, muted, or banned."] };
  }
  const reason = typeof input.reason === "string" ? input.reason.trim() : "";
  if ((input.status === "muted" || input.status === "banned") && !reason) {
    return { ok: false, errors: ["Enter a moderation reason."] };
  }
  if ([...reason].length > 500 || disallowedControls.test(reason)) {
    return { ok: false, errors: ["Moderation reason must be plain text up to 500 characters."] };
  }
  return {
    ok: true,
    value: { status: input.status as "active" | "muted" | "banned", reason },
  };
}

export function validateModerationReason(input: unknown): OpsValidationResult<string> {
  if (!isRecord(input) || typeof input.reason !== "string") {
    return { ok: false, errors: ["Enter a moderation reason."] };
  }
  const reason = input.reason.trim();
  if (!reason || [...reason].length > 500 || disallowedControls.test(reason)) {
    return { ok: false, errors: ["Moderation reason must be plain text up to 500 characters."] };
  }
  return { ok: true, value: reason };
}

function validateContext(
  input: unknown,
  errors: string[],
): OpsMessageContext {
  if (input === null || input === undefined) {
    return null;
  }
  if (!isRecord(input)) {
    errors.push("Choose a valid message context.");
    return null;
  }
  if (input.type === "park" && typeof input.parkReference === "string") {
    const parkReference = input.parkReference.trim().toUpperCase();
    if (!parkReferences.has(parkReference)) {
      errors.push("Choose a Rhode Island POTA park.");
      return null;
    }
    return { type: "park", parkReference };
  }
  if (input.type === "stop" && typeof input.stopId === "string" && input.stopId.trim()) {
    return { type: "stop", stopId: input.stopId.trim() };
  }
  errors.push("Choose a valid message context.");
  return null;
}

function isRecord(input: unknown): input is Record<string, unknown> {
  return typeof input === "object" && input !== null && !Array.isArray(input);
}
