import { mediaContentType, mediaLimits, validateMediaFile } from "../../lib/activate-ri/media";
import { requireActivator, requireAdmin, type ActivatorIdentity } from "../auth/authorization";
import type { Env } from "../env";
import { json } from "../http";
import { logWorkerError } from "../logging";
import { MediaUploadError, removeMediaObject, serializeMedia, storeMediaStream, type MediaRow } from "../media";
import { hasTrustedOrigin } from "../origin";
import { withPrivateHeaders } from "../private-response";

const routePattern = /^\/api\/activate-ri-2026\/(activator|admin)\/media(?:\/([a-f0-9-]{36})(\/file)?)?$/;
const mediaSelect = `SELECT m.*, a.primary_callsign FROM activate_ri_media m
  INNER JOIN activate_ri_activators a ON a.id = m.activator_id AND a.event_id = m.event_id`;

export async function handleActivateRiMediaApi(request: Request, env: Env): Promise<Response> {
  try {
    return withPrivateHeaders(await handleMedia(request, env));
  } catch (error) {
    logWorkerError("activator-media-request-failed", error);
    return withPrivateHeaders(json({ ok: false, error: "Unable to access photos and videos. Please try again." }, { status: 503 }));
  }
}

async function handleMedia(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const match = url.pathname.match(routePattern);
  if (!match) return failure("Not found", 404);
  const audience = match[1] as "activator" | "admin";
  const identity = audience === "admin" ? await requireAdmin(request, env) : await requireActivator(request, env);
  if (identity instanceof Response) return identity;
  const owner = "activatorId" in identity ? identity : null;
  if (!["GET", "HEAD"].includes(request.method)) {
    if (env.REMOTE_DATA_READ_ONLY === "true") return failure("Remote production data is read-only in local development.", 403);
    if (!hasTrustedOrigin(request, env)) return failure("Forbidden", 403);
  }
  if (!env.ACTIVATOR_MEDIA) return failure("Photo and video storage is not available yet. Please try again later.", 503);

  const id = match[2];
  const file = Boolean(match[3]);
  if (!id && request.method === "GET") {
    if (owner) {
      const result = await env.DB.prepare(`${mediaSelect}
        WHERE m.event_id = ? AND m.activator_id = ? AND m.state = 'ready'
        ORDER BY m.created_at DESC, m.id DESC`).bind(env.ACTIVATE_RI_EVENT_ID, owner.activatorId).all<MediaRow>();
      const usage = await env.DB.prepare(`SELECT COUNT(*) AS files, COALESCE(SUM(size), 0) AS bytes
        FROM activate_ri_media WHERE event_id = ? AND activator_id = ?`)
        .bind(env.ACTIVATE_RI_EVENT_ID, owner.activatorId).first<{ files: number; bytes: number }>();
      return json({ ok: true, media: result.results.map((row) => serializeMedia(row, audience)), usage, limits: mediaLimits });
    }
    const cursor = url.searchParams.get("cursor");
    if (cursor && !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z\|[a-f0-9-]{36}$/.test(cursor)) return failure("Invalid gallery cursor.", 400);
    const [createdAt, cursorId] = cursor?.split("|") ?? [null, null];
    const result = await env.DB.prepare(`${mediaSelect}
      WHERE m.event_id = ? AND m.state = 'ready'
        AND (? IS NULL OR m.created_at < ? OR (m.created_at = ? AND m.id < ?))
      ORDER BY m.created_at DESC, m.id DESC LIMIT 51`)
      .bind(env.ACTIVATE_RI_EVENT_ID, createdAt, createdAt, createdAt, cursorId).all<MediaRow>();
    const rows = result.results.slice(0, 50);
    const last = rows.at(-1);
    return json({ ok: true, media: rows.map((row) => serializeMedia(row, audience)), nextCursor: result.results.length > 50 && last ? `${last.created_at}|${last.id}` : null });
  }
  if (!id && request.method === "POST" && owner) return uploadMedia(request, env, owner);
  if (!id) return failure("Method not allowed", 405);
  const row = await env.DB.prepare(`${mediaSelect}
    WHERE m.event_id = ? AND m.id = ? AND (? IS NULL OR m.activator_id = ?)`)
    .bind(env.ACTIVATE_RI_EVENT_ID, id, owner?.activatorId ?? null, owner?.activatorId ?? null).first<MediaRow>();
  if (!row || row.state === "uploading") return failure("Photo or video not found.", 404);
  if (file && ["GET", "HEAD"].includes(request.method) && row.state === "ready") return serveMedia(request, env.ACTIVATOR_MEDIA, row);
  if (!file && request.method === "DELETE") {
    await env.DB.prepare("UPDATE activate_ri_media SET state = 'deleting', updated_at = ? WHERE event_id = ? AND id = ?")
      .bind(new Date().toISOString(), env.ACTIVATE_RI_EVENT_ID, row.id).run();
    await removeMediaObject(env, row);
    return json({ ok: true });
  }
  return failure(row.state === "deleting" ? "Photo or video not found." : "Method not allowed", row.state === "deleting" ? 404 : 405);
}

