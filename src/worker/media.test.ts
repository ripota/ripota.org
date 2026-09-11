import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { matchesMediaSignature, MediaUploadError, serializeMedia, storeMediaStream, type MediaAuthor, type MediaRow } from "./media";

// Node lacks the Workers primitive. Keep exact byte-count enforcement so these
// tests exercise both the upload validator and the known-length stream contract.
class TestFixedLengthStream extends TransformStream<Uint8Array, Uint8Array> {
  constructor(size: number) {
    let received = 0;
    super({
      transform(chunk, controller) {
        received += chunk.byteLength;
        if (received > size) throw new Error("Fixed stream overflow");
        controller.enqueue(chunk);
      },
      flush() {
        if (received !== size) throw new Error("Fixed stream underflow");
      },
    });
  }
}

beforeEach(() => vi.stubGlobal("FixedLengthStream", TestFixedLengthStream));
afterEach(() => vi.unstubAllGlobals());

function bytes(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

function ftyp(brand: string, ...compatible: string[]): Uint8Array {
  const result = new Uint8Array(16 + compatible.length * 4);
  new DataView(result.buffer).setUint32(0, result.length);
  result.set(bytes(`ftyp${brand}`), 4);
  compatible.forEach((value, index) => result.set(bytes(value), 16 + index * 4));
  return result;
}

describe("media container validation", () => {
  it.each([
    [new Uint8Array([0xff, 0xd8, 0xff, 0xe0]), "image/jpeg"],
    [new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, ...bytes("IHDR"), 0, 0, 0, 1, 0, 0, 0, 1]), "image/png"],
    [bytes("GIF89a\x01\x00\x01\x00\x00\x00\x00"), "image/gif"],
    [bytes("RIFF\x10\x00\x00\x00WEBPVP8 "), "image/webp"],
    [ftyp("heic", "mif1"), "image/heic"], [ftyp("mif1"), "image/heif"],
    [ftyp("avif", "mif1"), "image/avif"], [ftyp("isom", "mp42"), "video/mp4"],
    [ftyp("qt  "), "video/quicktime"],
    [new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, 0x42, 0x82, 0x84, ...bytes("webm")]), "video/webm"],
  ])("recognizes a supported %s container as %s", (value, type) => {
    expect(matchesMediaSignature(value, type)).toBe(true);
    expect(matchesMediaSignature(bytes("<html><script>alert(1)</script></html>"), type)).toBe(false);
  });

  it("separates image and audio containers from MP4 video", () => {
    expect(matchesMediaSignature(ftyp("avif", "isom"), "video/mp4")).toBe(false);
    expect(matchesMediaSignature(ftyp("heic", "isom"), "video/mp4")).toBe(false);
    expect(matchesMediaSignature(ftyp("M4A ", "isom"), "video/mp4")).toBe(false);
    expect(matchesMediaSignature(ftyp("avif", "mif1"), "image/heif")).toBe(false);
  });

  it("rejects truncated signatures and malformed ISO container sizes", () => {
    expect(matchesMediaSignature(new Uint8Array([0xff, 0xd8, 0xff]), "image/jpeg")).toBe(false);
    expect(matchesMediaSignature(bytes("GIF89a"), "image/gif")).toBe(false);
    const value = ftyp("isom");
    new DataView(value.buffer).setUint32(0, 4096);
    expect(matchesMediaSignature(value, "video/mp4")).toBe(false);
  });
});

