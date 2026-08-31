export const HUNTER_CHECKLIST_STORAGE_KEY = "activate-ri-2026:hunter-checklist:v1";
export const HUNTER_CHECKLIST_VERSION = 1;
export const HUNTER_CSV_MAX_BYTES = 5 * 1024 * 1024;

export type HunterReference = {
  reference: string;
  name: string;
  potaUrl: string;
};

export type HunterReferenceIdentity = Pick<HunterReference, "reference">;

export type HunterChecklistStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

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
  recoveredRows: number;
  skippedRows: number;
  affectedRowNumbers: number[];
};

const MAX_REPORTED_AFFECTED_ROWS = 5;

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

  const lines = source.replace(/^\uFEFF/, "").split(/\r\n|\n|\r/);
  const headerLineIndex = lines.findIndex((line) => line.trim() !== "");
  if (headerLineIndex === -1) {
    throw new Error("This export is empty. Export Hunted Parks from POTA and try again.");
  }

  const header = parseCsvLine(lines[headerLineIndex]);
  if (!header.complete) {
    throw new Error("This CSV has a malformed header row.");
  }

  const headers = header.fields.map((value) => value.trim());
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
  let usableRows = 0;
  let recoveredRows = 0;
  let skippedRows = 0;
  const affectedRowNumbers: number[] = [];

  for (let lineIndex = headerLineIndex + 1; lineIndex < lines.length; lineIndex += 1) {
    const line = lines[lineIndex];
    if (line.trim() === "") continue;
    examinedRows += 1;
    const parsed = parseCsvLine(line);
    const rowNumber = lineIndex + 1;
    const malformed = parsed.recovered || !parsed.complete || parsed.fields.length !== headers.length;
    const reference = normalizeReference(parsed.fields[referenceIndex]);
    if (!reference) {
      skippedRows += 1;
      recordAffectedRow(affectedRowNumbers, rowNumber);
      continue;
    }

    usableRows += 1;
    if (malformed) {
      recoveredRows += 1;
      recordAffectedRow(affectedRowNumbers, rowNumber);
    }

    if (known.has(reference)) {
      imported.add(reference);
      continue;
    }

    const location = normalizeLocation(locationIndex >= 0 ? parsed.fields[locationIndex] : "");
    const hasc = normalizeLocation(hascIndex >= 0 ? parsed.fields[hascIndex] : "");
    if (location === "US-RI" || hasc === "US-RI" || hasc === "US.RI") {
      unmatchedRi.add(reference);
    } else {
      ignoredNonRiRows += 1;
    }
  }

  if (examinedRows === 0) {
    throw new Error("This export is empty. Export Hunted Parks from POTA and try again.");
  }
  if (usableRows === 0) {
    throw new Error("This CSV does not contain any usable park rows.");
  }

  return {
    importedReferenceIds: [...imported].sort(),
    unmatchedRiReferenceIds: [...unmatchedRi].sort(),
    examinedRows,
    ignoredNonRiRows,
    recoveredRows,
    skippedRows,
    affectedRowNumbers,
  };
}

export function formatHunterImportSummary(result: HunterCsvResult): string {
  const warnings = result.recoveredRows > 0 || result.skippedRows > 0;
  const examined = `${result.examinedRows} row${result.examinedRows === 1 ? "" : "s"}`;
  const found = `${result.importedReferenceIds.length} current Rhode Island park${result.importedReferenceIds.length === 1 ? "" : "s"}`;
  const ignored = `${result.ignoredNonRiRows} non-Rhode Island row${result.ignoredNonRiRows === 1 ? "" : "s"}`;
  const unmatched = result.unmatchedRiReferenceIds.length > 0
    ? ` ${result.unmatchedRiReferenceIds.length} Rhode Island reference ID${result.unmatchedRiReferenceIds.length === 1 ? " was" : "s were"} not in the current RI list: ${result.unmatchedRiReferenceIds.join(", ")}.`
    : "";
  const recovered = result.recoveredRows > 0
    ? ` Recovered ${result.recoveredRows} malformed row${result.recoveredRows === 1 ? "" : "s"}.`
    : "";
  const skipped = result.skippedRows > 0
    ? ` Skipped ${result.skippedRows} unreadable row${result.skippedRows === 1 ? "" : "s"}. Your checklist was updated with the records we could read and may be incomplete.`
    : "";
  const affected = result.affectedRowNumbers.length > 0
    ? ` Affected row${result.affectedRowNumbers.length === 1 ? "" : "s"}: ${result.affectedRowNumbers.join(", ")}${result.recoveredRows + result.skippedRows > result.affectedRowNumbers.length ? ", and others" : ""}.`
    : "";

  return `Import complete${warnings ? " with warnings" : ""}: examined ${examined}, found ${found}, and ignored ${ignored}.${unmatched}${recovered}${skipped}${affected}`;
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
  references: readonly HunterReferenceIdentity[],
): Set<string> {
  const imported = new Set(state.importedReferenceIds);
  return new Set(
    references
      .filter(({ reference }) => state.manualOverrides[reference] ?? imported.has(reference))
      .map(({ reference }) => reference),
  );
}

