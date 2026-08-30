export const HUNTER_CHECKLIST_STORAGE_KEY = "activate-ri-2026:hunter-checklist:v1";
export const HUNTER_CHECKLIST_VERSION = 1;
export const HUNTER_CSV_MAX_BYTES = 5 * 1024 * 1024;

export type HunterReference = {
  reference: string;
  name: string;
  potaUrl: string;
};

export type HunterChecklistState = {
  version: typeof HUNTER_CHECKLIST_VERSION;
  importedReferenceIds: string[];
  manualOverrides: Record<string, boolean>;
  lastImportedAt: string | null;
};

export type HunterCsvResult = {
  importedReferenceIds: string[];
  unmatchedRiReferenceIds: string[];
  examinedRows: number;
  ignoredNonRiRows: number;
};

export function emptyHunterChecklistState(): HunterChecklistState {
  return {
    version: HUNTER_CHECKLIST_VERSION,
    importedReferenceIds: [],
    manualOverrides: {},
    lastImportedAt: null,
  };
}

export function parseHunterParksCsv(
  source: string,
  references: readonly HunterReference[],
): HunterCsvResult {
  if (source.includes("\uFFFD") || source.includes("\0")) {
    throw new Error("This file is not supported UTF-8 CSV text.");
  }

  const rows = parseCsvRows(source.replace(/^\uFEFF/, ""));
  if (rows.length < 2) {
    throw new Error("This export is empty. Export Hunted Parks from POTA and try again.");
  }

  const headers = rows[0].map((header) => header.trim());
  const referenceIndex = headers.indexOf("Reference");
  if (referenceIndex === -1) {
    throw new Error('This CSV is missing the required "Reference" column.');
  }

  const locationIndex = headers.indexOf("Location");
  const hascIndex = headers.indexOf("HASC");
  const known = new Set(references.map((reference) => reference.reference));
  const imported = new Set<string>();
  const unmatchedRi = new Set<string>();
  let examinedRows = 0;
  let ignoredNonRiRows = 0;

  for (const row of rows.slice(1)) {
    if (row.every((value) => value.trim() === "")) continue;
    if (row.length !== headers.length) {
      throw new Error(`Malformed CSV row ${examinedRows + 2}: the column count does not match the header.`);
    }

    examinedRows += 1;
    const reference = normalizeReference(row[referenceIndex]);
    if (!reference) continue;

    if (known.has(reference)) {
      imported.add(reference);
      continue;
    }

    const location = normalizeLocation(locationIndex >= 0 ? row[locationIndex] : "");
    const hasc = normalizeLocation(hascIndex >= 0 ? row[hascIndex] : "");
    if (location === "US-RI" || hasc === "US-RI" || hasc === "US.RI") {
      unmatchedRi.add(reference);
    } else {
      ignoredNonRiRows += 1;
    }
  }

  if (examinedRows === 0) {
    throw new Error("This export is empty. Export Hunted Parks from POTA and try again.");
  }

  return {
    importedReferenceIds: [...imported].sort(),
    unmatchedRiReferenceIds: [...unmatchedRi].sort(),
    examinedRows,
    ignoredNonRiRows,
  };
}

export function applyHunterImport(
  current: HunterChecklistState,
  result: HunterCsvResult,
  importedAt = new Date().toISOString(),
): HunterChecklistState {
  return {
    version: HUNTER_CHECKLIST_VERSION,
    importedReferenceIds: [...result.importedReferenceIds],
    manualOverrides: { ...current.manualOverrides },
    lastImportedAt: importedAt,
  };
}

export function effectiveHuntedReferences(
  state: HunterChecklistState,
  references: readonly HunterReference[],
): Set<string> {
  const imported = new Set(state.importedReferenceIds);
  return new Set(
    references
      .filter(({ reference }) => state.manualOverrides[reference] ?? imported.has(reference))
      .map(({ reference }) => reference),
  );
}

export function normalizeHunterChecklistState(
  value: unknown,
  references: readonly HunterReference[],
): HunterChecklistState {
  const empty = emptyHunterChecklistState();
  if (!isRecord(value) || value.version !== HUNTER_CHECKLIST_VERSION) return empty;

  const known = new Set(references.map((reference) => reference.reference));
  const importedReferenceIds = Array.isArray(value.importedReferenceIds)
    ? [...new Set(value.importedReferenceIds.filter((item): item is string =>
        typeof item === "string" && known.has(item),
      ))].sort()
    : [];
  const manualOverrides: Record<string, boolean> = {};
  if (isRecord(value.manualOverrides)) {
    for (const [reference, hunted] of Object.entries(value.manualOverrides)) {
      if (known.has(reference) && typeof hunted === "boolean") manualOverrides[reference] = hunted;
    }
  }

  return {
    version: HUNTER_CHECKLIST_VERSION,
    importedReferenceIds,
    manualOverrides,
    lastImportedAt: typeof value.lastImportedAt === "string" ? value.lastImportedAt : null,
  };
}

function parseCsvRows(source: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  let afterQuote = false;

  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    if (quoted) {
      if (character === '"' && source[index + 1] === '"') {
        field += '"';
        index += 1;
      } else if (character === '"') {
        quoted = false;
        afterQuote = true;
      } else {
        field += character;
      }
      continue;
    }

    if (afterQuote && character !== "," && character !== "\r" && character !== "\n") {
      throw new Error("Malformed CSV: unexpected text after a quoted field.");
    }
    if (character === '"') {
      if (field.length > 0 || afterQuote) throw new Error("Malformed CSV: unexpected quote.");
      quoted = true;
    } else if (character === ",") {
      row.push(field);
      field = "";
      afterQuote = false;
    } else if (character === "\n" || character === "\r") {
      if (character === "\r" && source[index + 1] === "\n") index += 1;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
      afterQuote = false;
    } else {
      field += character;
    }
  }

  if (quoted) throw new Error("Malformed CSV: an opening quote is not closed.");
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

function normalizeReference(value: string | undefined): string | null {
  const normalized = value?.trim().toUpperCase() ?? "";
  return /^[A-Z]{1,4}-\d{4,6}$/.test(normalized) ? normalized : null;
}

function normalizeLocation(value: string | undefined): string {
  return value?.trim().toUpperCase().replaceAll("_", "-") ?? "";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
