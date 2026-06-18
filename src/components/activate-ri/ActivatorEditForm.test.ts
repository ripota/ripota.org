import { describe, expect, it } from "vitest";
import identityFieldsSource from "./ActivateRiIdentityFields.astro?raw";
import organizerNotesSource from "./ActivateRiOrganizerNotesField.astro?raw";
import requiredNoteSource from "./ActivateRiRequiredNote.astro?raw";
import stopCardSource from "./ActivateRiStopCard.astro?raw";
import stopsSectionSource from "./ActivateRiStopsSection.astro?raw";
import editFormSource from "./ActivatorEditForm.astro?raw";
import formClientSource from "../../lib/activate-ri/form-client?raw";

describe("ActivatorEditForm shared volunteer controls", () => {
  it("uses the same required-field indicators as the volunteer form", () => {
    expect(editFormSource).toContain("ActivateRiRequiredNote");
    expect(requiredNoteSource).toContain("form-required-note");
    expect(identityFieldsSource).toContain('aria-label="Required field"');
    expect(stopCardSource).toContain('aria-label="Required field"');
  });

  it("uses the volunteer park, band, mode, notes, and organizer controls", () => {
    expect(editFormSource).toContain("ActivateRiIdentityFields");
    expect(editFormSource).toContain("ActivateRiStopCard");
    expect(stopCardSource).toContain("data-park-combobox");
    expect(stopCardSource).toContain("data-bands");
    expect(stopCardSource).toContain("data-modes");
    expect(stopCardSource).toContain("data-public-notes");
    expect(editFormSource).toContain("ActivateRiOrganizerNotesField");
    expect(organizerNotesSource).toContain('name="organizerNotes"');
  });

  it("defaults new stop cards to the common HF SSB plan", () => {
    expect(stopCardSource).toContain('const defaultBands = ["40m", "20m", "15m"];');
    expect(stopCardSource).toContain('const defaultModes = ["SSB"];');
    expect(stopCardSource).toContain('checked={defaultBands.includes(band)}');
    expect(stopCardSource).toContain('checked={defaultModes.includes(mode)}');
    expect(formClientSource).toContain('setSelectedValues(stop.querySelector<HTMLElement>("[data-bands]"), ["40m", "20m", "15m"]);');
    expect(formClientSource).toContain('setSelectedValues(stop.querySelector<HTMLElement>("[data-modes]"), ["SSB"]);');
  });

  it("uses the shared stop section for add-park placement", () => {
    expect(editFormSource).toContain("ActivateRiStopsSection");
    expect(stopsSectionSource).toContain("data-add-stop-actions");
    expect(stopsSectionSource).toContain("Add another park");
    expect(editFormSource).not.toContain('<button class="button" data-variant="light" type="button" data-add-stop>');
  });

  it("shares client behavior for stop cards and picker controls", () => {
    expect(editFormSource).toContain("../../lib/activate-ri/form-client");
    expect(formClientSource).toContain("setupStopCards");
    expect(formClientSource).toContain("setParkPopupOpen");
    expect(formClientSource).toContain("setMultiSelectOpen");
  });

  it("reopens the park picker when typing into a focused dynamically added stop", () => {
    expect(formClientSource).toContain("if (document.activeElement === parkInput)");
    expect(formClientSource).toContain("setParkPopupOpen(parkCombobox, true)");
  });

  it("does not ask activators to choose between submitted plans", () => {
    expect(editFormSource).not.toContain("data-plan-picker");
    expect(editFormSource).not.toContain("data-plan-select");
    expect(editFormSource).not.toContain("Activation plan");
  });

  it("protects edit saves and cancellation with Turnstile", () => {
    expect(editFormSource).toContain("cf-turnstile");
    expect(editFormSource).toContain("turnstileToken");
    expect(editFormSource).toContain('data.get("cf-turnstile-response")');
  });

  it("derives edit start and end times from the shared time block control", () => {
    expect(editFormSource).toContain("timeBlockToRange");
    expect(editFormSource).toContain("startTime: timeRange.startTime");
    expect(editFormSource).toContain("endTime: timeRange.endTime");
  });

  it("does not scroll or focus into the date field after adding a park from the map", () => {
    expect(editFormSource).not.toContain(
      'targetStop.scrollIntoView({ behavior: "smooth", block: "center" });\n    (targetStop.querySelector("[data-planned-date]") as HTMLSelectElement | null)?.focus();',
    );
  });
});
