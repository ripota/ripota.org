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
        timezone: "UTC",
        goalParkCount: 61,
      }),
    );
  });

  it("gives activators and hunters separate planning actions", () => {
    expect(activateRi2026Event.phaseCtas.planning.primary.href).toBe(
      eventRoute("volunteer"),
    );
    expect(activateRi2026Event.phaseCtas.planning.secondary.href).toBe(
      eventRoute("hunter"),
    );
  });

  it("uses existing tools for live updates and post-event results", () => {
    expect(activateRi2026Event.phaseCtas["event-live"].primary.href).toBe("/on-air/");
    expect(activateRi2026Event.phaseCtas["event-live"].secondary.href).toBe(eventRoute("activatorPlan"));
    expect(activateRi2026Event.phaseCtas["post-event"].primary.href).toBe(eventRoute("progress"));
    expect(activateRi2026Event.phaseCtas["post-event"].secondary.href).toBe(eventRoute("help"));
  });

  it("centralizes event routes and generated JSON paths", () => {
    expect(eventRoute("parks")).toBe("/activate-ri-2026/parks/");
    expect(publicDataPath("parks")).toBe("/data/activate-ri-2026/parks.json");
    expect(publicDataPath("stops")).toBe("/data/activate-ri-2026/stops.json");
  });
});
