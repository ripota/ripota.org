import { mediaUsageNoticeVersion, mediaContentType, mediaLimits, validateMediaFile } from "../../lib/activate-ri/media";
import { parseMediaMetadataPatch } from "../../lib/activate-ri/media-metadata";
import { validateMediaParkReference } from "../../lib/activate-ri/media-parks";
import { requireActivator, requireAdmin, type ActivatorIdentity } from "../auth/authorization";
import type { Env } from "../env";
import { json } from "../http";
import { logWorkerError } from "../logging";
import { MediaUploadError, removeMediaObject, serializeMedia, storeMediaStream, type MediaAuthor, type MediaRow } from "../media";
import { servePublicMediaThumbnail } from "../media-thumbnails";
import { hasTrustedOrigin } from "../origin";
import { withPrivateHeaders } from "../private-response";

const routePattern = /^\/api\/activate-ri-2026\/(activator|admin|public)\/media(?:\/([a-f0-9-]{36})(?:\/(file|thumbnail))?)?$/;
const cursorPattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z\|[a-f0-9-]{36}$/;
const mediaSelect = `SELECT m.*, a.primary_callsign, a.name AS activator_name, membership.chat_display_name
  FROM activate_ri_media m
  INNER JOIN activate_ri_activators a ON a.id = m.activator_id AND a.event_id = m.event_id
  LEFT JOIN activate_ri_ops_memberships membership ON membership.activator_id = a.id AND membership.event_id = a.event_id`;

export async function handleActivateRiMediaApi(request: Request, env: Env): Promise<Response> {
  const withHeaders = new URL(request.url).pathname.startsWith("/api/activate-ri-2026/public/media")
    ? withPublicMediaHeaders : withPrivateHeaders;
  try {
    return withHeaders(await handleMedia(request, env));
  } catch (error) {
    logWorkerError("activator-media-request-failed", error);
    return withHeaders(json({ ok: false, error: "Unable to access photos and videos. Please try again." }, { status: 503 }));
  }
}

async function handleMedia(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const match = url.pathname.match(routePattern);
  if (!match) return failure("Not found", 404);
  if (match[1] === "public") return handlePublicMedia(request, env, url, match[2], match[3]);
  const audience = match[1] as "activator" | "admin";
  const identity = audience === "admin" ? await requireAdmin(request, env) : await requireActivator(request, env);
  if (identity instanceof Response) return identity;
  const owner = "activatorId" in identity ? identity : null;
  const viewerActivator = owner ?? await requireActivator(request, env);
  const viewerActivatorId = viewerActivator instanceof Response ? null : viewerActivator.activatorId;
  if (!["GET", "HEAD"].includes(request.method)) {
    if (env.REMOTE_DATA_READ_ONLY === "true") return failure("Remote production data is read-only in local development.", 403);
    if (!hasTrustedOrigin(request, env)) return failure("Forbidden", 403);
  }
  if (!env.ACTIVATOR_MEDIA) return failure("Photo and video storage is not available yet. Please try again later.", 503);

  const id = match[2];
  if (match[3] === "thumbnail") return failure("Not found", 404);
  const file = match[3] === "file";
  if (!id && request.method === "GET") {
    const scope = url.searchParams.get("scope") ?? "all";
    if (!["all", "mine"].includes(scope) || (scope === "mine" && !owner)) return failure("Choose All media or My media.", 400);
    const cursor = url.searchParams.get("cursor");
    if (cursor !== null && !cursorPattern.test(cursor)) return failure("Invalid gallery cursor.", 400);
    const [createdAt, cursorId] = cursor?.split("|") ?? [null, null];
    const result = await env.DB.prepare(`${mediaSelect}
      WHERE m.event_id = ? AND m.state = 'ready'
        AND (? IS NULL OR m.activator_id = ?)
        AND (? IS NULL OR m.created_at < ? OR (m.created_at = ? AND m.id < ?))
      ORDER BY m.created_at DESC, m.id DESC LIMIT 51`)
      .bind(env.ACTIVATE_RI_EVENT_ID,
        scope === "mine" ? owner!.activatorId : null, scope === "mine" ? owner!.activatorId : null,
        createdAt, createdAt, createdAt, cursorId).all<MediaRow & MediaAuthor>();
    const rows = result.results.slice(0, 50);
    const last = rows.at(-1);
    const usage = owner ? await env.DB.prepare(`SELECT COUNT(*) AS files, COALESCE(SUM(size), 0) AS bytes
      FROM activate_ri_media WHERE event_id = ? AND activator_id = ?`)
      .bind(env.ACTIVATE_RI_EVENT_ID, owner.activatorId).first<{ files: number; bytes: number }>() : undefined;
    return json({ ok: true, media: rows.map((row) => serializeMedia(row, audience, viewerActivatorId)),
      nextCursor: result.results.length > 50 && last ? `${last.created_at}|${last.id}` : null,
      ...(owner ? { usage, limits: mediaLimits } : {}) });
  }
  if (!id && request.method === "POST" && owner) return uploadMedia(request, env, owner);
  if (!id) return failure("Method not allowed", 405);
  const row = await env.DB.prepare(`${mediaSelect}
    WHERE m.event_id = ? AND m.id = ?`)
    .bind(env.ACTIVATE_RI_EVENT_ID, id).first<MediaRow & MediaAuthor>();
  if (!row || row.state === "uploading") return failure("Photo or video not found.", 404);
  // Gallery visibility never grants mutation rights. Other activators may only
  // read ready files, including downloads and ranges.
  if (owner && row.activator_id !== owner.activatorId &&
    (!file || !["GET", "HEAD"].includes(request.method))) {
    return failure("Photo or video not found.", 404);
  }
  if (file && ["GET", "HEAD"].includes(request.method) && row.state === "ready") return serveMedia(request, env.ACTIVATOR_MEDIA, row);
  if (!file && request.method === "PATCH" && row.state === "ready") return updateMediaDetails(request, env, row, audience, viewerActivatorId);
  if (!file && request.method === "DELETE") {
    await env.DB.prepare("UPDATE activate_ri_media SET state = 'deleting', updated_at = ? WHERE event_id = ? AND id = ?")
      .bind(new Date().toISOString(), env.ACTIVATE_RI_EVENT_ID, row.id).run();
    await removeMediaObject(env, row);
    return json({ ok: true });
  }
  return failure(row.state === "deleting" ? "Photo or video not found." : "Method not allowed", row.state === "deleting" ? 404 : 405);
}

