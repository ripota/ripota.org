import type { FeatureCollection } from "geojson";
import { describe, expect, it, vi } from "vitest";
import {
  createCanonicalGeometryLoader,
  createGeometryClassificationRequest,
  requireCanonicalGeometry,
} from "./canonical-geometry";

const park: FeatureCollection = {
  type: "FeatureCollection",
  features: [{
    type: "Feature",
    properties: { potaReference: "US-0513" },
    geometry: { type: "Point", coordinates: [-71.57, 41.22] },
  }],
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

describe("canonical geometry loading", () => {
  it("fetches only on demand, shares the pending request, and reuses successful geometry", async () => {
    const response = deferred<Response>();
    const fetchGeometry = vi.fn<typeof fetch>().mockReturnValue(response.promise);
    const load = createCanonicalGeometryLoader("/data/parks/3.1.1/all.geojson", { fetchGeometry });
    expect(fetchGeometry).not.toHaveBeenCalled();

    const first = load();
    const second = load();
    expect(first).toBe(second);
    response.resolve(new Response(JSON.stringify(park)));
    const geometry = await first;
    expect(requireCanonicalGeometry(geometry, "US-0513")).toEqual(park);
    expect(await load()).toBe(geometry);
    expect(fetchGeometry).toHaveBeenCalledExactlyOnceWith(
      "/data/parks/3.1.1/all.geojson",
      { credentials: "omit" },
    );
  });

  it("groups disconnected features under their reference without dropping any geometry", async () => {
    const collection = {
      ...park,
      features: [
        ...park.features,
        ...park.features,
        { ...park.features[0], properties: { potaReference: "US-0514" } },
      ],
    };
    const load = createCanonicalGeometryLoader("/all.geojson", {
      fetchGeometry: vi.fn<typeof fetch>()
        .mockResolvedValue(new Response(JSON.stringify(collection))),
    });
    const geometry = await load();
    expect(geometry.get("US-0513")?.features).toHaveLength(2);
    expect(geometry.get("US-0514")?.features).toHaveLength(1);
    expect(() => requireCanonicalGeometry(geometry, "US-9999")).toThrow("Missing canonical geometry");
  });

  it("retries after a failed response instead of caching a false no-match result", async () => {
    const fetchGeometry = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response("Unavailable", { status: 503 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(park)));
    const load = createCanonicalGeometryLoader("/park.geojson", { fetchGeometry });

    await expect(load()).rejects.toThrow("could not load");
    expect((await load()).has("US-0513")).toBe(true);
    expect(fetchGeometry).toHaveBeenCalledTimes(2);
  });

  it.each([
    {
      name: "a detail response for the wrong park",
      expectedReferences: ["US-0513"],
      firstResponse: {
        ...park,
        features: [{ ...park.features[0], properties: { potaReference: "US-0514" } }],
      },
    },
    {
      name: "an incomplete statewide response",
      expectedReferences: ["US-0513", "US-0514"],
      firstResponse: park,
    },
  ])("refetches $name and classifies successfully after retry", async ({ expectedReferences, firstResponse }) => {
    const completeResponse = {
      ...park,
      features: [
        ...park.features,
        { ...park.features[0], properties: { potaReference: "US-0514" } },
      ],
    };
    const fetchGeometry = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(JSON.stringify(firstResponse)))
      .mockResolvedValueOnce(new Response(JSON.stringify(completeResponse)));
    const load = createCanonicalGeometryLoader("/park.geojson", { expectedReferences, fetchGeometry });
    const onReady = vi.fn();
    const onError = vi.fn();
    const request = createGeometryClassificationRequest({
      load,
      onReady,
      onError,
      onLoading: vi.fn(),
    });
    const location = { latitude: 41, longitude: -71, accuracy: 10 };
    request.request(location);
    await vi.waitFor(() => expect(onError).toHaveBeenCalledOnce());
    expect(onReady).not.toHaveBeenCalled();

    request.request(location);
    await vi.waitFor(() => expect(onReady).toHaveBeenCalledOnce());
    expect(fetchGeometry).toHaveBeenCalledTimes(2);
    const geometry = await load();
    for (const reference of expectedReferences) expect(geometry.has(reference)).toBe(true);
    expect(fetchGeometry).toHaveBeenCalledTimes(2);
  });

  it.each([
    {},
    { type: "FeatureCollection", features: [] },
    { ...park, features: [{ ...park.features[0], properties: {} }] },
    { ...park, features: [{ ...park.features[0], geometry: null }] },
    { ...park, features: [{ ...park.features[0], geometry: { type: "Point", coordinates: [null, 41] } }] },
    { ...park, features: [{ ...park.features[0], geometry: { type: "Polygon", coordinates: [[[0, 0], [0, 1], [1, 1]]] } }] },
    { ...park, features: [{ ...park.features[0], geometry: { type: "Polygon", coordinates: [[[0, 0], [0, 1], [1, 1], [1, 0]]] } }] },
  ])("rejects an invalid canonical response before it can classify a position: %j", async (body) => {
    const load = createCanonicalGeometryLoader("/park.geojson", {
      fetchGeometry: vi.fn<typeof fetch>()
        .mockResolvedValue(new Response(JSON.stringify(body))),
    });
    await expect(load()).rejects.toThrow("Invalid canonical");
  });

  it.each([
    { ...park, properties: { fidelity: "web" } },
    { ...park, $schema: "https://ripota.org/schemas/web/v1/display-geojson.schema.json" },
    { ...park, features: [{ ...park.features[0], properties: { potaReference: "US-0513", fidelity: "web" } }] },
  ])("rejects an accidentally served web artifact before grouping away its metadata: %j", async (body) => {
    const load = createCanonicalGeometryLoader("/park.geojson", {
      fetchGeometry: vi.fn<typeof fetch>()
        .mockResolvedValue(new Response(JSON.stringify(body))),
    });
    await expect(load()).rejects.toThrow("Web geometry cannot be used");
  });
});

