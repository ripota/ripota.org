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

describe("VolunteerForm park prefill workflow", () => {
  it("scrolls URL park prefill to the first identity field", () => {
    expect(volunteerFormSource).toContain(
      "addParkReferenceToForm(reference.toUpperCase(), { silentInvalid: true, focusIdentity: true });",
    );
    expect(volunteerFormSource).toContain("focusVolunteerIdentityFields();");
  });

  it("does not scroll or focus into the date field after adding a park", () => {
    expect(volunteerFormSource).not.toContain(
      'targetStop.scrollIntoView({ behavior: "smooth", block: "center" });\n    (targetStop.querySelector("[data-planned-date]") as HTMLSelectElement | null)?.focus();',
    );
  });
});
