import type { Env } from "./env";
import { logWorkerError } from "./logging";
import type { MediaRow } from "./media";

const maximumThumbnailBytes = 2 * 1024 * 1024;
const failureRetrySeconds = 15 * 60;

/** Version the fixed preset so future rendering changes never rewrite originals. */
export function mediaThumbnailKey(objectKey: string): string {
  return `${objectKey}/thumbnail-v1.webp`;
}

/** The caller authorizes public visibility before any thumbnail lookup. */
export async function servePublicMediaThumbnail(request: Request, env: Env, row: MediaRow): Promise<Response> {
  if (row.event_id !== env.ACTIVATE_RI_EVENT_ID || row.state !== "ready" || row.kind !== "photo") return missing();
  const bucket = env.ACTIVATOR_MEDIA;
  if (!bucket) return unavailable();
  const key = mediaThumbnailKey(row.object_key);
  const cached = await bucket.get(key);
  if (cached?.customMetadata?.status !== "failed" && cached) return thumbnailResponse(request, cached);
  const retryAt = Number(cached?.customMetadata?.retryAt ?? 0);
  if (cached) await cached.body.cancel();
  if (Number.isFinite(retryAt) && retryAt > Date.now()) {
    return unavailable(Math.ceil((retryAt - Date.now()) / 1000));
  }
  // A preview request must never mutate remote production storage in a local
  // development environment. Cached derivatives remain readable there.
  if (env.REMOTE_DATA_READ_ONLY === "true" || !env.IMAGES) return unavailable();

  try {
    const source = await bucket.get(row.object_key);
    if (!source) return missing();
    // R2's original stream goes directly to the decoder; only the small output
    // is buffered, with a hard limit independent of input dimensions or format.
    const output = await env.IMAGES.input(source.body)
      .transform({ width: 640, height: 640, fit: "scale-down" })
      .output({ format: "image/webp", quality: 75, anim: false });
    const bytes = await readBoundedThumbnail(output.image());
    if (!isWebP(bytes)) throw new Error("Image transform returned an invalid thumbnail");
    if (!await stillReady(env, row)) return missing();
    const saved = await bucket.put(key, bytes, {
      httpMetadata: { contentType: "image/webp" },
      customMetadata: { status: "ready" },
    });
    // DELETE can finish between the pre-write check and put. Remove the late
    // derivative so a deleted upload cannot leave an orphan behind.
    if (!await stillReady(env, row)) {
      await bucket.delete(key);
      return missing();
    }
    return new Response(request.method === "HEAD" ? null : bytes, {
      headers: thumbnailHeaders(bytes.byteLength, saved?.httpEtag),
    });
  } catch (error) {
    logWorkerError("media-thumbnail-failed", error, { mediaId: row.id });
    // Unsupported formats and transient transform failures should not trigger
    // another expensive decode for every gallery visitor. Conditional writes
    // prevent this marker from replacing a concurrent successful thumbnail.
    try {
      if (!await stillReady(env, row)) return missing();
      await bucket.put(key, new Uint8Array(), {
        httpMetadata: { contentType: "application/octet-stream" },
        customMetadata: { status: "failed", retryAt: String(Date.now() + failureRetrySeconds * 1000) },
        onlyIf: cached ? { etagMatches: cached.etag } : { etagDoesNotMatch: "*" },
      });
      if (!await stillReady(env, row)) {
        await bucket.delete(key);
        return missing();
      }
    } catch (cacheError) {
      logWorkerError("media-thumbnail-failure-cache-failed", cacheError, { mediaId: row.id });
    }
    return unavailable();
  }
}

async function stillReady(env: Env, row: MediaRow): Promise<boolean> {
  return Boolean(await env.DB.prepare(`SELECT id FROM activate_ri_media
    WHERE event_id = ? AND id = ? AND state = 'ready'`)
    .bind(env.ACTIVATE_RI_EVENT_ID, row.id).first<{ id: string }>());
}

async function thumbnailResponse(request: Request, object: R2ObjectBody): Promise<Response> {
  if (request.method === "HEAD") await object.body.cancel();
  return new Response(request.method === "HEAD" ? null : object.body, {
    headers: thumbnailHeaders(object.size, object.httpEtag),
  });
}

function thumbnailHeaders(size: number, etag?: string): Headers {
  const headers = new Headers({
    "content-type": "image/webp",
    "content-length": String(size),
    // R2 stores the reusable derivative. Each browser request still goes
    // through the live media row so a deletion takes effect on the next load.
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
    "cross-origin-resource-policy": "same-origin",
  });
  if (etag) headers.set("etag", etag);
  return headers;
}

function missing(): Response {
  return new Response("Photo not found.", { status: 404, headers: { "cache-control": "no-store", "x-content-type-options": "nosniff" } });
}

function unavailable(retryAfter = failureRetrySeconds): Response {
  return new Response("Preview unavailable. Open the photo to view the original.", {
    status: 503,
    headers: { "cache-control": "no-store", "retry-after": String(retryAfter), "x-content-type-options": "nosniff" },
  });
}

async function readBoundedThumbnail(stream: ReadableStream<Uint8Array>): Promise<Uint8Array<ArrayBuffer>> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > maximumThumbnailBytes) {
        await reader.cancel();
        throw new Error("Thumbnail exceeds the output size limit");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const output = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) { output.set(chunk, offset); offset += chunk.byteLength; }
  return output;
}

function isWebP(bytes: Uint8Array): boolean {
  const text = (start: number, size: number) => String.fromCharCode(...bytes.subarray(start, start + size));
  return bytes.length >= 16 && text(0, 4) === "RIFF" && text(8, 4) === "WEBP"
    && ["VP8 ", "VP8L", "VP8X"].includes(text(12, 4));
}
