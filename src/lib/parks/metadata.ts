import type { Park, ParkAmenity, ParkType } from "@ripota/parks";

export const parkTypeLabels: Record<ParkType, string> = {
  park: "Park",
  beach: "Beach",
  forest: "Forest",
  "management-area": "Management area",
  "wildlife-refuge": "Wildlife refuge",
  preserve: "Preserve",
  "historic-site": "Historic site",
  trail: "Trail",
  "recreation-area": "Recreation area",
  "fishing-access": "Fishing access",
  campground: "Campground",
};

export const amenityLabels: Record<ParkAmenity, string> = {
  parking: "Parking",
  restrooms: "Restrooms",
  "picnic-tables": "Picnic tables",
  shelter: "Shelter",
  "drinking-water": "Drinking water",
  "boat-launch": "Boat launch",
  camping: "Camping",
};

export const accessLabels = {
  hours: "Hours & seasons",
  parking: "Getting there & parking",
  fees: "Fees",
  pets: "Pets",
  accessibility: "Accessibility",
} as const;

export function orangeLabel(orange: Park["orange"]): string {
  switch (orange.status) {
    case "required": return "Seasonal orange required";
    case "recommended": return "Orange recommended";
    case "area-dependent": return "Orange in some areas";
    case "not-required": return "No visitor orange requirement listed";
  }
}

export function parkMatchesFilters(
  park: Pick<Park, "reference" | "name" | "manager" | "type" | "counties" | "amenities">,
  filters: { query: string; county: string; type: string; amenity: string },
): boolean {
  const query = filters.query.trim().toLowerCase();
  const searchText = `${park.reference} ${park.name} ${park.manager} ${parkTypeLabels[park.type]}`.toLowerCase();
  return (!query || searchText.includes(query)) &&
    (filters.county === "all" || park.counties.includes(filters.county)) &&
    (filters.type === "all" || park.type === filters.type) &&
    (filters.amenity === "all" || park.amenities.some((amenity) => amenity === filters.amenity));
}
