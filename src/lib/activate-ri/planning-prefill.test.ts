import { describe, expect, it } from "vitest";
import { planningPrefillPlanUrl, readPlanningPrefill } from "./planning-prefill";

describe("planning prefill", () => {
  it("normalizes known parks and carries an event day into the editor", () => {
    const prefill = readPlanningPrefill("?park=%20us-2868%20&date=2026-09-12");
    expect(prefill).toEqual({ parkReference: "US-2868", date: "2026-09-12" });
    expect(planningPrefillPlanUrl(prefill)).toBe("/activate-ri-2026/activator/plan/?park=US-2868&date=2026-09-12");
  });

  it.each(["2026-09-10", "2026-09-11", "2026-09-12", "2026-09-13"])("accepts the event date %s", (date) => {
    expect(readPlanningPrefill(`?park=US-2868&date=${date}`)?.date).toBe(date);
  });

  it.each(["", "2026-09-14", "2027-09-12", "all", "main", "soft-start", "2026-09-12T12:00:00Z"])("ignores an unsupported day %s without losing the park", (date) => {
    expect(readPlanningPrefill(`?park=US-2868&date=${date}`)).toEqual({ parkReference: "US-2868" });
  });

  it.each(["", "US-UNKNOWN", "https://example.com", "<script>"])("ignores an unknown park %s", (park) => {
    expect(readPlanningPrefill(`?park=${encodeURIComponent(park)}&date=2026-09-12`)).toBeNull();
  });

  it("keeps the ordinary editor destination when no park was selected", () => {
    expect(planningPrefillPlanUrl(null)).toBe("/activate-ri-2026/activator/plan/");
  });
});