export function remainingHunterReferences<T extends HunterReferenceIdentity>(
  state: HunterChecklistState,
  references: readonly T[],
): T[] {
  const hunted = effectiveHuntedReferences(state, references);
  return references.filter(({ reference }) => !hunted.has(reference));
}

export function hasHunterChecklistData(state: HunterChecklistState): boolean {
  return state.lastImportedAt !== null || Object.keys(state.manualOverrides).length > 0;
}

export function readHunterChecklistState(
  storage: Pick<HunterChecklistStorage, "getItem">,
  references: readonly HunterReferenceIdentity[],
): HunterChecklistState {
  const stored = storage.getItem(HUNTER_CHECKLIST_STORAGE_KEY);
  return stored
    ? normalizeHunterChecklistState(JSON.parse(stored), references)
    : emptyHunterChecklistState();
}

export function writeHunterChecklistState(
  storage: Pick<HunterChecklistStorage, "setItem">,
  state: HunterChecklistState,
): void {
  storage.setItem(HUNTER_CHECKLIST_STORAGE_KEY, JSON.stringify(state));
}

export function clearHunterChecklistState(
  storage: Pick<HunterChecklistStorage, "removeItem">,
): void {
  storage.removeItem(HUNTER_CHECKLIST_STORAGE_KEY);
}

export function normalizeHunterChecklistState(
  value: unknown,
  references: readonly HunterReferenceIdentity[],
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

type CsvLineResult = {
  fields: string[];
  complete: boolean;
  recovered: boolean;
};

function parseCsvLine(source: string): CsvLineResult {
  const fields: string[] = [];
  let field = "";
  let quoted = false;
  let afterQuote = false;
  let recovered = false;

  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    if (quoted) {
      if (character === '"' && source[index + 1] === '"') {
        field += '"';
        index += 1;
      } else if (character === '"') {
        if (canCloseQuotedField(source, index)) {
          quoted = false;
          afterQuote = true;
        } else {
          field += '"';
          recovered = true;
        }
      } else {
        field += character;
      }
      continue;
    }

    if (afterQuote && (character === " " || character === "\t")) {
      recovered = true;
      continue;
    }
    if (afterQuote && character !== ",") {
      field += `"${character}`;
      afterQuote = false;
      recovered = true;
      continue;
    }
    if (character === '"') {
      if (field.length > 0 || afterQuote) {
        field += '"';
        recovered = true;
      } else {
        quoted = true;
      }
    } else if (character === ",") {
      fields.push(field);
      field = "";
      afterQuote = false;
    } else {
      field += character;
    }
  }

  fields.push(field);
  return { fields, complete: !quoted, recovered };
}

function canCloseQuotedField(source: string, quoteIndex: number): boolean {
  for (let index = quoteIndex + 1; index < source.length; index += 1) {
    const character = source[index];
    if (character === " " || character === "\t") continue;
    return character === ",";
  }
  return true;
}

function recordAffectedRow(rows: number[], rowNumber: number): void {
  if (rows.length < MAX_REPORTED_AFFECTED_ROWS) rows.push(rowNumber);
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
