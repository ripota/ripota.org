import { afterEach, describe, expect, it } from "vitest";
import { validateRouteSubmission } from "../lib/activate-ri/validation";
import { activatorSessionCookieName, createActivatorSession } from "./activator-session";
import { approvePlan, insertPendingPlan, type EditablePlanDto } from "./db";
import type { Env } from "./env";
import { handleActivateRiApi } from "./routes/activate-ri";
import { createMigratedSqliteD1 } from "./test-utils/sqlite-d1";

let cleanup: (() => void) | undefined;
afterEach(() => cleanup?.());

describe("private plan activity", () => {
  it("enriches session and legacy plan reads without changing saved stop status", async () => {
    const database = createMigratedSqliteD1();
    cleanup = database.close;
    const env: Env = {
      DB: database.DB,
      ACTIVATE_RI_EVENT_ID: "activate-ri-2026",
      ASSETS: { fetch: async () => new Response("not used") } as unknown as Fetcher,
    };
    const submission = validateRouteSubmission({
      submitterCallsign: "N0TST",
      submitterName: "Synthetic private itinerary",
      submitterEmail: "private-plan@example.invalid",
      stops: ["2026-09-11", "2026-09-12"].map((plannedDate) => ({
        parkReference: "US-2868", plannedDate, timeBlock: "09:00-12:00",
        bands: ["40m"], modes: ["SSB"],
      })),
    });
    if (!submission.ok) throw new Error(submission.errors.join(" "));
    const created = await insertPendingPlan(env, submission.value);
    expect(await approvePlan(env, created.planId, "organizer@example.invalid")).toMatchObject({ ok: true });
    await env.DB.prepare(
      `INSERT INTO activate_ri_pota_spot_observations (
        event_id, park_reference, spot_date, activator_callsign, location_desc,
        first_observed_at, last_observed_at, created_at, updated_at
      ) VALUES (?, 'US-2868', '2026-09-11', 'N0TST', 'US-RI', ?, ?, ?, ?)`,
    ).bind(env.ACTIVATE_RI_EVENT_ID, ...Array(4).fill("2026-09-11T14:00:00Z")).run();
    const token = created.editToken!;
    const session = await createActivatorSession(env, token);
    expect(session).not.toBeNull();
    const before = await env.DB.prepare("SELECT * FROM activate_ri_stops ORDER BY id").all();

    for (const request of [
      new Request("https://ripota.org/api/activate-ri-2026/activator/plans", {
        headers: { cookie: `${activatorSessionCookieName}=${session!.sessionToken}` },
      }),
      new Request(`https://ripota.org/api/activate-ri-2026/edit/${encodeURIComponent(token)}/plans`),
    ]) {
      const response = await handleActivateRiApi(request, env);
      expect(response.status).toBe(200);
      const body = await response.json() as { plans: EditablePlanDto[] };
      expect(body.plans[0].stops[0]).toMatchObject({ status: "scheduled", activity: "spotted" });
      expect(body.plans[0].stops[1]).toMatchObject({ status: "scheduled" });
      expect(body.plans[0].stops[1].activity).toBeUndefined();
    }

    const after = await env.DB.prepare("SELECT * FROM activate_ri_stops ORDER BY id").all();
    expect(after.results).toEqual(before.results);
  });
});
