import { describe, expect, it } from "vitest";
import source from "./ParkCoverageTable.astro?raw";

describe("ParkCoverageTable markup", () => {
  it("uses a single volunteer button instead of repeating needs coverage across uncovered rows", () => {
    expect(source).toContain('<a class="button event-table-action" data-variant="primary" href={volunteerHref(park.reference)}>');
    expect(source).toContain('link.className = "button event-table-action"');
    expect(source).toContain('link.dataset.variant = "primary"');
    expect(source).toContain('!isParkVolunteerActionable(park.status) && (statusLabels[park.status] ?? park.status)');
    expect(source).toContain('if (!isParkVolunteerActionable(park.status))');
    expect(source).not.toContain('row.children.length === 2 ? "Needs coverage" : "TBD"');
    expect(source).not.toContain(') : (\n                "Needs coverage"\n              )');
  });
});
