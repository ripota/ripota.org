import { describe, expect, it } from "vitest";
import volunteerFormSource from "./VolunteerForm.astro?raw";

describe("VolunteerForm required field indicators", () => {
  it("uses compact asterisks and explains them once", () => {
    expect(volunteerFormSource).toContain("* Required fields");
    expect(volunteerFormSource).toContain('aria-label="Required field"');
    expect(volunteerFormSource).not.toContain("<span class=\"required-marker\">Required</span>");
  });
});
