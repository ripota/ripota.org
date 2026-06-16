import { describe, expect, it } from "vitest";
import { activateRi2026Event } from "../../data/activate-ri-2026/event";
import { eventRoute, publicDataPath } from "./paths";

describe("Activate RI event config", () => {
  it("uses the approved 2026 event dates and planning phase", () => {
    expect(activateRi2026Event).toEqual(
      expect.objectContaining({
        id: "activate-ri-2026",
        name: "Activate All RI 2026",
        slug: "activate-ri-2026",
        phase: "planning",
        mainStartDate: "2026-09-11",
        mainEndDate: "2026-09-13",
        softStartDate: "2026-09-10",
        timezone: "America/New_York",
        goalParkCount: 61,
      }),
    );
  });

  it("keeps volunteer as the planning primary call to action", () => {
    expect(activateRi2026Event.phaseCtas.planning.primary.href).toBe(
      "/activate-ri-2026/volunteer/",
    );
    expect(activateRi2026Event.phaseCtas.planning.secondary.href).toBe(
      "/activate-ri-2026/schedule/",
    );
  });

  it("centralizes event routes and generated JSON paths", () => {
    expect(eventRoute("parks")).toBe("/activate-ri-2026/parks/");
    expect(publicDataPath("coverage")).toBe("/data/activate-ri-2026/coverage.json");
  });
});
