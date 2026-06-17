import references from "../../data/ri-references.json";
import { normalizePotaReference } from "../pota/references";
import { allowedTimeBlockMessage, timeBlockToRange } from "./time-blocks";
import type {
  ActivationStopInput,
  NormalizedRouteSubmission,
  ValidationResult,
} from "./types";

const referenceIds = new Set(references.map((reference) => reference.reference));
const eventDatePattern = /^2026-09-(10|11|12|13)$/;
const timePattern = /^([01]\d|2[0-3]):[0-5]\d$/;
const callsignPattern = /^(?:[KNW][0-9][A-Z]{1,3}|[KNW][A-Z][0-9][A-Z]{1,3}|A[A-L][0-9][A-Z]{1,3})$/;
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const activateRiBandOptions = [
  "160m",
  "80m",
  "60m",
  "40m",
  "30m",
  "20m",
  "17m",
  "15m",
  "12m",
  "10m",
  "6m",
  "2m",
  "70cm",
] as const;
export const activateRiModeOptions = ["SSB", "CW", "Digital"] as const;

const bandByNormalizedValue = new Map(
  activateRiBandOptions.map((band) => [band.toLowerCase(), band]),
);
const modeByNormalizedValue = new Map(
  activateRiModeOptions.map((mode) => [mode.toUpperCase(), mode]),
);

export function validateRouteSubmission(
  input: unknown,
): ValidationResult<NormalizedRouteSubmission> {
  if (!isPlainObject(input)) {
    return { ok: false, errors: ["Enter a valid route submission."] };
  }

  const errors: string[] = [];
  const submitterCallsign = readStringField(
    input.submitterCallsign,
    "Callsign",
    errors,
  )
    .trim()
    .toUpperCase();
  const submitterName = readStringField(
    input.submitterName,
    "Activator name",
    errors,
  ).trim();
  const submitterEmail = readStringField(
    input.submitterEmail,
    "Email",
    errors,
  )
    .trim()
    .toLowerCase();
  const submitterPhone = readStringField(
    input.submitterPhone,
    "Phone",
    errors,
  ).trim();
  const club = readStringField(input.club, "Club", errors).trim();
  const publicNotes = readStringField(
    input.publicNotes,
    "Public notes",
    errors,
  ).trim();
  const organizerNotes = readStringField(
    input.organizerNotes,
    "Organizer notes",
    errors,
  ).trim();
  const stops = Array.isArray(input.stops) ? input.stops : [];

  if (!callsignPattern.test(submitterCallsign)) {
    errors.push("Enter a valid activator callsign.");
  }

  if (submitterName.length === 0) {
    errors.push("Enter the activator name.");
  }

  if (!emailPattern.test(submitterEmail)) {
    errors.push("Enter a valid email address.");
  }

  if (stops.length === 0) {
    errors.push("Add at least one activation stop.");
  }

  const normalizedStops = stops.map((stop, index) =>
    normalizeStop(stop, index, errors),
  );

  if (errors.length > 0) {
    return { ok: false, errors };
  }

  return {
    ok: true,
    value: {
      submitterCallsign,
      submitterName,
      submitterEmail,
      submitterPhone,
      club,
      publicNotes,
      organizerNotes,
      stops: normalizedStops,
    },
  };
}

export function validatePlanSubmission(
  input: unknown,
): ValidationResult<NormalizedRouteSubmission> {
  const result = validateRouteSubmission(input);
  if (result.ok) {
    return result;
  }

  return {
    ok: false,
    errors: result.errors.map((error) =>
      error === "Enter a valid route submission."
        ? "Enter a valid plan submission."
        : error,
    ),
  };
}

