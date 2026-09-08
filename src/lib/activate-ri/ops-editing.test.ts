import { describe, expect, it } from "vitest";
import { isOpsMessageWithinEditWindow, OPS_MESSAGE_EDIT_WINDOW_MS } from "./ops-editing";

describe("Ops Room message edit window", () => {
  const createdAt = "2026-09-08T12:00:00.000Z";
  const createdMs = Date.parse(createdAt);

  it("allows editing from creation until just before 20 minutes", () => {
    expect(isOpsMessageWithinEditWindow(createdAt, createdMs)).toBe(true);
    expect(isOpsMessageWithinEditWindow(createdAt, createdMs + OPS_MESSAGE_EDIT_WINDOW_MS - 1)).toBe(true);
    expect(isOpsMessageWithinEditWindow(createdAt, createdMs + OPS_MESSAGE_EDIT_WINDOW_MS)).toBe(false);
  });

  it("rejects future and invalid timestamps", () => {
    expect(isOpsMessageWithinEditWindow(createdAt, createdMs - 1)).toBe(false);
    expect(isOpsMessageWithinEditWindow("not a date", createdMs)).toBe(false);
    expect(isOpsMessageWithinEditWindow(createdAt, NaN)).toBe(false);
  });
});