async function handlePublicMedia(request: Request, env: Env, url: URL, id?: string, resource?: string): Promise<Response> {
  if (!["GET", "HEAD"].includes(request.method)) return failure("Method not allowed", 405);
  if (!env.ACTIVATOR_MEDIA) return failure("Photo and video storage is not available yet. Please try again later.", 503);
  if (!id) {
    if (request.method !== "GET") return failure("Method not allowed", 405);
    const park = url.searchParams.get("park");
    if (park !== null && park !== "general" && !validateMediaParkReference(park)) {
      return failure("Choose a Rhode Island park from the list, or General — no park.", 400);
    }
    const kind = url.searchParams.get("kind");
    if (kind !== null && kind !== "photo" && kind !== "video") return failure("Choose photos or videos.", 400);
    const cursor = url.searchParams.get("cursor");
    if (cursor !== null && !cursorPattern.test(cursor)) return failure("Invalid gallery cursor.", 400);
    const [createdAt, cursorId] = cursor?.split("|") ?? [null, null];
    const [admin, activator] = await Promise.all([requireAdmin(request, env), requireActivator(request, env)]);
    const viewerIsAdmin = !(admin instanceof Response);
    const viewerActivatorId = activator instanceof Response ? null : activator.activatorId;
    const result = await env.DB.prepare(`${mediaSelect}
      WHERE m.event_id = ? AND m.state = 'ready'
        AND (? IS NULL OR (? = 'general' AND m.park_reference IS NULL) OR m.park_reference = ?)
        AND (? IS NULL OR m.kind = ?)
        AND (? IS NULL OR m.created_at < ? OR (m.created_at = ? AND m.id < ?))
      ORDER BY m.created_at DESC, m.id DESC LIMIT 51`)
      .bind(env.ACTIVATE_RI_EVENT_ID, park, park, park, kind, kind,
        createdAt, createdAt, createdAt, cursorId).all<MediaRow & MediaAuthor>();
    const rows = result.results.slice(0, 50);
    const last = rows.at(-1);
    return json({ ok: true,
      media: rows.map((row) => serializeMedia(row, "public", viewerActivatorId, viewerIsAdmin)),
      nextCursor: result.results.length > 50 && last ? `${last.created_at}|${last.id}` : null,
    });
  }
  if (resource !== "file" && resource !== "thumbnail") return failure("Not found", 404);
  const row = await env.DB.prepare(`SELECT * FROM activate_ri_media
    WHERE event_id = ? AND id = ? AND state = 'ready'`)
    .bind(env.ACTIVATE_RI_EVENT_ID, id).first<MediaRow>();
  if (!row) return failure("Photo or video not found.", 404);
  if (resource === "thumbnail") {
    return row.kind === "photo" ? servePublicMediaThumbnail(request, env, row) : failure("Photo not found.", 404);
  }
  return serveMedia(request, env.ACTIVATOR_MEDIA, row);
}

