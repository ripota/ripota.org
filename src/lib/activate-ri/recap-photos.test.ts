import { describe, expect, it, vi } from "vitest";
import { loadFeaturedRecapPhotos, selectRecapPhotos } from "./recap-photos";

function photo(index: number, callsign = `N1TEST${index}`) {
  const id = `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`;
  return { id, kind: "photo", featuredOnRecap: true, callsign, authorLabel: callsign,
    title: null, parkReference: null, thumbnailUrl: `/api/activate-ri-2026/public/media/${id}/thumbnail` };
}

describe("the curated recap photo pool", () => {
  it("loads older selections through pagination, deduplicates, and accepts only featured photos", async () => {
    const first = photo(1);
    const older = photo(2);
    const fetcher = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json({ ok: true, media: [first,
        { ...photo(3), featuredOnRecap: false }, { ...photo(4), kind: "video" },
        { ...photo(5), thumbnailUrl: "https://example.com/photo.jpg" },
        { ...photo(6), featuredOnRecap: undefined }, null,
      ], nextCursor: "older+page/2=" }))
      .mockResolvedValueOnce(Response.json({ ok: true, media: [first, older], nextCursor: null }));
    await expect(loadFeaturedRecapPhotos(fetcher)).resolves.toEqual([first, older]);
    expect(fetcher.mock.calls.map(([url]) => String(url))).toEqual([
      "/api/activate-ri-2026/public/media?kind=photo&featured=1",
      "/api/activate-ri-2026/public/media?kind=photo&featured=1&cursor=older%2Bpage%2F2%3D",
    ]);
    expect(fetcher.mock.calls.every(([, options]) => options?.credentials === "omit" && options.cache === "no-store")).toBe(true);
  });

  it("does not fall back to unreviewed uploads when nothing is selected", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json({
      ok: true, media: [{ ...photo(1), featuredOnRecap: false }], nextCursor: null,
    }));
    await expect(loadFeaturedRecapPhotos(fetcher)).resolves.toEqual([]);
  });

  it("rejects a later failed page instead of presenting an incomplete curated pool", async () => {
    const fetcher = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json({ ok: true, media: [photo(1)], nextCursor: "next" }))
      .mockResolvedValueOnce(new Response("", { status: 503 }));
    await expect(loadFeaturedRecapPhotos(fetcher)).rejects.toThrow("Gallery unavailable");
  });

  it("stops repeated cursors and malformed pagination", async () => {
    const repeated = vi.fn<typeof fetch>().mockImplementation(async () => Response.json({ ok: true, media: [], nextCursor: "same" }));
    await expect(loadFeaturedRecapPhotos(repeated)).rejects.toThrow("pagination repeated");
    expect(repeated).toHaveBeenCalledTimes(2);
    const malformed = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ ok: true, media: [], nextCursor: 123 }));
    await expect(loadFeaturedRecapPhotos(malformed)).rejects.toThrow("Gallery unavailable");
  });
});

describe("choosing photos once for a visit", () => {
  it("prioritizes distinct contributors without mutating the pool or repeating a photo", () => {
    const pool = [photo(1, "n1one"), photo(2, "N1ONE"), photo(3, "N1TWO"), photo(4, "N1THREE"), photo(1, "n1one")];
    const before = structuredClone(pool);
    const chosen = selectRecapPhotos(pool, () => 0.99);
    expect(chosen.map(({ id }) => id)).toEqual([pool[0].id, pool[2].id, pool[3].id]);
    expect(pool).toEqual(before);
  });

  it("allows different visits to choose different photos from the approved pool", () => {
    const pool = [photo(1), photo(2), photo(3), photo(4), photo(5)];
    const first = selectRecapPhotos(pool, () => 0);
    const second = selectRecapPhotos(pool, () => 0.99);
    expect(first).toHaveLength(3);
    expect(second).toHaveLength(3);
    expect(first).not.toEqual(second);
    expect([...first, ...second].every((item) => pool.includes(item))).toBe(true);
  });

  it("fills remaining places from the same contributor and handles small pools", () => {
    const pool = [photo(1, "N1ONE"), photo(2, "N1ONE"), photo(3, "N1ONE"), photo(4, "N1ONE")];
    expect(selectRecapPhotos(pool)).toHaveLength(3);
    expect(selectRecapPhotos(pool.slice(0, 2))).toHaveLength(2);
    expect(selectRecapPhotos(pool.slice(0, 1))).toEqual(pool.slice(0, 1));
    expect(selectRecapPhotos([])).toEqual([]);
  });
});
