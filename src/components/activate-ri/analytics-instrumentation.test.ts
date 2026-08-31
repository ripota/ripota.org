import { describe, expect, it } from "vitest";
import baseLayoutSource from "../../layouts/BaseLayout.astro?raw";
import referenceMapSource from "../ReferenceMap.astro?raw";
import hunterSource from "./HunterChecklist.astro?raw";
import coverageSource from "./ParkCoverageTable.astro?raw";
import scheduleSource from "./ScheduleTable.astro?raw";
import volunteerSource from "./VolunteerForm.astro?raw";

describe("Activate RI analytics instrumentation", () => {
  it("collects anonymous browser events only on public layouts", () => {
    expect(baseLayoutSource).toContain("!privatePage && <AnalyticsClient />");
    expect(hunterSource).toContain("Custom analytics is skipped when Global Privacy Control or Do Not Track is enabled.");
  });

  it("measures hunter outcomes without reading identifying values into events", () => {
    expect(hunterSource).toContain('"hunter_import_attempted"');
    expect(hunterSource).toContain('"hunter_import_succeeded"');
    expect(hunterSource).toContain('"hunter_import_failed"');
    expect(hunterSource).toContain('"hunter_checklist_resumed"');
    expect(hunterSource).toContain('"hunter_manual_override_used"');
    expect(hunterSource).toContain('"hunter_schedule_details_opened"');
    expect(hunterSource).not.toMatch(/trackAnalyticsEvent\([^)]*(file\.name|park\.reference)/s);
  });

  it("measures public discovery and volunteer workflow use at coarse granularity", () => {
    expect(scheduleSource).toContain('"schedule_filter_used"');
    expect(scheduleSource).toContain('"schedule_detail_opened"');
    expect(coverageSource).toContain('"coverage_filter_used"');
    expect(referenceMapSource).toContain('"map_action"');
    expect(volunteerSource).toContain('"volunteer_form_started"');
    expect(volunteerSource).toContain('"volunteer_validation_failed"');
    expect(volunteerSource).toContain('"volunteer_submit_attempted"');
  });
});
