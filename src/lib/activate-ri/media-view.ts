import { validateMediaParkReference } from "./media-parks";

export type MediaScope = "admin" | "public" | "activator";
export type MediaFilters = { park: string; kind: "" | "photo" | "video"; featured: boolean };

export function readMediaFilters(url: URL, scope: MediaScope): MediaFilters {
  const park = url.searchParams.get("mediaPark") ?? "";
  const kind = url.searchParams.get("mediaKind") ?? "";
  return {
    park: scope === "public" && (park === "general" || (park !== "" && validateMediaParkReference(park))) ? park : "",
    kind: scope === "public" && (kind === "photo" || kind === "video") ? kind : "",
    featured: scope === "admin" && url.searchParams.get("mediaFeatured") === "1",
  };
}

export function writeMediaFilters(url: URL, filters: MediaFilters, scope: MediaScope): URL {
  const result = new URL(url.href);
  const entries = scope === "admin" ? [["mediaFeatured", filters.featured ? "1" : ""]]
    : scope === "public" ? [["mediaPark", filters.park], ["mediaKind", filters.kind]] : [];
  for (const [key, value] of entries) {
    if (value) result.searchParams.set(key, value);
    else result.searchParams.delete(key);
  }
  return result;
}
