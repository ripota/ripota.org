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
