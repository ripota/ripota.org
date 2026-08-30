import { describe, expect, it } from "vitest";
import {
  applyHunterImport,
  effectiveHuntedReferences,
  emptyHunterChecklistState,
  normalizeHunterChecklistState,
  parseHunterParksCsv,
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
    });
  });

  it.each([
    ["missing header", '"Location","Park Name"\n"US-RI","Somewhere"', /Reference/],
    ["empty", '"Reference","Park Name"\n', /empty/i],
    ["unclosed quote", '"Reference","Park Name"\n"US-0513","Somewhere', /opening quote/i],
    ["bad column count", '"Reference","Park Name"\n"US-0513"', /column count/i],
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
});
