import { describe, expect, it } from "vitest";
import volunteerFormSource from "./VolunteerForm.astro?raw";

describe("VolunteerForm required field indicators", () => {
  it("uses compact asterisks and explains them once", () => {
    expect(volunteerFormSource).toContain(
      '<p class="form-help form-required-note"><span class="required-marker" aria-hidden="true">*</span> Required fields</p>',
    );
    expect(volunteerFormSource).toContain('aria-label="Required field"');
    expect(volunteerFormSource).not.toContain("<span class=\"required-marker\">Required</span>");
  });
});
