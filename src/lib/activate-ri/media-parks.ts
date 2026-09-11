import references from "@ripota/parks/references.json" with { type: "json" };

// The pinned package's reference index contains identity metadata only. Keep
// complete visitor records and all geometry out of the upload browser bundle.
export const mediaParks: ReadonlyArray<{ reference: string; name: string }> = references
  .map(({ reference, name }) => ({ reference, name }))
  .sort((left, right) => left.name.localeCompare(right.name, "en"));

const parkNames = new Map(mediaParks.map(({ reference, name }) => [reference, name]));

export function validateMediaParkReference(value: unknown): value is string | null {
  return value === null || (typeof value === "string" && parkNames.has(value));
}

export function mediaParkName(reference: string | null): string {
  return reference === null ? "General — no park" : parkNames.get(reference) ?? reference;
}
