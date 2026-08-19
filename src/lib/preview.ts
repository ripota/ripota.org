export const previewQueryParameter = "preview";

export function enabledPreviewFeatures(
  searchParams: URLSearchParams,
): Set<string> {
  return new Set(
    searchParams
      .getAll(previewQueryParameter)
      .flatMap((value) => value.split(","))
      .map((value) => value.trim().toLowerCase())
      .filter(Boolean),
  );
}

export function isPreviewFeatureEnabled(
  feature: string,
  search = window.location.search,
): boolean {
  return enabledPreviewFeatures(new URLSearchParams(search)).has(
    feature.trim().toLowerCase(),
  );
}
