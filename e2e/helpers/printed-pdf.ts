import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";

export async function readPrintedPdf(bytes: Buffer) {
  const task = getDocument({ data: new Uint8Array(bytes), useSystemFonts: true });
  try {
    const document = await task.promise;
    const pages = [];
    for (let number = 1; number <= document.numPages; number += 1) {
      const page = await document.getPage(number);
      const viewport = page.getViewport({ scale: 1 });
      const content = await page.getTextContent();
      const textItems = content.items.filter((item) => "str" in item && item.str.trim());
      const annotations = await page.getAnnotations();
      pages.push({
        width: viewport.width,
        height: viewport.height,
        text: textItems.map((item) => "str" in item ? item.str : "").join(" ").replace(/\s+/g, " "),
        textItems: textItems.flatMap((item) => "str" in item ? [{
          text: item.str,
          x: Number(item.transform[4]),
          y: Number(item.transform[5]),
          width: item.width,
          height: item.height,
        }] : []),
        urls: annotations.flatMap((annotation) => [annotation.url, annotation.unsafeUrl].filter((url): url is string => typeof url === "string")),
      });
    }
    return pages;
  } finally {
    await task.destroy();
  }
}