describe("asynchronous location classification requests", () => {
  const firstLocation = { latitude: 41, longitude: -71, accuracy: 10 };
  const nextLocation = { latitude: 42, longitude: -71, accuracy: 10 };

  it("publishes only the latest fix after loading and uses cached geometry for later fixes", async () => {
    const response = deferred<string>();
    const load = vi.fn().mockReturnValue(response.promise);
    const onReady = vi.fn();
    const onLoading = vi.fn();
    const request = createGeometryClassificationRequest({
      load, onReady, onLoading, onError: vi.fn(),
    });
    request.request(firstLocation);
    request.request(nextLocation);
    expect(onReady).not.toHaveBeenCalled();
    expect(onLoading).toHaveBeenCalledTimes(2);
    response.resolve("canonical");
    await response.promise;
    expect(onReady).toHaveBeenCalledExactlyOnceWith("canonical", nextLocation);

    request.request(firstLocation);
    expect(onReady).toHaveBeenLastCalledWith("canonical", firstLocation);
    expect(load).toHaveBeenCalledTimes(2);
  });

  it.each(["success", "failure"])("ignores a pending %s after the session stops", async (outcome) => {
    const response = deferred<string>();
    const onReady = vi.fn();
    const onError = vi.fn();
    const request = createGeometryClassificationRequest({
      load: () => response.promise,
      onReady,
      onLoading: vi.fn(),
      onError,
    });
    request.request(firstLocation);
    request.invalidate();
    if (outcome === "success") response.resolve("canonical");
    else response.reject(new Error("network failure"));
    await response.promise.catch(() => {});
    expect(onReady).not.toHaveBeenCalled();
    expect(onError).not.toHaveBeenCalled();
  });

  it("reports a load failure without classification and allows a later retry", async () => {
    const load = vi.fn()
      .mockRejectedValueOnce(new Error("network failure"))
      .mockResolvedValueOnce("canonical");
    const onReady = vi.fn();
    const onError = vi.fn();
    const request = createGeometryClassificationRequest({
      load, onReady, onLoading: vi.fn(), onError,
    });
    request.request(firstLocation);
    await Promise.resolve();
    expect(onError).toHaveBeenCalledOnce();
    expect(onReady).not.toHaveBeenCalled();
    request.request(nextLocation);
    await Promise.resolve();
    expect(onReady).toHaveBeenCalledExactlyOnceWith("canonical", nextLocation);
  });
});
