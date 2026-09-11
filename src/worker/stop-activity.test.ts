import { afterEach, describe, expect, it, vi } from "vitest";
import type { PublicActivationStop } from "../lib/activate-ri/types";
import type { EditablePlanDto } from "./db";
import { sendActivatorPlanCancelledEmail, sendActivatorPlanUpdatedEmail } from "./email";
import type { Env } from "./env";
import { handleActivateRiApi } from "./routes/activate-ri";
import { enrichStopActivity } from "./stop-activity";
import { createMigratedSqliteD1 } from "./test-utils/sqlite-d1";

let closeDatabase: (() => void) | undefined;

afterEach(() => {
  closeDatabase?.();
  closeDatabase = undefined;
  vi.restoreAllMocks();
});

describe("Per-stop POTA activity", () => {
  it("matches the activator, park, and UTC day without completing other visits", async () => {
    const env = testEnv();
    await seedEvidence(env.DB, "US-2868", "20260912", "K1TEST", 10);
    await seedEvidence(env.DB, "US-2872", "20260912", "K1OTHER", 10);
    await seedEvidence(env.DB, "US-6989", "20260911", "K1TEST", 10);
    await seedEvidence(env.DB, "US-2870", "20260912", "K1TEST", 9);
    await seedObservation(env.DB, "US-2869", "2026-09-12", "K1TEST");
    await seedObservation(env.DB, "US-2868", "2026-09-12", "K1TEST");
    await seedObservation(env.DB, "US-2872", "2026-09-12", "K1OTHER");
    await seedObservation(env.DB, "US-6989", "2026-09-11", "K1TEST");
    const stops = [
      stop("confirmed", { activatorCallsign: " k1test " }),
      stop("other-activator", { parkReference: "US-2872" }),
      stop("yesterday", { parkReference: "US-6989" }),
      stop("attempt", { parkReference: "US-2870" }),
      stop("spotted", { parkReference: "US-2869", status: "delayed" }),
      stop("tomorrow", { plannedDate: "2026-09-13" }),
      stop("cancelled", { status: "cancelled" }),
    ];

    const result = await enrichStopActivity(env, stops);

    expect(result.map(({ id, status, activity }) => ({ id, status, activity }))).toEqual([
      { id: "confirmed", status: "scheduled", activity: "confirmed" },
      { id: "other-activator", status: "scheduled", activity: undefined },
      { id: "yesterday", status: "scheduled", activity: undefined },
      { id: "attempt", status: "scheduled", activity: undefined },
      { id: "spotted", status: "delayed", activity: "spotted" },
      { id: "tomorrow", status: "scheduled", activity: undefined },
      { id: "cancelled", status: "cancelled", activity: undefined },
    ]);
    expect(stops.every((entry) => entry.activity === undefined)).toBe(true);
  });

  it("uses the UTC days overlapped by overnight Rhode Island stops", async () => {
    const env = testEnv();
    await seedEvidence(env.DB, "US-2868", "20260913", "K1TEST", 10);
    await seedEvidence(env.DB, "US-2872", "20260912", "K1TEST", 10);
    const result = await enrichStopActivity(env, [
      stop("after-midnight", { startTime: "01:00", endTime: "03:00" }),
      stop("cross-midnight", { startTime: "23:00", endTime: "01:00" }),
      stop("end-midnight", { startTime: "23:00", endTime: "00:00" }),
      stop("previous-utc-day", { parkReference: "US-2872", startTime: "01:00", endTime: "03:00" }),
    ]);

    expect(result.map(({ id, activity }) => ({ id, activity }))).toEqual([
      { id: "after-midnight", activity: "confirmed" },
      { id: "cross-midnight", activity: "confirmed" },
      { id: "end-midnight", activity: undefined },
      { id: "previous-utc-day", activity: undefined },
    ]);
  });

  it("serves matching activity on the public schedule while preserving stored stop status", async () => {
    const env = testEnv();
    await env.DB.prepare(
      `INSERT INTO activate_ri_activators (
        id, event_id, email_normalized, name, primary_callsign, status, created_at, updated_at
      ) VALUES ('test-activator', 'activate-ri-2026', 'test@example.com', 'Test', 'K1TEST',
        'approved', '2026-09-01T12:00:00Z', '2026-09-01T12:00:00Z')`,
    ).run();
    for (const [id, startAt, endAt] of [
      ["today", "2026-09-12T12:00:00Z", "2026-09-12T14:00:00Z"],
      ["tonight", "2026-09-13T01:00:00Z", "2026-09-13T03:00:00Z"],
      ["tomorrow", "2026-09-13T12:00:00Z", "2026-09-13T14:00:00Z"],
    ]) {
      await env.DB.prepare(
        `INSERT INTO activate_ri_stops (
          id, activator_id, event_id, park_reference, start_at, end_at,
          bands_json, modes_json, status, created_at, updated_at
        ) VALUES (?, 'test-activator', 'activate-ri-2026', 'US-2868', ?, ?, '[]', '[]',
          'scheduled', '2026-09-01T12:00:00Z', '2026-09-01T12:00:00Z')`,
      ).bind(id, startAt, endAt).run();
    }
    await seedEvidence(env.DB, "US-2868", "20260912", "K1TEST", 10);

    const response = await handleActivateRiApi(new Request(
      "https://ripota.org/api/activate-ri-2026/public/stops",
      { headers: { "cache-control": "no-cache" } },
    ), env);
    expect(response?.status).toBe(200);
    const payload = await response!.json() as { stops: PublicActivationStop[] };
    expect(payload.stops.map(({ id, status, activity }) => ({ id, status, activity }))).toEqual([
      { id: "today", status: "scheduled", activity: "confirmed" },
      { id: "tonight", status: "scheduled", activity: undefined },
      { id: "tomorrow", status: "scheduled", activity: undefined },
    ]);
    const stored = await env.DB.prepare("SELECT status FROM activate_ri_stops").all<{ status: string }>();
    expect(stored.results?.every(({ status }) => status === "scheduled")).toBe(true);
  });

  it("keeps the schedule usable if POTA activity cannot be read", async () => {
    const env = testEnv();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(env.DB, "prepare").mockImplementation(() => { throw new Error("Unavailable"); });
    const stops = [stop("scheduled")];

    await expect(enrichStopActivity(env, stops)).resolves.toEqual(stops);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('"event":"stop_activity_unavailable"'));
  });
});

