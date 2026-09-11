import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Env } from "./env";
import type { MediaRow } from "./media";
import { mediaThumbnailKey, servePublicMediaThumbnail } from "./media-thumbnails";

const original = new TextEncoder().encode("original photo with EXIF GPS and capture time");
const preview = new TextEncoder().encode("RIFF\x10\0\0\0WEBPVP8 thumbnail");
const row: MediaRow = {
  id: "photo-id", event_id: "activate-ri-2026", activator_id: "owner-id",
  object_key: "activator-media/activate-ri-2026/photo-id", filename: "private-name.jpg",
  content_type: "image/jpeg", kind: "photo", size: original.length, state: "ready",
  created_at: "2026-09-11T12:00:00.000Z", updated_at: "2026-09-11T12:00:00.000Z",
  park_reference: null, title: null, description: null, usage_notice_version: "ri-pota-media-v1",
};
const key = mediaThumbnailKey(row.object_key);
type Stored = { bytes: Uint8Array<ArrayBuffer>; metadata: Record<string, string>; etag: string };

function fixture() {
  const objects = new Map<string, Stored>([[row.object_key, { bytes: original, metadata: {}, etag: "source" }]]);
  let ready = true;
  let writeHook: (() => void) | undefined;
  let decoded: Uint8Array | undefined;
  const get = vi.fn(async (objectKey: string) => {
    const object = objects.get(objectKey);
    return object ? {
      body: new Response(object.bytes.slice()).body, size: object.bytes.length,
      customMetadata: object.metadata, etag: object.etag, httpEtag: `"${object.etag}"`,
    } as R2ObjectBody : null;
  });
  const put = vi.fn(async (objectKey: string, bytes: Uint8Array<ArrayBuffer>, options: R2PutOptions) => {
    const current = objects.get(objectKey);
    const condition = options.onlyIf as R2Conditional | undefined;
    if (condition?.etagDoesNotMatch === "*" && current) return null;
    if (condition?.etagMatches && current?.etag !== condition.etagMatches) return null;
    objects.set(objectKey, { bytes: bytes.slice(), metadata: options.customMetadata ?? {}, etag: "saved" });
    writeHook?.();
    return { httpEtag: '"saved"' } as R2Object;
  });
  const remove = vi.fn(async (objectKey: string) => { objects.delete(objectKey); });
  const output = vi.fn(async (_options: ImageOutputOptions) => ({ image: () => new Response(preview.slice()).body! }));
  const transform = vi.fn((_options: ImageTransform) => ({ output }));
  const input = vi.fn((source: ReadableStream) => ({ transform: (options: ImageTransform) => {
    const handle = transform(options);
    return { output: async (options: ImageOutputOptions) => {
      decoded = new Uint8Array(await new Response(source).arrayBuffer());
      return handle.output(options);
    } };
  } }));
  const env = {
    ACTIVATE_RI_EVENT_ID: row.event_id,
    DB: { prepare: () => ({ bind: () => ({ first: async () => ready ? { id: row.id } : null }) }) },
    ACTIVATOR_MEDIA: { get, put, delete: remove },
    IMAGES: { input },
  } as unknown as Env;
  return { env, objects, get, put, remove, input, transform, output,
    decoded: () => decoded, setReady: (value: boolean) => { ready = value; },
    onWrite: (callback: () => void) => { writeHook = callback; },
  };
}

const request = (method = "GET") => new Request("https://ripota.org/api/activate-ri-2026/public/media/photo-id/thumbnail", { method });
beforeEach(() => vi.spyOn(console, "error").mockImplementation(() => undefined));
afterEach(() => vi.restoreAllMocks());

