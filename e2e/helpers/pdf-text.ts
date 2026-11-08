type PdfTextRun = { str: string; hasEOL: boolean };

export function printedPdfText(items: readonly PdfTextRun[]): string {
  // PDF.js supplies word spaces and line endings. A font may split a single
  // word into several runs around ligatures, so runs must not add spaces.
  return items.map((item) => item.str + (item.hasEOL ? "\n" : ""))
    .join("")
    .normalize("NFKC")
    .replace(/\s+/g, " ")
    .trim();
}
