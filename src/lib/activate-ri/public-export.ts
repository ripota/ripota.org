import type { PublicActivationStop } from "./types";

const publicStatuses = new Set(["scheduled", "delayed", "cancelled", "completed"]);

type PublicExportRow = {
  id: string;
  park_reference: string;
  planned_date: string;
  start_time: string;
  end_time: string;
  submitter_callsign: string;
  bands_json: string;
  modes_json: string;
  public_notes?: unknown;
  status: PublicActivationStop["status"];
};

export function routeRowsToPublicStops(rows: unknown[]): PublicActivationStop[] {
  return rows.flatMap((row) => {
    const exportRow = parsePublicExportRow(row);
    if (exportRow === null) {
      return [];
    }

    return [
      {
        id: exportRow.id,
        parkReference: exportRow.park_reference,
        plannedDate: exportRow.planned_date,
        startTime: exportRow.start_time,
        endTime: exportRow.end_time,
        activatorCallsign: exportRow.submitter_callsign,
        bands: parseStringArray(exportRow.bands_json),
        modes: parseStringArray(exportRow.modes_json),
        publicNotes:
          typeof exportRow.public_notes === "string" ? exportRow.public_notes : "",
        status: exportRow.status,
      },
    ];
  });
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

function parsePublicExportRow(row: unknown): PublicExportRow | null {
  if (!isRecord(row)) {
    return null;
  }

  const id = stringField(row, "id");
  const park_reference = stringField(row, "park_reference");
  const planned_date = stringField(row, "planned_date");
  const start_time = stringField(row, "start_time");
  const end_time = stringField(row, "end_time");
  const submitter_callsign = stringField(row, "submitter_callsign");
  const bands_json = stringField(row, "bands_json");
  const modes_json = stringField(row, "modes_json");
  const status = stringField(row, "status");

  if (
    id === null ||
    park_reference === null ||
    planned_date === null ||
    start_time === null ||
    end_time === null ||
    submitter_callsign === null ||
    bands_json === null ||
    modes_json === null ||
    !isPublicStatus(status)
  ) {
    return null;
  }

  return {
    id,
    park_reference,
    planned_date,
    start_time,
    end_time,
    submitter_callsign,
    bands_json,
    modes_json,
    public_notes: row.public_notes,
    status,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function stringField(row: Record<string, unknown>, field: string): string | null {
  const value = row[field];
  return typeof value === "string" ? value : null;
}

function isPublicStatus(status: string | null): status is PublicExportRow["status"] {
  return status !== null && publicStatuses.has(status);
}
