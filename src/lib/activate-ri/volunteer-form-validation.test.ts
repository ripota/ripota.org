import { describe, expect, it } from "vitest";
import {
  formatVolunteerMissingFieldSummary,
  formatVolunteerProblemFieldSummary,
  volunteerRequiredFieldMessage,
} from "./volunteer-form-validation";

describe("volunteer form validation messages", () => {
  it("formats a readable summary of missing required fields", () => {
    expect(
      formatVolunteerMissingFieldSummary([
        "submitterCallsign",
        "submitterEmail",
        "stop.0.park",
        "stop.0.bands",
        "stop.1.modes",
      ]),
    ).toBe(
      "Please complete these required fields: Callsign, Email, Activation stop 1 park, Activation stop 1 bands, Activation stop 2 modes.",
    );
  });

  it("returns field-specific required messages", () => {
    expect(volunteerRequiredFieldMessage("submitterCallsign")).toBe("Enter your callsign.");
    expect(volunteerRequiredFieldMessage("stop.0.park")).toBe(
      "Choose a park from the suggestions.",
    );
    expect(volunteerRequiredFieldMessage("stop.2.timeBlock")).toBe(
      "Choose a time block for activation stop 3.",
    );
  });

  it("formats a readable summary of fields that need fixes", () => {
    expect(formatVolunteerProblemFieldSummary(["submitterEmail", "stop.0.park"])).toBe(
      "Please fix these fields: Email, Activation stop 1 park.",
    );
  });
});
