import { describe, expect, it } from "vitest";
import identityFieldsSource from "./ActivateRiIdentityFields.astro?raw";
import stopCardSource from "./ActivateRiStopCard.astro?raw";
import editFormSource from "./ActivatorEditForm.astro?raw";

describe("ActivatorEditForm shared volunteer controls", () => {
  it("uses the same required-field indicators as the volunteer form", () => {
    expect(editFormSource).toContain("form-required-note");
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
    expect(editFormSource).toContain('name="organizerNotes"');
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
});