describe("Activator itinerary email status", () => {
  it("labels completed and confirmed stops in text and HTML without marking a later visit done", async () => {
    const env = testEnv();
    await seedEvidence(env.DB, "US-2868", "20260912", "K1TEST", 10);
    await seedObservation(env.DB, "US-2869", "2026-09-12", "K1TEST");
    const plan = emailPlan([
      stop("tomorrow", { plannedDate: "2026-09-13" }),
      stop("manual", { parkReference: "US-2872", status: "completed" }),
      stop("confirmed"),
      stop("spotted", { parkReference: "US-2869", status: "delayed" }),
      stop("cancelled", { parkReference: "US-6989", status: "cancelled" }),
    ]);

    await sendActivatorPlanUpdatedEmail(env, plan, "https://ripota.org/activate-ri-2026/activator/plan/");

    const message = vi.mocked(env.EMAIL!.send).mock.calls[0][0];
    for (const body of [message.text, message.html]) {
      expect(body).toContain("Beavertail State Park (US-2868) · Status: Done · POTA confirmed");
      expect(body).toContain("Colt State Park (US-2872) · Status: Done");
      expect(body).toContain("(US-2869) · Status: Delayed · Spotted");
      expect(body).toContain("Sep 13, 2026 08:00-10:00 EDT: Beavertail State Park (US-2868) · Status: Scheduled");
      expect(body).not.toContain("US-6989");
      expect(body!.indexOf("Sep 12")).toBeLessThan(body!.indexOf("Sep 13"));
    }
    expect(plan.stops.find(({ id }) => id === "confirmed")?.status).toBe("scheduled");
  });

  it("keeps completed and cancelled stops distinct in cancellation receipts", async () => {
    const env = testEnv();
    await sendActivatorPlanCancelledEmail(env, emailPlan([
      stop("done", { status: "completed" }),
      stop("cancelled", { parkReference: "US-2872", status: "cancelled" }),
    ]), "https://ripota.org/activate-ri-2026/activator/plan/");

    const message = vi.mocked(env.EMAIL!.send).mock.calls[0][0];
    for (const body of [message.text, message.html]) {
      expect(body).toContain("Full itinerary:");
      expect(body).toContain("Beavertail State Park (US-2868) · Status: Done");
      expect(body).toContain("Colt State Park (US-2872) · Status: Cancelled");
    }
  });
});