function withPublicMediaHeaders(response: Response): Response {
  const headers = new Headers(response.headers);
  // Viewer-specific edit links must never be shared through a cache. Keeping
  // file responses uncached also makes deletion effective on the next request.
  headers.set("cache-control", "private, no-store");
  headers.append("vary", "Cookie, Cf-Access-Jwt-Assertion, Cf-Access-Authenticated-User-Email");
  headers.set("x-content-type-options", "nosniff");
  headers.set("referrer-policy", "no-referrer");
  headers.set("cross-origin-resource-policy", "same-origin");
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
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
  const parkReference = request.headers.get("x-media-park-reference") || null;
  if (!validateMediaParkReference(parkReference)) return failure("Choose a Rhode Island park from the list, or General — no park.", 400);

  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  // Keys deliberately contain neither the activator ID (which may contain an
  // email address) nor the original filename. File access goes through Worker
  // visibility checks, while mutations always require authentication.
  const row: MediaRow = {
    id, event_id: env.ACTIVATE_RI_EVENT_ID, activator_id: owner.activatorId,
    object_key: `activator-media/${env.ACTIVATE_RI_EVENT_ID}/${id}`,
    filename, content_type: contentType, kind: contentType.startsWith("image/") ? "photo" : "video",
    size, state: "uploading", created_at: now, updated_at: now,
    park_reference: parkReference,
    title: null, description: null, usage_notice_version: mediaUsageNoticeVersion,
  };
  // Track the object before streaming so interrupted uploads remain eligible
  // for cleanup. Gallery pagination does not cap the number of uploads.
  await env.DB.prepare(`INSERT INTO activate_ri_media
    (id, event_id, activator_id, object_key, filename, content_type, kind, size, state, created_at, updated_at, park_reference, usage_notice_version)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'uploading', ?, ?, ?, ?)`)
    .bind(id, row.event_id, row.activator_id, row.object_key, filename, contentType, row.kind, size, now, now, parkReference, mediaUsageNoticeVersion).run();
  try {
    await storeMediaStream(env.ACTIVATOR_MEDIA!, row.object_key, request.body, size, contentType);
    const saved = await env.DB.prepare("UPDATE activate_ri_media SET state = 'ready', updated_at = ? WHERE event_id = ? AND id = ? AND state = 'uploading'")
      .bind(new Date().toISOString(), row.event_id, id).run();
    if (saved.meta.changes !== 1) throw new Error("Upload reservation unavailable");
    const author = await currentMediaAuthor(env, row.activator_id);
    return json({ ok: true, media: serializeMedia({ ...row, ...author }, "activator", owner.activatorId) }, { status: 201 });
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

async function updateMediaDetails(
  request: Request,
  env: Env,
  row: MediaRow,
  audience: "activator" | "admin",
  viewerActivatorId: string | null,
): Promise<Response> {
  if (request.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "application/json") {
    return failure("Expected application/json.", 415);
  }
  if (!request.body) return failure("Enter the file details to update.", 400);
  const maximumBytes = 16 * 1024;
  if (Number(request.headers.get("content-length")) > maximumBytes) return failure("File details are too large.", 413);
  const reader = request.body.getReader();
  const bytes = new Uint8Array(maximumBytes);
  let size = 0;
  let payload: unknown;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      if (size + chunk.value.byteLength > maximumBytes) {
        await reader.cancel();
        return failure("File details are too large.", 413);
      }
      bytes.set(chunk.value, size);
      size += chunk.value.byteLength;
    }
    payload = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(0, size)));
  } catch {
    return failure("Expected valid JSON.", 400);
  } finally {
    reader.releaseLock();
  }
  const { patch, error } = parseMediaMetadataPatch(payload);
  if (error !== null) return failure(error, 400);
  const updatedAt = new Date().toISOString();
  const fields: string[] = ["updated_at = ?"];
  const values: (string | null)[] = [updatedAt];
  if ("parkReference" in patch) {
    fields.push("park_reference = ?"); values.push(patch.parkReference ?? null);
  }
  for (const key of ["title", "description"] as const) {
    if (!(key in patch)) continue;
    fields.push(`${key} = ?`); values.push(patch[key] ?? null);
  }
  const updated = await env.DB.prepare(`UPDATE activate_ri_media SET ${fields.join(", ")}
    WHERE event_id = ? AND id = ? AND activator_id = ? AND state = 'ready' RETURNING *`)
    .bind(...values, env.ACTIVATE_RI_EVENT_ID, row.id, row.activator_id).first<MediaRow>();
  if (!updated) return failure("Photo or video not found.", 404);
  const author = await currentMediaAuthor(env, row.activator_id);
  return json({ ok: true, media: serializeMedia({ ...updated, ...author }, audience, viewerActivatorId) });
}

async function currentMediaAuthor(env: Env, activatorId: string): Promise<MediaAuthor> {
  // Resolve the current preference at response time, including when it changes
  // while a large video is uploading. An explicit blank stays callsign-only.
  const author = await env.DB.prepare(`SELECT a.primary_callsign, a.name AS activator_name, membership.chat_display_name
    FROM activate_ri_activators a
    LEFT JOIN activate_ri_ops_memberships membership ON membership.activator_id = a.id AND membership.event_id = a.event_id
    WHERE a.event_id = ? AND a.id = ?`)
    .bind(env.ACTIVATE_RI_EVENT_ID, activatorId).first<MediaAuthor>();
  if (!author) throw new Error("Media author unavailable");
  return author;
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
