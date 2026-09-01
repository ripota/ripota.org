import type { ParksCatalogReference } from "../pota/catalog";

export type ParkGeometryLabel = "Mapped area" | "Reference location";

export type ParkGuideNavigationItem = {
  href: `#${string}`;
  label: string;
};

export function parkGuidePath(reference: string): string {
  return `/parks/${reference.trim().toLowerCase()}/`;
}

export function parkGeometryLabel(
  park: Pick<ParksCatalogReference, "geometryKind">,
): ParkGeometryLabel {
  if (park.geometryKind === "activation-zone" || park.geometryKind === "boundary") {
    return "Mapped area";
  }
  return "Reference location";
}

export function parkGeometryDescription(
  park: Pick<ParksCatalogReference, "geometryKind">,
): string {
  if (park.geometryKind === "activation-zone" || park.geometryKind === "boundary") {
    return "The highlighted area is based on the linked public map source. Confirm current POTA requirements before activating.";
  }
  return "The map shows the official POTA reference location because a local mapped area is not available.";
}

export function parkGuideNavigationItems(
  hasRelationship: boolean,
): ParkGuideNavigationItem[] {
  return [
    { href: "#map-facts", label: "Map facts" },
    ...(hasRelationship
      ? [{ href: "#overlap", label: "Possible 2-fer" } satisfies ParkGuideNavigationItem]
      : []),
    { href: "#community-reports", label: "Community reports" },
    { href: "#sources", label: "Sources" },
  ];
}

export function sameGeometryReferences(
  parks: ParksCatalogReference[],
  reference: string,
): ParksCatalogReference[] {
  const park = parks.find((candidate) => candidate.reference === reference);
  const fingerprint = park ? geometryFingerprint(park) : null;
  if (!park || !fingerprint) {
    return [];
  }

  return parks.filter(
    (candidate) =>
      candidate.reference !== reference && geometryFingerprint(candidate) === fingerprint,
  );
}

export function sameGeometryReferenceSet(
  parks: ParksCatalogReference[],
): Set<string> {
  const referencesByFingerprint = new Map<string, string[]>();
  for (const park of parks) {
    const fingerprint = geometryFingerprint(park);
    if (!fingerprint) {
      continue;
    }
    const references = referencesByFingerprint.get(fingerprint) ?? [];
    references.push(park.reference);
    referencesByFingerprint.set(fingerprint, references);
  }

  return new Set(
    [...referencesByFingerprint.values()]
      .filter((references) => references.length > 1)
      .flat(),
  );
}

function geometryFingerprint(park: ParksCatalogReference): string | null {
  if (park.status !== "available" || park.source.featureIds.length === 0) {
    return null;
  }

  return JSON.stringify({
    sourceUrl: park.source.url,
    geometryKind: park.geometryKind,
    featureIds: [...park.source.featureIds].map(String).sort(),
  });
}
