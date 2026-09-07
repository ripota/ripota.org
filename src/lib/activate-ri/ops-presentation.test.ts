import { describe, expect, it } from "vitest";
import type { OpsMessageDto } from "./ops-types";
import { continuesOpsMessageGroup, opsMessageTimeLabel } from "./ops-presentation";

function message(overrides: Partial<OpsMessageDto> = {}): OpsMessageDto {
  return {
    id: "message", kind: "chat", authorType: "activator", authorActivatorId: "activator-1",
    authorLabel: "N1RWJ - Rob", body: "Access looks clear.", createdAt: "2026-09-07T16:00:00Z",
    removed: false, resolved: false, ...overrides,
  };
}

describe("Ops Room consecutive message groups", () => {
  it("groups newest-first neighbors up to five minutes apart, including equal timestamps", () => {
    const current = message();
    expect(continuesOpsMessageGroup(current)).toBe(false);
    expect(continuesOpsMessageGroup(current, message())).toBe(true);
    expect(continuesOpsMessageGroup(current, message({ createdAt: "2026-09-07T16:04:59.999Z" }))).toBe(true);
    expect(continuesOpsMessageGroup(current, message({ createdAt: "2026-09-07T16:05:00Z" }))).toBe(true);
    expect(continuesOpsMessageGroup(current, message({ createdAt: "2026-09-07T16:05:00.001Z" }))).toBe(false);
    expect(continuesOpsMessageGroup(current, message({ createdAt: "2026-09-07T15:59:59.999Z" }))).toBe(false);
  });

  it("starts a new group when attribution or operational context changes", () => {
    const changes: Partial<OpsMessageDto>[] = [
      { authorActivatorId: "activator-2" }, { authorActivatorId: undefined }, { authorActivatorId: "" },
      { authorActivatorId: "   " }, { authorLabel: "N1RWJ - Rob J." }, { authorLabel: "" },
      { parkReference: "US-2868" }, { stopId: "stop-1" }, { removed: true },
      { kind: "access-note" }, { kind: "announcement" }, { kind: "system" },
      { authorType: "admin" }, { authorType: "system" },
    ];
    for (const change of changes) {
      expect(continuesOpsMessageGroup(message(change), message()), JSON.stringify(change)).toBe(false);
      expect(continuesOpsMessageGroup(message(), message(change)), JSON.stringify(change)).toBe(false);
    }
    const sameContext = { parkReference: "US-2868", stopId: "stop-1" };
    expect(continuesOpsMessageGroup(message(sameContext), message(sameContext))).toBe(true);
    expect(continuesOpsMessageGroup(message(sameContext), message({ ...sameContext, stopId: "stop-2" }))).toBe(false);
    expect(continuesOpsMessageGroup(message(sameContext), message({ ...sameContext, parkReference: "US-2869" }))).toBe(false);
    expect(continuesOpsMessageGroup(message({ authorActivatorId: undefined }), message({ authorActivatorId: undefined }))).toBe(false);
    expect(continuesOpsMessageGroup(message({ authorActivatorId: "  " }), message({ authorActivatorId: "  " }))).toBe(false);
    expect(continuesOpsMessageGroup(message({ authorType: "admin" }), message({ authorType: "admin" }))).toBe(false);
  });

  it("uses Eastern calendar days and elapsed time across daylight-saving transitions", () => {
    expect(continuesOpsMessageGroup(
      message({ createdAt: "2026-09-07T03:59:00Z" }),
      message({ createdAt: "2026-09-07T04:00:00Z" }),
    )).toBe(false);
    expect(continuesOpsMessageGroup(
      message({ createdAt: "2026-09-06T23:59:00Z" }),
      message({ createdAt: "2026-09-07T00:00:00Z" }),
    )).toBe(true);
    expect(continuesOpsMessageGroup(
      message({ createdAt: "2026-11-01T05:59:00Z" }),
      message({ createdAt: "2026-11-01T06:01:00Z" }),
    )).toBe(true);
    expect(continuesOpsMessageGroup(
      message({ createdAt: "2026-11-01T05:01:00Z" }),
      message({ createdAt: "2026-11-01T06:01:00Z" }),
    )).toBe(false);
    expect(continuesOpsMessageGroup(message({ createdAt: "invalid" }), message())).toBe(false);
    expect(continuesOpsMessageGroup(message(), message({ createdAt: "invalid" }))).toBe(false);
  });
});

describe("Ops Room compact message times", () => {
  it("shows only Eastern hours and minutes for today", () => {
    const now = new Date("2026-09-08T01:00:00Z");
    expect(opsMessageTimeLabel("2026-09-07T16:05:00Z", now)).toBe("12:05 PM");
    expect(opsMessageTimeLabel("2026-09-08T00:05:00Z", now)).toBe("8:05 PM");
    expect(opsMessageTimeLabel("2026-09-07T04:00:00Z", now)).toBe("12:00 AM");
  });

  it("adds the date for other Eastern days and the year only across Eastern years", () => {
    expect(opsMessageTimeLabel("2026-09-07T03:59:00Z", new Date("2026-09-07T04:00:00Z"))).toBe("Sep 6, 11:59 PM");
    expect(opsMessageTimeLabel("2026-12-30T17:05:00Z", new Date("2027-01-01T02:00:00Z"))).toBe("Dec 30, 12:05 PM");
    expect(opsMessageTimeLabel("2027-01-01T04:59:00Z", new Date("2027-01-01T05:00:00Z"))).toBe("Dec 31, 2026, 11:59 PM");
  });

  it("formats Eastern daylight-saving offsets and tolerates invalid message times", () => {
    const now = new Date("2026-11-01T17:00:00Z");
    expect(opsMessageTimeLabel("2026-11-01T05:30:00Z", now)).toBe("1:30 AM");
    expect(opsMessageTimeLabel("2026-11-01T06:30:00Z", now)).toBe("1:30 AM");
    expect(opsMessageTimeLabel("invalid", now)).toBe("Time unavailable");
  });
});