function testEnv(): Env {
  const database = createMigratedSqliteD1();
  closeDatabase = database.close;
  return {
    DB: database.DB,
    ASSETS: {} as Fetcher,
    ACTIVATE_RI_EVENT_ID: "activate-ri-2026",
    ACTIVATE_RI_EMAIL_FROM: "organizers@ripota.org",
    EMAIL: { send: vi.fn(async () => ({ messageId: "test" })) } as unknown as SendEmail,
  };
}

function stop(id: string, overrides: Partial<PublicActivationStop> = {}): PublicActivationStop {
  return {
    id,
    parkReference: "US-2868",
    plannedDate: "2026-09-12",
    startTime: "12:00",
    endTime: "14:00",
    activatorCallsign: "K1TEST",
    bands: ["20m"],
    modes: ["SSB"],
    publicNotes: "",
    status: "scheduled",
    ...overrides,
  };
}

function emailPlan(stops: PublicActivationStop[]): EditablePlanDto {
  return {
    id: "activator-1",
    event_id: "activate-ri-2026",
    submitter_callsign: "K1TEST",
    submitter_name: "Test",
    submitter_email: "test@example.com",
    submitter_phone: "",
    club: "",
    public_notes: "",
    organizer_notes: "",
    status: "approved",
    created_at: "2026-09-01T12:00:00Z",
    updated_at: "2026-09-12T12:00:00Z",
    approved_at: "2026-09-01T12:00:00Z",
    approved_by: "organizer@example.com",
    stops: stops.map((entry) => ({
      id: entry.id,
      plan_id: "activator-1",
      activator_id: "activator-1",
      event_id: "activate-ri-2026",
      park_reference: entry.parkReference,
      planned_date: entry.plannedDate,
      start_time: entry.startTime,
      end_time: entry.endTime,
      bands: entry.bands,
      modes: entry.modes,
      public_notes: "",
      organizer_notes: "",
      status: entry.status,
      created_at: "2026-09-01T12:00:00Z",
      updated_at: "2026-09-12T12:00:00Z",
    })),
  };
}

async function seedEvidence(DB: D1Database, reference: string, date: string, callsign: string, total: number): Promise<void> {
  await DB.prepare(
    `INSERT INTO activate_ri_pota_activation_evidence (
      event_id, park_reference, location_desc, qso_date, activator_callsign,
      total_qsos, qsos_cw, qsos_data, qsos_phone, qualifying, source_version,
      first_seen_at, last_verified_at, created_at, updated_at
    ) VALUES ('activate-ri-2026', ?, 'US-RI', ?, ?, ?, 0, 0, ?, ?, 'test-v1',
      '2026-09-12T12:00:00Z', '2026-09-12T12:00:00Z', '2026-09-12T12:00:00Z', '2026-09-12T12:00:00Z')`,
  ).bind(reference, date, callsign, total, total, total >= 10 ? 1 : 0).run();
}

async function seedObservation(DB: D1Database, reference: string, date: string, callsign: string): Promise<void> {
  await DB.prepare(
    `INSERT INTO activate_ri_pota_spot_observations (
      event_id, park_reference, spot_date, activator_callsign, location_desc,
      first_observed_at, last_observed_at, created_at, updated_at
    ) VALUES ('activate-ri-2026', ?, ?, ?, 'US-RI',
      '2026-09-12T12:00:00Z', '2026-09-12T12:00:00Z', '2026-09-12T12:00:00Z', '2026-09-12T12:00:00Z')`,
  ).bind(reference, date, callsign).run();
}
