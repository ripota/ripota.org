import { describe, expect, it } from "vitest";
import {
  applyHunterImport,
  clearHunterChecklistState,
  effectiveHuntedReferences,
  emptyHunterChecklistState,
  formatHunterImportSummary,
  hasHunterChecklistData,
  normalizeHunterChecklistState,
  parseHunterParksCsv,
  readHunterChecklistState,
  remainingHunterReferences,
  writeHunterChecklistState,
  type HunterReference,
} from "./hunter-checklist";

const references: HunterReference[] = [
  { reference: "US-0513", name: "Block Island", potaUrl: "https://pota.app/#/park/US-0513" },
  { reference: "US-2872", name: "Colt", potaUrl: "https://pota.app/#/park/US-2872" },
];

describe("hunter checklist CSV import", () => {
  it("handles BOM, reordered fields, CRLF, quoted commas, duplicates, and non-RI rows", () => {
    const result = parseHunterParksCsv(
      '\uFEFF"Reference","Park Name","Location"\r\n"us-0513","Island, Refuge","US-RI"\r\n"US-9000","Elsewhere","US-MA"\r\n"US-0513","Duplicate","US-RI"\r\n',
      references,
    );

    expect(result).toEqual({
      importedReferenceIds: ["US-0513"],
      unmatchedRiReferenceIds: [],
      examinedRows: 3,
      ignoredNonRiRows: 1,
      recoveredRows: 0,
      skippedRows: 0,
      affectedRowNumbers: [],
    });
  });

  it("reports unknown Rhode Island references but accepts a valid zero-match export", () => {
    expect(parseHunterParksCsv(
      '"DX Entity","Location","HASC","Reference"\n"United States","US-RI","US.RI","US-9999"\n"United States","US-MA","US.MA","US-8888"',
      references,
    )).toEqual({
      importedReferenceIds: [],
      unmatchedRiReferenceIds: ["US-9999"],
      examinedRows: 2,
      ignoredNonRiRows: 1,
      recoveredRows: 0,
      skippedRows: 0,
      affectedRowNumbers: [],
    });
  });

  it("recovers POTA rows with unescaped quotes and continues after unreadable rows", () => {
    const result = parseHunterParksCsv([
      '"DX Entity","Location","HASC","Reference","Park Name","First QSO Date","QSOs"',
      '"United States","US-UT","US.UT","US-13488","Pando - "I Spread" - Aspen Clone Site","2026-01-01",1',
      '"United States","US-RI","US.RI","US-0513","Block Island","2026-01-02",2',
      '"Unreadable row',
      '"United States","US-RI","US.RI","US-2872","Colt State Park","2026-01-03",3',
    ].join("\n"), references);

    expect(result).toEqual({
      importedReferenceIds: ["US-0513", "US-2872"],
      unmatchedRiReferenceIds: [],
      examinedRows: 4,
      ignoredNonRiRows: 1,
      recoveredRows: 1,
      skippedRows: 1,
      affectedRowNumbers: [2, 4],
    });
    expect(formatHunterImportSummary(result)).toBe(
      "Import complete with warnings: examined 4 rows, found 2 current Rhode Island parks, and ignored 1 non-Rhode Island row. Recovered 1 malformed row. Skipped 1 unreadable row. Your checklist was updated with the records we could read and may be incomplete. Affected rows: 2, 4.",
    );
  });

  it("uses a row when required fields are readable even if a later field is unclosed", () => {
    expect(parseHunterParksCsv(
      '"Location","Reference","Park Name"\n"US-RI","US-0513","Unclosed name',
      references,
    )).toEqual({
      importedReferenceIds: ["US-0513"],
      unmatchedRiReferenceIds: [],
      examinedRows: 1,
      ignoredNonRiRows: 0,
      recoveredRows: 1,
      skippedRows: 0,
      affectedRowNumbers: [2],
    });
  });

  it.each([
    ["missing header", '"Location","Park Name"\n"US-RI","Somewhere"', /Reference/],
    ["empty", '"Reference","Park Name"\n', /empty/i],
    ["malformed header", '"Reference","Park Name\n"US-0513","Somewhere"', /header/i],
    ["no usable rows", '"Reference","Park Name"\n"Unreadable row', /usable park rows/i],
    ["unsupported text", '"Reference"\n"US-0513\uFFFD"', /UTF-8/i],
  ])("rejects %s CSV", (_name, csv, expected) => {
    expect(() => parseHunterParksCsv(csv, references)).toThrow(expected);
  });
});

describe("hunter checklist state", () => {
  it("replaces imported references while preserving explicit overrides", () => {
    const state = {
      ...emptyHunterChecklistState(),
      importedReferenceIds: ["US-0513"],
      manualOverrides: { "US-0513": false, "US-2872": true },
    };
    const next = applyHunterImport(state, {
      importedReferenceIds: ["US-2872"],
      unmatchedRiReferenceIds: [],
      examinedRows: 1,
      ignoredNonRiRows: 0,
      recoveredRows: 0,
      skippedRows: 0,
      affectedRowNumbers: [],
    }, "2026-08-30T00:00:00.000Z");

    expect(next.importedReferenceIds).toEqual(["US-2872"]);
    expect(next.manualOverrides).toEqual(state.manualOverrides);
    expect([...effectiveHuntedReferences(next, references)]).toEqual(["US-2872"]);
  });

  it("drops stale and invalid reference state when the catalog changes", () => {
    expect(normalizeHunterChecklistState({
      version: 1,
      importedReferenceIds: ["US-0513", "US-9999", 42],
      manualOverrides: { "US-2872": true, "US-9999": false, "US-0513": "yes" },
      lastImportedAt: "2026-08-30T00:00:00.000Z",
    }, references)).toEqual({
      version: 1,
      importedReferenceIds: ["US-0513"],
      manualOverrides: { "US-2872": true },
      lastImportedAt: "2026-08-30T00:00:00.000Z",
    });
  });

  it("derives remaining references after imported and manual hunter choices", () => {
    const state = {
      ...emptyHunterChecklistState(),
      importedReferenceIds: ["US-0513"],
      manualOverrides: { "US-0513": false },
      lastImportedAt: "2026-08-30T00:00:00.000Z",
    };

    expect(remainingHunterReferences(state, references)).toEqual(references);
    expect(hasHunterChecklistData(state)).toBe(true);
    expect(hasHunterChecklistData(emptyHunterChecklistState())).toBe(false);
  });

  it("reads, writes, and clears normalized browser-local state", () => {
    const values = new Map<string, string>();
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
      removeItem: (key: string) => values.delete(key),
    };
    const state = {
      ...emptyHunterChecklistState(),
      importedReferenceIds: ["US-0513", "US-9999"],
      lastImportedAt: "2026-08-30T00:00:00.000Z",
    };

    writeHunterChecklistState(storage, state);
    expect(readHunterChecklistState(storage, references)).toEqual({
      ...state,
      importedReferenceIds: ["US-0513"],
    });
    clearHunterChecklistState(storage);
    expect(readHunterChecklistState(storage, references)).toEqual(emptyHunterChecklistState());
  });
});
