export const normalizePotaReference = (reference: string): string =>
  reference.trim().toUpperCase();

export const officialPotaParkUrl = (reference: string): string =>
  `https://pota.app/#/park/${normalizePotaReference(reference)}`;
