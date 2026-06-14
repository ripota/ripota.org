export type PotaReferenceSource = {
  reference: string;
  name: string;
  latitude: string | number;
  longitude: string | number;
  grid: string;
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
        locationDesc: source.locationDesc ?? source.location ?? "US-RI",
        potaUrl: officialPotaParkUrl(reference),
      };
    })
    .sort((left, right) => left.reference.localeCompare(right.reference));
}
