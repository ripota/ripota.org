import type { PublicActivationStop, StopExportRow } from "./types";

export function routeRowsToPublicStops(rows: StopExportRow[]): PublicActivationStop[] {
  return rows.map((row) => ({
    id: row.id,
    parkReference: row.park_reference,
    plannedDate: row.planned_date,
    startTime: row.start_time,
    endTime: row.end_time,
    activatorCallsign: row.submitter_callsign,
    bands: parseStringArray(row.bands_json),
    modes: parseStringArray(row.modes_json),
    publicNotes: row.public_notes ?? "",
    status: row.status,
  }));
}

export function parseStringArray(value: string): string[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value) as unknown;
  } catch {
    return [];
  }

  if (!Array.isArray(parsed)) {
    return [];
  }

  return parsed
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter(Boolean);
}
