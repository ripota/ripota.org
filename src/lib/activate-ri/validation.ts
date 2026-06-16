import references from "../../data/ri-references.json";
import { normalizePotaReference } from "../pota/references";
import type {
  ActivationStopInput,
  NormalizedRouteSubmission,
  RouteSubmissionInput,
  ValidationResult,
} from "./types";

const referenceIds = new Set(references.map((reference) => reference.reference));
const eventDatePattern = /^2026-09-(10|11|12|13)$/;
const timePattern = /^([01]\d|2[0-3]):[0-5]\d$/;
const callsignPattern = /^[A-Z0-9]{1,3}[0-9][A-Z0-9]{1,4}$/;
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function validateRouteSubmission(
  input: Partial<RouteSubmissionInput>,
): ValidationResult<NormalizedRouteSubmission> {
  const errors: string[] = [];
  const submitterCallsign = String(input.submitterCallsign ?? "")
    .trim()
    .toUpperCase();
  const submitterName = String(input.submitterName ?? "").trim();
  const submitterEmail = String(input.submitterEmail ?? "").trim().toLowerCase();
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
      submitterPhone: String(input.submitterPhone ?? "").trim(),
      club: String(input.club ?? "").trim(),
      publicNotes: String(input.publicNotes ?? "").trim(),
      organizerNotes: String(input.organizerNotes ?? "").trim(),
      stops: normalizedStops,
    },
  };
}

function normalizeStop(
  stop: Partial<ActivationStopInput>,
  index: number,
  errors: string[],
): Required<ActivationStopInput> {
  const label = `Stop ${index + 1}`;
  const parkReference = normalizePotaReference(String(stop.parkReference ?? ""));
  const plannedDate = String(stop.plannedDate ?? "").trim();
  const startTime = String(stop.startTime ?? "").trim();
  const endTime = String(stop.endTime ?? "").trim();
  const bands = cleanList(stop.bands);
  const modes = cleanList(stop.modes).map((mode) => mode.toUpperCase());

  if (!referenceIds.has(parkReference)) {
    errors.push(`${label} must use a known Rhode Island POTA reference.`);
  }

  if (!eventDatePattern.test(plannedDate)) {
    errors.push(`${label} date must be September 10-13, 2026.`);
  }

  if (!timePattern.test(startTime)) {
    errors.push(`${label} start time must use HH:MM 24-hour format.`);
  }

  if (!timePattern.test(endTime)) {
    errors.push(`${label} end time must use HH:MM 24-hour format.`);
  }

  if (
    timePattern.test(startTime) &&
    timePattern.test(endTime) &&
    endTime <= startTime
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
    bands,
    modes,
    publicNotes: String(stop.publicNotes ?? "").trim(),
    organizerNotes: String(stop.organizerNotes ?? "").trim(),
  };
}

function cleanList(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.map((item) => String(item).trim()).filter(Boolean);
}