async function uploadMedia(request: Request, env: Env, owner: ActivatorIdentity): Promise<Response> {
  if (owner.status === "rejected") return failure("This registration cannot upload photos or videos. Contact an organizer.", 403);
  if (env.MEDIA_UPLOAD_RATE_LIMIT) {
    const allowed = await env.MEDIA_UPLOAD_RATE_LIMIT.limit({ key: `${env.ACTIVATE_RI_EVENT_ID}:${owner.activatorId}` });
    if (!allowed.success) return json({ ok: false, error: "Please wait a minute before uploading more files." }, { status: 429, headers: { "retry-after": "60" } });
  }
  const length = request.headers.get("content-length");
  if (!length) return failure("A file size is required for uploads.", 411);
  if (!/^\d+$/.test(length)) return failure("Invalid file size.", 400);
  const size = Number(length);
  let filename: string;
  try { filename = decodeURIComponent(request.headers.get("x-media-filename") ?? ""); }
  catch { return failure("Invalid filename.", 400); }
  const contentType = mediaContentType(filename, request.headers.get("content-type") ?? "");
  const validation = validateMediaFile({ name: filename, type: contentType, size });
  if (validation) return failure(validation, size > (contentType.startsWith("image/") ? mediaLimits.photoBytes : mediaLimits.videoBytes) ? 413 : 400);
  if (!request.body) return failure("Choose a file that is not empty.", 400);

  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  // Keys deliberately contain neither the activator ID (which may contain an
  // email address) nor the original filename. All access goes through auth.
  const row: MediaRow = {
    id, event_id: env.ACTIVATE_RI_EVENT_ID, activator_id: owner.activatorId,
    object_key: `activator-media/${env.ACTIVATE_RI_EVENT_ID}/${id}`,
    filename, content_type: contentType, kind: contentType.startsWith("image/") ? "photo" : "video",
    size, state: "uploading", created_at: now, updated_at: now, primary_callsign: owner.callsign,
  };
  // A single SQL statement reserves both limits, including in-flight uploads,
  // so parallel requests cannot each pass an outdated quota check.
  const reserved = await env.DB.prepare(`INSERT INTO activate_ri_media
    (id, event_id, activator_id, object_key, filename, content_type, kind, size, state, created_at, updated_at)
    SELECT ?, ?, ?, ?, ?, ?, ?, ?, 'uploading', ?, ?
    WHERE (SELECT COUNT(*) FROM activate_ri_media WHERE event_id = ? AND activator_id = ?) < ?
      AND (SELECT COALESCE(SUM(size), 0) FROM activate_ri_media WHERE event_id = ? AND activator_id = ?) + ? <= ?`)
    .bind(id, row.event_id, row.activator_id, row.object_key, filename, contentType, row.kind, size, now, now,
      row.event_id, row.activator_id, mediaLimits.files, row.event_id, row.activator_id, size, mediaLimits.totalBytes).run();
  if (reserved.meta.changes !== 1) return failure("Your gallery is full (50 files or 500 MB). Remove an upload before adding another.", 409);
  try {
    await storeMediaStream(env.ACTIVATOR_MEDIA!, row.object_key, request.body, size, contentType);
    const saved = await env.DB.prepare("UPDATE activate_ri_media SET state = 'ready', updated_at = ? WHERE event_id = ? AND id = ? AND state = 'uploading'")
      .bind(new Date().toISOString(), row.event_id, id).run();
    if (saved.meta.changes !== 1) throw new Error("Upload reservation unavailable");
    return json({ ok: true, media: serializeMedia(row, "activator") }, { status: 201 });
  } catch (error) {
    try {
      // If a D1 response was lost after finalization committed, preserve the
      // ready object. Otherwise claim the failed upload before deleting it.
      const abandoned = await env.DB.prepare("UPDATE activate_ri_media SET state = 'deleting', updated_at = ? WHERE event_id = ? AND id = ? AND state = 'uploading'")
        .bind(new Date().toISOString(), row.event_id, id).run();
      if (abandoned.meta.changes === 1) await removeMediaObject(env, row);
    }
    catch (cleanupError) { logWorkerError("activator-media-upload-cleanup-failed", cleanupError); }
    if (error instanceof MediaUploadError) return failure(error.message, 400);
    throw error;
  }
}

