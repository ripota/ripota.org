import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { validateRouteSubmission } from "../lib/activate-ri/validation";
import { utcRangeToTimeBlockValue } from "../lib/activate-ri/time-blocks";
import {
  approvePlan,
  cancelPlanByActivatorId,
  getPlanByActivatorId,
  insertPendingPlan,
  listPublicStopRows,
  updatePlanByActivatorId,
  type EditablePlanDto,
  type EditablePlanSubmission,
} from "./db";
import type { Env } from "./env";
import { createMigratedSqliteD1 } from "./test-utils/sqlite-d1";

let database: ReturnType<typeof createMigratedSqliteD1>;
let env: Env;
let planId: string;

beforeEach(async () => {
  database = createMigratedSqliteD1();
  env = {
    DB: database.DB,
    ACTIVATE_RI_EVENT_ID: "activate-ri-2026",
    ASSETS: { fetch: async () => new Response("not used") } as unknown as Fetcher,
  };
  const submission = validateRouteSubmission({
    submitterCallsign: "N0TST",
    submitterName: "Synthetic Rehearsal",
    submitterEmail: "rehearsal@example.invalid",
    stops: ["US-2868", "US-2869"].map((parkReference) => ({
      parkReference,
      plannedDate: "2026-09-12",
      timeBlock: "09:00-12:00",
      bands: ["40m"],
      modes: ["SSB"],
    })),
  });
  if (!submission.ok) throw new Error(submission.errors.join(" "));
  const created = await insertPendingPlan(env, submission.value, undefined, { issueEditToken: false });
  planId = created.planId;
});

afterEach(() => database.close());

describe("plan edits preserve operational stop status", () => {
  it("keeps a removed stop cancelled through reloads and unrelated saves", async () => {
    await approve();
    const before = toSubmission(await loadPlan());
    const removedId = before.stops[1].id;
    expect(await save({ ...before, stops: before.stops.slice(0, 1) })).toMatchObject({ ok: true });
    const cancelled = await stopRecord(removedId);
    expect(cancelled).toMatchObject({ status: "cancelled", cancel_reason: "Removed by activator." });

    const afterReload = toSubmission(await loadPlan());
    afterReload.organizerNotes = "An unrelated contact note.";
    afterReload.stops[0].publicNotes = "Updated operating details.";
    expect(await save(afterReload)).toMatchObject({ ok: true });

    expect(await stopRecord(removedId)).toEqual(cancelled);
    expect((await loadPlan()).organizer_notes).toBe("An unrelated contact note.");
    expect((await loadPlan()).stops[0].public_notes).toBe("Updated operating details.");
    expect((await listPublicStopRows(env)).map((stop) => stop.status)).toEqual(["scheduled", "cancelled"]);
  });

  it.each(["pending", "approved"] as const)("keeps full cancellation after an old %s plan is saved", async (status) => {
    if (status === "approved") await approve();
    const staleSubmission = toSubmission(await loadPlan());
    expect(await cancelPlanByActivatorId(env, planId, planId, "Weather changed.")).toMatchObject({ ok: true });
    const cancelledRecords = await Promise.all(staleSubmission.stops.map((stop) => stopRecord(stop.id)));

    staleSubmission.organizerNotes = "Saved from a tab opened before cancellation.";
    expect(await save(staleSubmission)).toMatchObject({ ok: true });
    expect(await Promise.all(staleSubmission.stops.map((stop) => stopRecord(stop.id)))).toEqual(cancelledRecords);
    expect((await loadPlan()).stops.map((stop) => stop.status)).toEqual(["cancelled", "cancelled"]);
    expect((await loadPlan()).status).toBe(status === "approved" ? "approved" : "withdrawn");
  });

  it("keeps delayed status while saving changed operating details and preserves completed stops", async () => {
    await approve();
    const plan = await loadPlan();
    await env.DB.prepare("UPDATE activate_ri_stops SET status = 'delayed' WHERE id = ?")
      .bind(plan.stops[0].id).run();
    await env.DB.prepare("UPDATE activate_ri_stops SET status = 'completed' WHERE id = ?")
      .bind(plan.stops[1].id).run();
    const completed = await stopRecord(plan.stops[1].id);
    const changed = toSubmission(await loadPlan());
    changed.stops[0].plannedDate = "2026-09-13";
    changed.stops[0].publicNotes = "New arrival estimate.";
    changed.stops[1].parkReference = "US-2872";
    expect(await save(changed)).toMatchObject({ ok: true });
    const saved = await loadPlan();
    expect(saved.stops.find((stop) => stop.id === plan.stops[0].id)).toMatchObject({
      status: "delayed",
      planned_date: "2026-09-13",
      public_notes: "New arrival estimate.",
    });
    expect(await stopRecord(plan.stops[1].id)).toEqual(completed);

    // Older clients can omit a completed stop; an itinerary save must not cancel it.
    expect(await save({ ...changed, stops: changed.stops.slice(0, 1) })).toMatchObject({ ok: true });
    expect(await stopRecord(plan.stops[1].id)).toEqual(completed);
    expect(await cancelPlanByActivatorId(env, planId, planId, "Remaining stop cancelled.")).toMatchObject({ ok: true });
    expect(await stopRecord(plan.stops[1].id)).toEqual(completed);
  });

  it("allows an explicitly added stop without restoring existing cancellations", async () => {
    await approve();
    await cancelPlanByActivatorId(env, planId, planId, "Original route cancelled.");
    const submission = toSubmission(await loadPlan());
    submission.stops.push({ ...submission.stops[0], id: undefined, parkReference: "US-2872" });
    expect(await save(submission)).toMatchObject({ ok: true });
    expect((await loadPlan()).stops.map((stop) => [stop.park_reference, stop.status])).toEqual([
      ["US-2868", "cancelled"],
      ["US-2869", "cancelled"],
      ["US-2872", "scheduled"],
    ]);
  });
});

async function approve(): Promise<void> {
  expect(await approvePlan(env, planId, "organizer@example.invalid")).toMatchObject({ ok: true });
}

async function loadPlan(): Promise<EditablePlanDto> {
  const plan = await getPlanByActivatorId(env, planId, planId);
  if (!plan) throw new Error("Missing test plan");
  return plan;
}

function save(submission: EditablePlanSubmission) {
  return updatePlanByActivatorId(env, planId, planId, submission);
}

function stopRecord(id: string | undefined) {
  return env.DB.prepare("SELECT * FROM activate_ri_stops WHERE id = ?").bind(id ?? "").first();
}

function toSubmission(plan: EditablePlanDto): EditablePlanSubmission {
  return {
    submitterCallsign: plan.submitter_callsign,
    submitterName: plan.submitter_name,
    submitterEmail: plan.submitter_email,
    submitterPhone: plan.submitter_phone,
    club: plan.club,
    publicNotes: plan.public_notes,
    organizerNotes: plan.organizer_notes,
    stops: plan.stops.map((stop) => ({
      id: stop.id,
      parkReference: stop.park_reference,
      plannedDate: stop.planned_date,
      startTime: stop.start_time,
      endTime: stop.end_time,
      timeBlock: utcRangeToTimeBlockValue(stop.start_time, stop.end_time),
      bands: stop.bands,
      modes: stop.modes,
      publicNotes: stop.public_notes,
      organizerNotes: stop.organizer_notes,
    })),
  };
}