describe("bounded media streaming", () => {
  const photo = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, ...new Uint8Array(8192)]);

  function stream(chunks: Uint8Array[]): ReadableStream<Uint8Array> {
    return new ReadableStream({
      start(controller) {
        chunks.forEach((chunk) => controller.enqueue(chunk));
        controller.close();
      },
    });
  }

  function storage() {
    let stored: Uint8Array | undefined;
    const put = vi.fn(async (_key: string, body: ReadableStream) => {
      stored = new Uint8Array(await new Response(body).arrayBuffer());
      return {} as R2Object;
    });
    return { bucket: { put } as unknown as R2Bucket, put, contents: () => stored };
  }

  it("preserves bytes and validates a signature split across tiny chunks", async () => {
    const bucket = storage();
    await storeMediaStream(bucket.bucket, "private/photo", stream([
      photo.subarray(0, 1), photo.subarray(1, 2), photo.subarray(2, 700), photo.subarray(700),
    ]), photo.length, "image/jpeg");
    expect(bucket.contents()).toEqual(photo);
    expect(bucket.put).toHaveBeenCalledWith("private/photo", expect.any(ReadableStream), {
      httpMetadata: { contentType: "image/jpeg" },
    });
  });

  it.each([photo.length - 1, photo.length + 1])("rejects mismatched declared length %s without committing an object", async (declared) => {
    const bucket = storage();
    await expect(storeMediaStream(bucket.bucket, "private/photo", stream([photo]), declared, "image/jpeg"))
      .rejects.toBeInstanceOf(MediaUploadError);
    expect(bucket.contents()).toBeUndefined();
  });

  it("rejects a spoofed MIME type after inspecting content", async () => {
    const bucket = storage();
    await expect(storeMediaStream(bucket.bucket, "private/photo", stream([photo]), photo.length, "image/png"))
      .rejects.toThrow("contents do not match");
    expect(bucket.contents()).toBeUndefined();
  });

  it("propagates an interrupted request without committing a partial file", async () => {
    const bucket = storage();
    const interrupted = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(photo.subarray(0, 400));
        controller.error(new Error("Connection lost"));
      },
    });
    await expect(storeMediaStream(bucket.bucket, "private/photo", interrupted, photo.length, "image/jpeg"))
      .rejects.toThrow("Connection lost");
    expect(bucket.contents()).toBeUndefined();
  });

  it("cancels the input when R2 rejects before consuming the stream", async () => {
    const cancel = vi.fn();
    const input = new ReadableStream<Uint8Array>({
      pull(controller) { controller.enqueue(photo.subarray(0, 1)); },
      cancel,
    });
    const bucket = { put: vi.fn(async () => { throw new Error("R2 unavailable"); }) } as unknown as R2Bucket;
    await expect(storeMediaStream(bucket, "private/photo", input, photo.length, "image/jpeg"))
      .rejects.toThrow("R2 unavailable");
    expect(cancel).toHaveBeenCalled();
  });
});

it("serializes only display metadata and an authenticated content URL", () => {
  const row: MediaRow & MediaAuthor = {
    id: "media-id", event_id: "activate-ri-2026", activator_id: "private-owner-id",
    object_key: "private/r2/key", filename: "photo.jpg", content_type: "image/jpeg",
    kind: "photo", size: 42, state: "ready", created_at: "2026-09-12T12:00:00.000Z",
    updated_at: "2026-09-12T12:01:00.000Z", primary_callsign: "N1RI", park_reference: null,
    activator_name: "Rob Jackson", chat_display_name: null,
    title: null, description: null, usage_notice_version: "ri-pota-media-v1",
  };
  for (const audience of ["activator", "admin"] as const) {
    const serialized = serializeMedia(row, audience);
    expect(serialized.url).toBe(`/api/activate-ri-2026/${audience}/media/media-id/file`);
    expect(serialized).not.toHaveProperty("object_key");
    expect(serialized).not.toHaveProperty("activator_id");
    expect(serialized).not.toHaveProperty("state");
    expect(serialized).not.toHaveProperty("activator_name");
    expect(serialized).not.toHaveProperty("chat_display_name");
    expect(serialized.authorLabel).toBe("N1RI - Rob");
    expect(JSON.stringify(serialized)).not.toContain("Jackson");
    expect(serialized.canEdit).toBe(audience === "admin");
  }
  expect(serializeMedia(row, "activator", row.activator_id).canEdit).toBe(true);
  expect(serializeMedia(row, "activator", "another-activator").canEdit).toBe(false);
  expect(serializeMedia({ ...row, chat_display_name: "Rob J." }, "activator").authorLabel).toBe("N1RI - Rob J.");
  expect(serializeMedia({ ...row, chat_display_name: "" }, "activator").authorLabel).toBe("N1RI");
});