type ByteRange = { offset: number; length: number };

export function parseMediaRange(value: string, size: number): ByteRange | null {
  const match = /^bytes=(\d*)-(\d*)$/.exec(value);
  if (!match || (!match[1] && !match[2])) return null;
  if (!match[1]) {
    const suffix = Number(match[2]);
    if (!Number.isSafeInteger(suffix) || suffix <= 0) return null;
    const length = Math.min(suffix, size);
    return { offset: size - length, length };
  }
  const offset = Number(match[1]);
  const requestedEnd = match[2] ? Number(match[2]) : size - 1;
  if (!Number.isSafeInteger(offset) || !Number.isSafeInteger(requestedEnd) || offset >= size || requestedEnd < offset) return null;
  return { offset, length: Math.min(requestedEnd, size - 1) - offset + 1 };
}

async function serveMedia(request: Request, bucket: R2Bucket, row: MediaRow): Promise<Response> {
  const headers = new Headers({
    "content-type": row.content_type,
    "accept-ranges": "bytes",
    "content-disposition": `${new URL(request.url).searchParams.get("download") === "1" ? "attachment" : "inline"}; filename="upload.${row.filename.split(".").at(-1)?.toLowerCase()}"; filename*=UTF-8''${encodeURIComponent(row.filename).replace(/['()*]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`)}`,
    "cross-origin-resource-policy": "same-origin",
  });
  // If-Range is unsupported by R2. Sending the complete representation is the
  // safe HTTP fallback; never send partial bytes for an unchecked validator.
  const rangeHeader = request.method === "GET" && !request.headers.has("if-range") ? request.headers.get("range") : null;
  const range = rangeHeader ? parseMediaRange(rangeHeader, row.size) : undefined;
  if (range === null) {
    headers.set("content-range", `bytes */${row.size}`);
    return new Response(null, { status: 416, headers });
  }
  if (request.method === "HEAD") {
    const object = await bucket.head(row.object_key);
    if (!object) return failure("Photo or video not found.", 404);
    headers.set("content-length", String(object.size));
    headers.set("etag", object.httpEtag);
    return new Response(null, { headers });
  }
  const object = await bucket.get(row.object_key, range ? { range } : undefined);
  if (!object) return failure("Photo or video not found.", 404);
  headers.set("etag", object.httpEtag);
  if (range) {
    const actual = object.range;
    const offset = actual && "offset" in actual ? actual.offset ?? range.offset : range.offset;
    const length = actual && "length" in actual ? actual.length ?? range.length : range.length;
    headers.set("content-range", `bytes ${offset}-${offset + length - 1}/${object.size}`);
    headers.set("content-length", String(length));
  } else {
    headers.set("content-length", String(object.size));
  }
  return new Response(object.body, { status: range ? 206 : 200, headers });
}

function failure(error: string, status: number): Response {
  return json({ ok: false, error }, { status });
}