function normalizeStop(
  stop: unknown,
  index: number,
  errors: string[],
): Required<ActivationStopInput> {
  const label = `Stop ${index + 1}`;
  if (!isPlainObject(stop)) {
    errors.push(`${label} must be a valid activation stop.`);

    return emptyStop();
  }

  const parkReference = normalizePotaReference(
    readStringField(stop.parkReference, `${label} park reference`, errors),
  );
  const plannedDate = readStringField(stop.plannedDate, `${label} date`, errors).trim();
  const timeBlock = readStringField(
    stop.timeBlock,
    `${label} time block`,
    errors,
  ).trim();
  const submittedStartTime = readStringField(
    stop.startTime,
    `${label} start time`,
    errors,
  ).trim();
  const submittedEndTime = readStringField(
    stop.endTime,
    `${label} end time`,
    errors,
  ).trim();
  const blockRange = timeBlock.length > 0 ? timeBlockToRange(timeBlock) : null;
  const startTime = blockRange?.startTime ?? submittedStartTime;
  const endTime = blockRange?.endTime ?? submittedEndTime;
  const bands = normalizeBandList(
    cleanList(stop.bands, `${label} bands`, errors),
    `${label} bands`,
    errors,
  );
  const modes = normalizeModeList(
    cleanList(stop.modes, `${label} modes`, errors),
    `${label} modes`,
    errors,
  );

  if (!referenceIds.has(parkReference)) {
    errors.push(`${label} must use a known Rhode Island POTA reference.`);
  }

  if (!eventDatePattern.test(plannedDate)) {
    errors.push(`${label} date must be September 10-13, 2026.`);
  }

  if (timeBlock.length > 0 && blockRange === null) {
    errors.push(allowedTimeBlockMessage(label));
  }

  if (!timePattern.test(startTime) && blockRange === null) {
    errors.push(`${label} start time must use HH:MM 24-hour format.`);
  }

  if (!timePattern.test(endTime) && blockRange === null) {
    errors.push(`${label} end time must use HH:MM 24-hour format.`);
  }

  if (
    timePattern.test(startTime) &&
    timePattern.test(endTime) &&
    endTime <= startTime &&
    blockRange === null
  ) {
    errors.push(`${label} end time must be after start time.`);
  }

  if (bands.length === 0) {
    errors.push(`${label} needs at least one planned band.`);
  }

  if (modes.length === 0) {
    errors.push(`${label} needs at least one planned mode.`);
  }

  return {
    parkReference,
    plannedDate,
    startTime,
    endTime,
    timeBlock,
    bands,
    modes,
    publicNotes: readStringField(
      stop.publicNotes,
      `${label} public notes`,
      errors,
    ).trim(),
    organizerNotes: readStringField(
      stop.organizerNotes,
      `${label} organizer notes`,
      errors,
    ).trim(),
  };
}

function readStringField(
  value: unknown,
  label: string,
  errors: string[],
): string {
  if (value === undefined || value === null) {
    return "";
  }

  if (typeof value === "string") {
    return value;
  }

  errors.push(`${label} must be text.`);
  return "";
}

function cleanList(value: unknown, label: string, errors: string[]): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const hasNonStringValue = value.some((item) => typeof item !== "string");
  if (hasNonStringValue) {
    errors.push(`${label} must be text values.`);
  }

  return value
    .filter((item) => typeof item === "string")
    .map((item) => item.trim())
    .filter(Boolean);
}

export function normalizeBandList(
  values: string[],
  label: string,
  errors: string[],
): string[] {
  return normalizeAllowedList(values, label, "bands", bandByNormalizedValue, errors);
}

export function normalizeModeList(
  values: string[],
  label: string,
  errors: string[],
): string[] {
  return normalizeAllowedList(values, label, "modes", modeByNormalizedValue, errors);
}

function normalizeAllowedList(
  values: string[],
  label: string,
  optionLabel: "bands" | "modes",
  allowedValues: Map<string, string>,
  errors: string[],
): string[] {
  const normalizedValues: string[] = [];
  const unsupportedValues: string[] = [];

  for (const value of values) {
    const normalizedValue = optionLabel === "bands" ? value.toLowerCase() : value.toUpperCase();
    const allowedValue = allowedValues.get(normalizedValue);

    if (allowedValue) {
      if (!normalizedValues.includes(allowedValue)) {
        normalizedValues.push(allowedValue);
      }
    } else {
      unsupportedValues.push(value);
    }
  }

  if (unsupportedValues.length > 0) {
    errors.push(
      `${label} must use supported ${optionLabel}: ${Array.from(allowedValues.values()).join(", ")}.`,
    );
  }

  return normalizedValues;
}

function emptyStop(): Required<ActivationStopInput> {
  return {
    parkReference: "",
    plannedDate: "",
    timeBlock: "",
    startTime: "",
    endTime: "",
    bands: [],
    modes: [],
    publicNotes: "",
    organizerNotes: "",
  };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype
  );
}
