import { describe, expect, it } from "vitest";
import identityFieldsSource from "./ActivateRiIdentityFields.astro?raw";
import volunteerFormSource from "./VolunteerForm.astro?raw";

describe("VolunteerForm required field indicators", () => {
  it("uses compact asterisks and explains them once", () => {
    expect(volunteerFormSource).toContain(
      '<p class="form-help form-required-note"><span class="required-marker" aria-hidden="true">*</span> Required fields</p>',
    );
    expect(identityFieldsSource).toContain('aria-label="Required field"');
    expect(identityFieldsSource).not.toContain("<span class=\"required-marker\">Required</span>");
  });
});

describe("VolunteerForm existing activation hint", () => {
  it("checks callsign and email for an existing activation and offers an edit link", () => {
    expect(volunteerFormSource).toContain("data-existing-activation-notice");
    expect(volunteerFormSource).toContain("/api/activate-ri-2026/activation-lookup");
    expect(volunteerFormSource).toContain("/api/activate-ri-2026/resend-edit-link");
    expect(volunteerFormSource).toContain("We already have an activation plan for this callsign and email.");
    expect(volunteerFormSource).toContain("Email me my edit link");
    expect(volunteerFormSource).toContain("You can also keep going here; submitting this form will merge these parks into your existing plan.");
  });
});
