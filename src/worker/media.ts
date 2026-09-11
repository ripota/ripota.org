import type { ActivatorMedia } from "../lib/activate-ri/media";
import type { Env } from "./env";

export type MediaRow = {
  id: string;
  event_id: string;
  activator_id: string;
  object_key: string;
  filename: string;
  content_type: string;
  kind: "photo" | "video";
  size: number;
  state: "uploading" | "ready" | "deleting";
  created_at: string;
  updated_at: string;
  primary_callsign: string;
  park_reference: string | null;
};

export function serializeMedia(row: MediaRow, audience: "activator" | "admin"): ActivatorMedia {
  return {
    id: row.id,
    filename: row.filename,
    contentType: row.content_type,
    kind: row.kind,
    size: row.size,
    createdAt: row.created_at,
    callsign: row.primary_callsign,
    parkReference: row.park_reference,
    url: `/api/activate-ri-2026/${audience}/media/${row.id}/file`,
  };
}

export class MediaUploadError extends Error {}

// Check the file's container signature, not just the browser's MIME declaration.
// This is not codec validation or transcoding; originals remain downloadable.
export function matchesMediaSignature(bytes: Uint8Array, type: string): boolean {
  const text = (start: number, length: number) => String.fromCharCode(...bytes.subarray(start, start + length));
  const starts = (...signature: number[]) => signature.every((value, index) => bytes[index] === value);
  switch (type) {
    case "image/jpeg": return bytes.length >= 4 && starts(0xff, 0xd8, 0xff);
    case "image/png": return bytes.length >= 24 && starts(137, 80, 78, 71, 13, 10, 26, 10) && text(12, 4) === "IHDR";
    case "image/gif": return bytes.length >= 13 && ["GIF87a", "GIF89a"].includes(text(0, 6));
    case "image/webp": return bytes.length >= 16 && text(0, 4) === "RIFF" && text(8, 4) === "WEBP" && ["VP8 ", "VP8L", "VP8X"].includes(text(12, 4));
    case "video/webm": return starts(0x1a, 0x45, 0xdf, 0xa3) && bytes.some((_, index) =>
      bytes[index] === 0x42 && bytes[index + 1] === 0x82 && bytes[index + 2] === 0x84 && text(index + 3, 4) === "webm");
  }
  if (bytes.length < 16 || text(4, 4) !== "ftyp") return false;
  const size = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(0);
  if (size < 16 || size > bytes.length || size % 4 !== 0) return false;
  const brands = [text(8, 4)];
  for (let offset = 16; offset < size; offset += 4) brands.push(text(offset, 4));
  const has = (...allowed: string[]) => allowed.some((brand) => brands.includes(brand));
  const avif = has("avif", "avis");
  const heic = has("heic", "heix", "hevc", "hevx");
  const heif = heic || has("mif1", "msf1");
  if (type === "image/avif") return avif;
  if (type === "image/heic") return !avif && heic;
  if (type === "image/heif") return !avif && heif;
  if (avif || heif) return false;
  if (type === "video/quicktime") return has("qt  ");
  return type === "video/mp4" && !has("M4A ", "M4B ", "M4P ") && has("isom", "iso2", "iso4", "iso5", "iso6", "mp41", "mp42", "avc1", "M4V ", "MSNV", "dash");
}

export async function storeMediaStream(
  bucket: R2Bucket,
  key: string,
  body: ReadableStream<Uint8Array>,
  size: number,
  contentType: string,
): Promise<void> {
  const prefix = new Uint8Array(Math.min(size, 4096));
  let inspected = 0;
  let received = 0;
  let validated = false;
  const validator = new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      received += chunk.byteLength;
      if (received > size) throw new MediaUploadError("The file size changed during upload. Please try again.");
      if (!validated) {
        const part = chunk.subarray(0, prefix.length - inspected);
        prefix.set(part, inspected);
        inspected += part.length;
        if (inspected === prefix.length) {
          if (!matchesMediaSignature(prefix, contentType)) throw new MediaUploadError("The file contents do not match a supported photo or video format.");
          validated = true;
        }
      }
      controller.enqueue(chunk);
    },
    flush() {
      if (received !== size) throw new MediaUploadError("The upload was incomplete. Please try again.");
    },
  });
  // R2 requires a stream of known length. A normal TransformStream loses that
  // property, so retain backpressure and restore it with FixedLengthStream.
  const fixed = new FixedLengthStream(size);
  const abort = new AbortController();
  const pumping = body.pipeThrough(validator).pipeTo(fixed.writable, { signal: abort.signal });
  const storing = bucket.put(key, fixed.readable, { httpMetadata: { contentType } })
    .catch((error: unknown) => { abort.abort(error); throw error; });
  const results = await Promise.allSettled([pumping, storing]);
  for (const result of results) {
    if (result.status === "rejected" && result.reason instanceof MediaUploadError) throw result.reason;
  }
  for (const result of results) {
    if (result.status === "rejected") throw result.reason;
  }
}

export async function removeMediaObject(env: Env, row: Pick<MediaRow, "id" | "object_key">): Promise<void> {
  if (!env.ACTIVATOR_MEDIA) throw new Error("Media storage unavailable");
  await env.ACTIVATOR_MEDIA.delete(row.object_key);
  await env.DB.prepare("DELETE FROM activate_ri_media WHERE event_id = ? AND id = ? AND state != 'ready'")
    .bind(env.ACTIVATE_RI_EVENT_ID, row.id).run();
}

export async function cleanupMediaUploads(env: Env, now = new Date()): Promise<number> {
  if (!env.ACTIVATOR_MEDIA || env.REMOTE_DATA_READ_ONLY === "true") return 0;
  const cutoff = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
  const rows = await env.DB.prepare(
    `SELECT id, object_key FROM activate_ri_media
     WHERE event_id = ? AND state != 'ready' AND updated_at < ? LIMIT 50`,
  ).bind(env.ACTIVATE_RI_EVENT_ID, cutoff).all<Pick<MediaRow, "id" | "object_key">>();
  let removed = 0;
  for (const row of rows.results) {
    const claimed = await env.DB.prepare(`UPDATE activate_ri_media SET state = 'deleting'
      WHERE event_id = ? AND id = ? AND state != 'ready' AND updated_at < ?`)
      .bind(env.ACTIVATE_RI_EVENT_ID, row.id, cutoff).run();
    if (claimed.meta.changes !== 1) continue;
    await removeMediaObject(env, row);
    removed++;
  }
  return removed;
}
