import type { ActivatorMedia } from "./media";

export type RecapPhoto = Pick<ActivatorMedia, "id" | "callsign" | "authorLabel" | "title" | "parkReference"> & {
  kind: "photo";
  featuredOnRecap: true;
  thumbnailUrl: string;
};

/** Read the whole curated pool, including selections older than a gallery page. */
export async function loadFeaturedRecapPhotos(fetcher: typeof fetch = fetch): Promise<RecapPhoto[]> {
  const photos = new Map<string, RecapPhoto>();
  const cursors = new Set<string>();
  let cursor: string | null = null;
  do {
    const query = new URLSearchParams({ kind: "photo", featured: "1" });
    if (cursor) query.set("cursor", cursor);
    const response = await fetcher(`/api/activate-ri-2026/public/media?${query}`, {
      headers: { accept: "application/json" }, credentials: "omit", cache: "no-store",
    });
    if (!response.ok) throw new Error("Gallery unavailable");
    const body: unknown = await response.json();
    if (!isRecord(body) || body.ok !== true || !Array.isArray(body.media)
      || !(body.nextCursor === null || typeof body.nextCursor === "string" && body.nextCursor.length > 0)) {
      throw new Error("Gallery unavailable");
    }
    for (const item of body.media) if (isRecapPhoto(item)) photos.set(item.id, item);
    cursor = body.nextCursor;
    if (cursor && cursors.has(cursor)) throw new Error("Gallery pagination repeated");
    if (cursor) cursors.add(cursor);
  } while (cursor);
  return [...photos.values()];
}

/** Choose once per visit; favour different contributors before filling spare places. */
export function selectRecapPhotos<T extends Pick<RecapPhoto, "id" | "callsign">>(photos: readonly T[], random = Math.random): T[] {
  const shuffled = [...new Map(photos.map((photo) => [photo.id, photo])).values()];
  for (let index = shuffled.length - 1; index > 0; index--) {
    const other = Math.floor(random() * (index + 1));
    [shuffled[index], shuffled[other]] = [shuffled[other], shuffled[index]];
  }
  const selected: T[] = [];
  const authors = new Set<string>();
  for (const photo of shuffled) {
    const callsign = photo.callsign.trim().toUpperCase();
    if (authors.has(callsign)) continue;
    selected.push(photo);
    authors.add(callsign);
    if (selected.length === 3) return selected;
  }
  for (const photo of shuffled) {
    if (selected.length === 3) break;
    if (!selected.some(({ id }) => id === photo.id)) selected.push(photo);
  }
  return selected;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function isRecapPhoto(value: unknown): value is RecapPhoto {
  return isRecord(value) && value.kind === "photo" && value.featuredOnRecap === true
    && typeof value.id === "string" && /^[a-f0-9-]{36}$/.test(value.id)
    && typeof value.authorLabel === "string" && typeof value.callsign === "string"
    && typeof value.thumbnailUrl === "string"
    && value.thumbnailUrl.startsWith("/api/activate-ri-2026/public/media/")
    && (value.title === null || typeof value.title === "string")
    && (value.parkReference === null || typeof value.parkReference === "string");
}
