import catalogData from "@ripota/parks/catalog.json";
import type { Catalog } from "@ripota/parks/types";

// Build-time source for reviewed provenance and relationship calculations.
// Marker-only consumers use @ripota/parks/display instead.
export const parksCatalog: Catalog = catalogData as unknown as Catalog;
