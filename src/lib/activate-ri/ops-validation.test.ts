import { describe, expect, it } from "vitest";
import { validateOpsMessage, validateOpsRoomMode } from "./ops-validation";

describe("Ops Room validation", () => {
  it("normalizes plain text and accepts a valid owned-stop update shape", () => {
    expect(validateOpsMessage({
      clientNonce: "5c6a5518-0a13-46d0-9bca-d5897ea8c198",
      kind: "need-backup",
      body: "  Vehicle trouble.\r\nPlease cover this stop.  ",
      context: { type: "stop", stopId: "stop-1" },
    })).toEqual({
      ok: true,
      value: {
        clientNonce: "5c6a5518-0a13-46d0-9bca-d5897ea8c198",
        kind: "need-backup",
        body: "Vehicle trouble.\nPlease cover this stop.",
        context: { type: "stop", stopId: "stop-1" },
      },
    });
  });

  it("rejects forged kinds, invalid context, control characters, and oversized Unicode", () => {
    const result = validateOpsMessage({
      clientNonce: "not-a-uuid",
      kind: "announcement",
      body: `${"😀".repeat(1_001)}\u0000`,
      context: { type: "park", parkReference: "US-9999" },
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors).toEqual(expect.arrayContaining([
        "Message nonce must be a UUID.",
        "Choose a valid participant message type.",
        "Message must be 1,000 characters or fewer.",
        "Message contains unsupported control characters.",
        "Choose a Rhode Island POTA park.",
      ]));
    }
  });

  it("requires stop context for operational timing and rescue messages", () => {
    const result = validateOpsMessage({
      clientNonce: "5c6a5518-0a13-46d0-9bca-d5897ea8c198",
      kind: "running-late",
      body: "About 20 minutes late.",
      context: null,
    });
    expect(result).toMatchObject({ ok: false });
  });

  it("accepts only the three room modes", () => {
    expect(validateOpsRoomMode({ roomMode: "announcements" })).toEqual({
      ok: true,
      value: "announcements",
    });
    expect(validateOpsRoomMode({ roomMode: "public" })).toMatchObject({ ok: false });
  });
});