describe("stored photo thumbnails", () => {
  it("decodes once, retains original bytes, and reuses the small derivative", async () => {
    const f = fixture();
    const first = await servePublicMediaThumbnail(request(), f.env, row);
    expect(first.status).toBe(200);
    expect(new Uint8Array(await first.arrayBuffer())).toEqual(preview);
    expect(f.decoded()).toEqual(original);
    expect(f.objects.get(row.object_key)?.bytes).toEqual(original);
    expect(f.transform).toHaveBeenCalledWith({ width: 640, height: 640, fit: "scale-down" });
    expect(f.output).toHaveBeenCalledWith({ format: "image/webp", quality: 75, anim: false });
    expect(first.headers.get("cache-control")).toBe("no-store");
    expect(first.headers.get("content-type")).toBe("image/webp");
    expect(first.headers.get("content-length")).toBe(String(preview.length));
    expect(first.headers.get("x-robots-tag")).toBeNull();
    const next = await servePublicMediaThumbnail(request(), f.env, row);
    expect(new Uint8Array(await next.arrayBuffer())).toEqual(preview);
    expect(f.input).toHaveBeenCalledTimes(1);
    expect(f.put).toHaveBeenCalledTimes(1);
    const head = await servePublicMediaThumbnail(request("HEAD"), f.env, row);
    expect(head.status).toBe(200);
    expect(await head.text()).toBe("");
    expect(head.headers.get("content-length")).toBe(String(preview.length));
  });

  it.each([
    { ...row, event_id: "another-event" }, { ...row, state: "deleting" as const },
    { ...row, state: "uploading" as const }, { ...row, kind: "video" as const },
  ])("never reads storage for a file outside the visible photo set", async (inputRow) => {
    const f = fixture();
    expect((await servePublicMediaThumbnail(request(), f.env, inputRow)).status).toBe(404);
    expect(f.get).not.toHaveBeenCalled();
    expect(f.input).not.toHaveBeenCalled();
  });

  it("does not substitute an original when transformation is unavailable", async () => {
    const f = fixture();
    delete f.env.IMAGES;
    expect((await servePublicMediaThumbnail(request(), f.env, row)).status).toBe(503);
    expect(f.get).not.toHaveBeenCalledWith(row.object_key);
    expect(f.put).not.toHaveBeenCalled();
  });

  it("reads existing thumbnails but cannot generate or write in remote-data local mode", async () => {
    const f = fixture();
    f.env.REMOTE_DATA_READ_ONLY = "true";
    expect((await servePublicMediaThumbnail(request(), f.env, row)).status).toBe(503);
    expect(f.input).not.toHaveBeenCalled();
    expect(f.put).not.toHaveBeenCalled();
    f.objects.set(key, { bytes: preview, metadata: { status: "ready" }, etag: "saved" });
    expect((await servePublicMediaThumbnail(request(), f.env, row)).status).toBe(200);
  });

  it("backs off unsupported input instead of decoding it for every visitor", async () => {
    const f = fixture();
    f.output.mockRejectedValue(new Error("Unsupported image"));
    const failed = await servePublicMediaThumbnail(request(), f.env, row);
    expect(failed.status).toBe(503);
    expect(failed.headers.get("retry-after")).toBe("900");
    expect(await failed.text()).not.toContain("EXIF");
    expect((await servePublicMediaThumbnail(request(), f.env, row)).status).toBe(503);
    expect(f.input).toHaveBeenCalledTimes(1);
    f.objects.get(key)!.metadata.retryAt = "0";
    f.output.mockResolvedValue({ image: () => new Response(preview.slice()).body! });
    expect((await servePublicMediaThumbnail(request(), f.env, row)).status).toBe(200);
    expect(f.input).toHaveBeenCalledTimes(2);
    expect(f.objects.get(row.object_key)?.bytes).toEqual(original);
  });

  it("cannot leave a derivative behind if deletion finishes during decoding", async () => {
    const f = fixture();
    f.output.mockImplementation(async () => {
      f.setReady(false);
      return { image: () => new Response(preview.slice()).body! };
    });
    expect((await servePublicMediaThumbnail(request(), f.env, row)).status).toBe(404);
    expect(f.put).not.toHaveBeenCalled();
    expect(f.objects.has(key)).toBe(false);
  });

  it("removes a late thumbnail or failure marker when deletion races the write", async () => {
    for (const failing of [false, true]) {
      const f = fixture();
      if (failing) f.output.mockRejectedValue(new Error("Unsupported image"));
      f.onWrite(() => f.setReady(false));
      expect((await servePublicMediaThumbnail(request(), f.env, row)).status).toBe(404);
      expect(f.objects.has(key)).toBe(false);
      expect(f.remove).toHaveBeenCalledWith(key);
    }
  });

  it("does not overwrite a concurrent successful thumbnail with a failure marker", async () => {
    const f = fixture();
    f.output.mockImplementation(async () => {
      f.objects.set(key, { bytes: preview, metadata: { status: "ready" }, etag: "other-success" });
      throw new Error("Failed concurrent request");
    });
    expect((await servePublicMediaThumbnail(request(), f.env, row)).status).toBe(503);
    expect(f.objects.get(key)?.bytes).toEqual(preview);
    expect(f.objects.get(key)?.metadata.status).toBe("ready");
  });

  it("rejects invalid or oversized transform output without storing it as an image", async () => {
    for (const bytes of [new TextEncoder().encode("not a preview"), new Uint8Array(2 * 1024 * 1024 + 1)]) {
      const f = fixture();
      f.output.mockResolvedValue({ image: () => new Response(bytes).body! });
      expect((await servePublicMediaThumbnail(request(), f.env, row)).status).toBe(503);
      expect(f.objects.get(key)?.metadata.status).toBe("failed");
      expect(f.objects.get(row.object_key)?.bytes).toEqual(original);
    }
  });
});
