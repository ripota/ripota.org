export type PotaReferenceSource = {
  reference: string;
  name: string;
  latitude: string | number;
  longitude: string | number;
  grid: string;
  counties?: string[];
  location?: string;
  locationDesc?: string;
  [key: string]: unknown;
};

export type PotaReference = {
  reference: string;
  name: string;
  latitude: number;
  longitude: number;
  grid: string;
  counties: string[];
  locationDesc: string;
  potaUrl: string;
};

export const normalizePotaReference = (reference: string): string =>
  reference.trim().toUpperCase();

export const officialPotaParkUrl = (reference: string): string =>
  `https://pota.app/#/park/${normalizePotaReference(reference)}`;

export function normalizePotaReferences(
  references: PotaReferenceSource[],
): PotaReference[] {
  return references
    .map((source) => {
      const reference = normalizePotaReference(source.reference);

      return {
        reference,
        name: source.name,
        latitude: Number(source.latitude),
        longitude: Number(source.longitude),
        grid: source.grid,
        counties: [...(source.counties ?? [])].sort((left, right) =>
          left.localeCompare(right),
        ),
        locationDesc: source.locationDesc ?? source.location ?? "US-RI",
        potaUrl: officialPotaParkUrl(reference),
      };
    })
    .sort((left, right) => left.reference.localeCompare(right.reference));
}
