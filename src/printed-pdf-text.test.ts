import { describe, expect, it } from "vitest";
import { printedPdfText } from "../e2e/helpers/pdf-text";

describe("printed PDF text", () => {
  it("preserves words split into font runs around ligatures", () => {
    expect(printedPdfText([
      { str: "Event-day", hasEOL: false },
      { str: " ", hasEOL: false },
      { str: "fi", hasEOL: false },
      { str: "lters use Rhode Island time.", hasEOL: true },
      { str: "Not an o", hasEOL: false },
      { str: "ffi", hasEOL: false },
      { str: "cial POTA site.", hasEOL: true },
    ])).toBe("Event-day filters use Rhode Island time. Not an official POTA site.");
  });

  it("retains explicit word spaces and separates line endings", () => {
    expect(printedPdfText([
      { str: "  US-2868", hasEOL: false },
      { str: " ", hasEOL: false },
      { str: "Beavertail", hasEOL: false },
      { str: "", hasEOL: true },
      { str: "Fri 9:00 AM", hasEOL: true },
      { str: "  12:00 PM  ", hasEOL: true },
    ])).toBe("US-2868 Beavertail Fri 9:00 AM 12:00 PM");
  });

  it("normalizes Unicode ligatures", () => {
    expect(printedPdfText([{ str: "Oﬃcial ﬁlters", hasEOL: true }])).toBe("Official filters");
    expect(printedPdfText([])).toBe("");
  });
});
