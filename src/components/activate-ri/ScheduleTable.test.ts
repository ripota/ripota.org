import { describe, expect, it } from "vitest";
import source from "./ScheduleTable.astro?raw";

describe("ScheduleTable markup", () => {
  it("uses a segmented radio control for timezone selection", () => {
    expect(source).toContain('class="event-filter event-filter--timezone"');
    expect(source).toContain('role="radiogroup"');
    expect(source).toContain('type="radio"');
    expect(source).toContain("data-timezone");
    expect(source).not.toContain('<select class="event-filter__control" data-timezone>');
  });

  it("shows schedule timezone choices in geographic order", () => {
    expect(source.indexOf('"utc"')).toBeLessThan(source.indexOf('"eastern"'));
    expect(source.indexOf('"eastern"')).toBeLessThan(source.indexOf('"central"'));
    expect(source.indexOf('"central"')).toBeLessThan(source.indexOf('"mountain"'));
    expect(source.indexOf('"mountain"')).toBeLessThan(source.indexOf('"pacific"'));
  });
});
