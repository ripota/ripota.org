import { describe, expect, it } from "vitest";
import identityFieldsSource from "./ActivateRiIdentityFields.astro?raw";
import frequencyNoteSource from "./ActivateRiFrequencyNote.astro?raw";
import organizerNotesSource from "./ActivateRiOrganizerNotesField.astro?raw";
import requiredNoteSource from "./ActivateRiRequiredNote.astro?raw";
import stopsSectionSource from "./ActivateRiStopsSection.astro?raw";
import volunteerFormSource from "./VolunteerForm.astro?raw";

describe("VolunteerForm required field indicators", () => {
  it("uses compact asterisks and explains them once", () => {
    expect(requiredNoteSource).toContain(
      '<p class="form-help form-required-note"><span class="required-marker" aria-hidden="true">*</span> Required fields</p>',
    );
    expect(volunteerFormSource).toContain("ActivateRiRequiredNote");
    expect(identityFieldsSource).toContain('aria-label="Required field"');
    expect(identityFieldsSource).not.toContain("<span class=\"required-marker\">Required</span>");
  });
});

describe("VolunteerForm shared controls", () => {
  it("uses shared stop, organizer notes, and frequency controls", () => {
    expect(volunteerFormSource).toContain("ActivateRiStopsSection");
    expect(volunteerFormSource).toContain("ActivateRiOrganizerNotesField");
    expect(volunteerFormSource).toContain("ActivateRiFrequencyNote");
    expect(stopsSectionSource).toContain("data-add-stop");
    expect(organizerNotesSource).toContain('name="organizerNotes"');
    expect(frequencyNoteSource).toContain("Frequencies are not collected here.");
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
