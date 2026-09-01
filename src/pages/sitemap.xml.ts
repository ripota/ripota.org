import { siteIdentity } from "../data/site";
import { parksCatalog } from "../lib/pota/catalog";
import { parkGuidePath } from "../lib/parks/directory";

export const prerender = true;

export const publicPagePaths = [
  "/",
  "/assets/",
  "/on-air/",
  "/parks/",
  "/activate-ri-2026/",
  "/activate-ri-2026/help/",
  "/activate-ri-2026/hunter/",
  "/activate-ri-2026/parks/",
  "/activate-ri-2026/schedule/",
  "/activate-ri-2026/volunteer/",
] as const;

export function sitemapPaths(): string[] {
  return [
    ...publicPagePaths,
    ...parksCatalog.references.map(({ reference }) => parkGuidePath(reference)),
  ];
}

export function GET(): Response {
  const urls = sitemapPaths()
    .map((path) => `  <url><loc>${new URL(path, siteIdentity.url)}</loc></url>`)
    .join("\n");

  return new Response(
    `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`,
    { headers: { "content-type": "application/xml; charset=utf-8" } },
  );
}
