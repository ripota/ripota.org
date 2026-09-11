import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";
import { mediaLimits, type ActivatorMedia } from "../lib/activate-ri/media";
import { createUserWithVerifiedEmail, grantAdminRole, linkActivatorMembership } from "./auth/db";
import { createAuthSession } from "./auth/session";
import { insertPendingPlan } from "./db";
import type { Env } from "./env";
import * as mediaStorage from "./media";
import * as mediaThumbnails from "./media-thumbnails";
import { handleActivateRiApi } from "./routes/activate-ri";
import { createMigratedSqliteD1 } from "./test-utils/sqlite-d1";

const origin = "https://ripota.org";
const base = "/api/activate-ri-2026/activator/media";
const adminBase = "/api/activate-ri-2026/admin/media";
const publicBase = "/api/activate-ri-2026/public/media";
const usageNoticeVersion = "ri-pota-media-v1";
const photo = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, ...new Uint8Array(28)]);
let database: ReturnType<typeof createMigratedSqliteD1>;
let env: Env;
let objects: Map<string, Uint8Array>;
let get: ReturnType<typeof vi.fn>;
let head: ReturnType<typeof vi.fn>;
let remove: ReturnType<typeof vi.fn>;
let store: MockInstance<typeof mediaStorage.storeMediaStream>;

beforeEach(() => {
  database = createMigratedSqliteD1();
  objects = new Map();
  get = vi.fn(async (key: string, options?: R2GetOptions) => {
    const body = objects.get(key);
    if (!body) return null;
    const range = options?.range as { offset: number; length: number } | undefined;
    const selected = range ? body.slice(range.offset, range.offset + range.length) : body;
    return {
      key, size: body.length, httpEtag: '"test-etag"', range,
      body: new Response(Uint8Array.from(selected)).body,
    } as R2ObjectBody;
  });
  head = vi.fn(async (key: string) => {
    const body = objects.get(key);
    return body ? { key, size: body.length, httpEtag: '"test-etag"' } as R2Object : null;
  });
  remove = vi.fn(async (keys: string | string[]) => {
    for (const key of typeof keys === "string" ? [keys] : keys) objects.delete(key);
  });
  env = {
    ACTIVATE_RI_EVENT_ID: "activate-ri-2026",
    SITE_ORIGIN: origin,
    AUTH_ACTIVATOR_MODE: "unified",
    AUTH_RATE_LIMIT_BURST: { limit: vi.fn(async () => ({ success: true })) } as RateLimit,
    AUTH_EMAIL_RATE_LIMIT: { limit: vi.fn(async () => ({ success: true })) } as RateLimit,
    AUTH_ADMIN_MODE: "access",
    ALLOW_ADMIN_HEADER_AUTH: "true",
    ASSETS: null as never,
    DB: database.DB,
    ACTIVATOR_MEDIA: { get, head, delete: remove } as unknown as R2Bucket,
  };
  // Streaming behavior is exercised in media.test.ts and real Wrangler E2E.
  // Here the real SQL and authentication run against a deterministic R2 store.
  store = vi.spyOn(mediaStorage, "storeMediaStream").mockImplementation(async (_bucket, key, body) => {
    objects.set(key, new Uint8Array(await new Response(body).arrayBuffer()));
  });
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
  database.close();
});

type Owner = { activatorId: string; token: string; sessionId: string; userId: string };

async function owner(label = "owner"): Promise<Owner> {
  const createdAt = new Date().toISOString();
  const email = `${label}@example.invalid`;
  const registration = await insertPendingPlan(env, {
    submitterCallsign: label === "owner" ? "N1OWN" : "N1OTH",
    submitterName: label, submitterEmail: email, submitterPhone: "", club: "",
    publicNotes: "", organizerNotes: "",
    stops: [{
      parkReference: "US-2868", plannedDate: "2026-09-12", timeBlock: "09:00-12:00",
      startTime: "09:00", endTime: "12:00", bands: ["40m"], modes: ["SSB"],
      publicNotes: "", organizerNotes: "",
    }],
  }, createdAt, { issueEditToken: false });
  const user = await createUserWithVerifiedEmail(env, email, label, createdAt);
  await linkActivatorMembership(env, user.id, registration.activatorId, createdAt);
  const session = await createAuthSession(env, { userId: user.id, authenticationMethod: "passkey", passkeyVerified: true });
  return { activatorId: registration.activatorId, token: session.token, sessionId: session.id, userId: user.id };
}

function request(path: string, token?: string, init: RequestInit = {}): Request {
  const headers = new Headers(init.headers);
  if (token) headers.set("cookie", `__Host-ripota-session=${token}`);
  return new Request(`${origin}${path}`, { ...init, headers });
}

function upload(token?: string, overrides: Record<string, string | null> = {}, contents: Uint8Array<ArrayBuffer> = photo): Request {
  const headers = new Headers({
    origin, "content-type": "image/jpeg", "content-length": String(contents.length),
    "x-media-filename": encodeURIComponent("Activation — café.jpg"),
  });
  for (const [name, value] of Object.entries(overrides)) {
    if (value === null) headers.delete(name);
    else headers.set(name, value);
  }
  return request(base, token, { method: "POST", headers, body: contents });
}

async function setChatDisplayName(activatorId: string, displayName: string | null, eventId: string = env.ACTIVATE_RI_EVENT_ID): Promise<void> {
  const now = new Date().toISOString();
  await env.DB.prepare(`INSERT INTO activate_ri_ops_memberships
    (event_id, activator_id, status, created_at, updated_at, chat_display_name)
    VALUES (?, ?, 'active', ?, ?, ?)
    ON CONFLICT (event_id, activator_id) DO UPDATE SET chat_display_name = excluded.chat_display_name`)
    .bind(eventId, activatorId, now, now, displayName).run();
}

async function uploadPhoto(token: string): Promise<ActivatorMedia> {
  const response = await handleActivateRiApi(upload(token), env);
  expect(response.status).toBe(201);
  const result = await response.json() as { media: ActivatorMedia };
  return result.media;
}

function parkPatch(id: string, token: string | undefined, body: unknown, routeBase = base, headers: Record<string, string> = {}): Request {
  return request(`${routeBase}/${id}`, token, {
    method: "PATCH",
    headers: { origin, "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

function privateHeaders(response: Response): void {
  expect(response.headers.get("cache-control")).toBe("private, no-store");
  expect(response.headers.get("x-content-type-options")).toBe("nosniff");
  expect(response.headers.get("referrer-policy")).toBe("no-referrer");
}

async function rowCount(): Promise<number> {
  return (await env.DB.prepare("SELECT COUNT(*) AS count FROM activate_ri_media").first<{ count: number }>())!.count;
}

async function seedMedia(activatorId: string, options: {
  state?: "uploading" | "ready" | "deleting";
  size?: number;
  createdAt?: string;
  eventId?: string;
  parkReference?: string | null;
  kind?: "photo" | "video";
} = {}): Promise<string> {
  const id = crypto.randomUUID();
  const createdAt = options.createdAt ?? new Date().toISOString();
  const key = `test/${id}`;
  const kind = options.kind ?? "photo";
  await env.DB.prepare(`INSERT INTO activate_ri_media
    (id, event_id, activator_id, object_key, filename, content_type, kind, size, state, created_at, updated_at, usage_notice_version, park_reference)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .bind(id, options.eventId ?? env.ACTIVATE_RI_EVENT_ID, activatorId, key,
      kind === "photo" ? "photo.jpg" : "video.mp4", kind === "photo" ? "image/jpeg" : "video/mp4", kind,
      options.size ?? photo.length, options.state ?? "ready", createdAt, createdAt, usageNoticeVersion, options.parkReference ?? null).run();
  objects.set(key, photo);
  return id;
}

describe("private activator media", () => {
  it("uploads, lists, downloads and removes an owner's photo", async () => {
    const user = await owner();
    const media = await uploadPhoto(user.token);
    expect(media).toMatchObject({ filename: "Activation — café.jpg", kind: "photo", size: photo.length, callsign: "N1OWN", authorLabel: "N1OWN - owner" });
    expect(media).not.toHaveProperty("object_key");
    const list = await handleActivateRiApi(request(base, user.token), env);
    privateHeaders(list);
    await expect(list.json()).resolves.toMatchObject({ ok: true, media: [media], usage: { files: 1, bytes: photo.length }, limits: {
      photoBytes: 20 * 1024 * 1024, videoBytes: 80 * 1024 * 1024,
    } });

    const file = await handleActivateRiApi(request(`${media.url}?download=1`, user.token), env);
    expect(file.status).toBe(200);
    privateHeaders(file);
    expect(file.headers.get("content-type")).toBe("image/jpeg");
    expect(file.headers.get("content-disposition")).toContain("attachment;");
    expect(file.headers.get("content-disposition")).toContain("filename*=UTF-8''Activation%20%E2%80%94%20caf%C3%A9.jpg");
    expect(new Uint8Array(await file.arrayBuffer())).toEqual(photo);
    const deleted = await handleActivateRiApi(request(`${base}/${media.id}`, user.token, { method: "DELETE", headers: { origin } }), env);
    expect(deleted.status).toBe(200);
    expect(objects.size).toBe(0);
    await expect(rowCount()).resolves.toBe(0);
  });

  it("keeps same-name uploads distinct and deleting one preserves the other original", async () => {
    const user = await owner();
    const contents = [Uint8Array.from(photo), Uint8Array.from(photo)];
    contents[0][contents[0].length - 1] = 11;
    contents[1][contents[1].length - 1] = 22;
    const responses = await Promise.all(contents.map((bytes) => handleActivateRiApi(upload(user.token, {}, bytes), env)));
    expect(responses.map((response) => response.status)).toEqual([201, 201]);
    const saved = await Promise.all(responses.map(async (response) => (await response.json() as { media: ActivatorMedia }).media));
    expect(saved[0].filename).toBe(saved[1].filename);
    expect(saved[0].id).not.toBe(saved[1].id);
    expect(saved[0].url).not.toBe(saved[1].url);
    const rows = await env.DB.prepare("SELECT object_key FROM activate_ri_media").all<{ object_key: string }>();
    expect(new Set(rows.results.map((row) => row.object_key)).size).toBe(2);
    for (const [index, media] of saved.entries()) {
      const original = await handleActivateRiApi(request(`${media.url}?download=1`, user.token), env);
      expect(original.status).toBe(200);
      expect(new Uint8Array(await original.arrayBuffer())).toEqual(contents[index]);
    }
    expect((await handleActivateRiApi(request(`${base}/${saved[0].id}`, user.token, { method: "DELETE", headers: { origin } }), env)).status).toBe(200);
    const remaining = await handleActivateRiApi(request(saved[1].url, user.token), env);
    expect(remaining.status).toBe(200);
    expect(new Uint8Array(await remaining.arrayBuffer())).toEqual(contents[1]);
    expect(objects.size).toBe(1);
  });


  it("requires an activator session for every operation, including HEAD", async () => {
    const first = await owner();
    const media = await uploadPhoto(first.token);
    const account = await createUserWithVerifiedEmail(env, "account@example.invalid", "Account", new Date().toISOString());
    const session = await createAuthSession(env, { userId: account.id, authenticationMethod: "passkey", passkeyVerified: true });
    for (const token of [undefined, session.token]) {
      for (const operation of [
        request(base, token), upload(token), request(media.url, token),
        request(media.url, token, { method: "HEAD" }),
        request(`${base}/${media.id}`, token, { method: "DELETE", headers: { origin } }),
        parkPatch(media.id, token, { parkReference: "US-2868" }),
      ]) {
        const denied = await handleActivateRiApi(operation, env);
        expect(denied.status).toBe(401);
        privateHeaders(denied);
      }
    }
    expect(get).not.toHaveBeenCalled();
    expect(head).not.toHaveBeenCalled();
    expect(remove).not.toHaveBeenCalled();
  });

  it("denies a revoked owner session", async () => {
    const first = await owner();
    const media = await uploadPhoto(first.token);
    await env.DB.prepare("UPDATE auth_sessions SET revoked_at = ? WHERE id = ?")
      .bind(new Date().toISOString(), first.sessionId).run();
    expect((await handleActivateRiApi(request(media.url, first.token), env)).status).toBe(401);
    expect((await handleActivateRiApi(parkPatch(media.id, first.token, { parkReference: "US-2868" }), env)).status).toBe(401);
    expect(get).not.toHaveBeenCalled();
  });

  it("allows organizers to list and read media while preserving authentication", async () => {
    const first = await owner();
    const media = await uploadPhoto(first.token);
    const denied = await handleActivateRiApi(request(adminBase), env);
    expect(denied.status).toBe(401);
    privateHeaders(denied);
    const adminHeaders = { "cf-access-authenticated-user-email": "organizer@example.invalid" };
    const list = await handleActivateRiApi(request(adminBase, undefined, { headers: adminHeaders }), env);
    expect(list.status).toBe(200);
    const result = await list.json() as { media: ActivatorMedia[]; nextCursor: string | null };
    expect(result.media).toHaveLength(1);
    expect(result.nextCursor).toBeNull();
    expect(result.media[0].url).toBe(`${adminBase}/${media.id}/file`);
    const file = await handleActivateRiApi(request(result.media[0].url, undefined, { headers: adminHeaders }), env);
    expect(file.status).toBe(200);
    privateHeaders(file);
  });

  it("paginates organizer results without duplicates when upload timestamps match", async () => {
    const [first, second] = await Promise.all([owner(), owner("other")]);
    const createdAt = new Date().toISOString();
    const ids: string[] = [];
    for (let index = 0; index < 51; index++) {
      ids.push(await seedMedia(index % 2 ? first.activatorId : second.activatorId, { createdAt }));
    }
    const headers = { "cf-access-authenticated-user-email": "organizer@example.invalid" };
    const firstPage = await handleActivateRiApi(request(adminBase, undefined, { headers }), env);
    const firstResult = await firstPage.json() as { media: ActivatorMedia[]; nextCursor: string };
    expect(firstResult.media).toHaveLength(50);
    expect(firstResult.nextCursor).toBeTruthy();
    const secondPage = await handleActivateRiApi(request(`${adminBase}?cursor=${encodeURIComponent(firstResult.nextCursor)}`, undefined, { headers }), env);
    const secondResult = await secondPage.json() as { media: ActivatorMedia[]; nextCursor: null };
    expect(secondResult.media).toHaveLength(1);
    expect(secondResult.nextCursor).toBeNull();
    const actualIds = [...firstResult.media, ...secondResult.media].map((media) => media.id);
    expect(new Set(actualIds).size).toBe(51);
    expect(actualIds).toEqual(ids.sort().reverse());
    expect((await handleActivateRiApi(request(`${adminBase}?cursor=invalid`, undefined, { headers }), env)).status).toBe(400);
  });

  it.each([null, "https://untrusted.example"])("rejects mutations with Origin %s", async (suppliedOrigin) => {
    const user = await owner();
    const media = await uploadPhoto(user.token);
    const rejectedUpload = await handleActivateRiApi(upload(user.token, { origin: suppliedOrigin }), env);
    expect(rejectedUpload.status).toBe(403);
    const rejectedDelete = await handleActivateRiApi(request(`${base}/${media.id}`, user.token, {
      method: "DELETE", headers: suppliedOrigin ? { origin: suppliedOrigin } : {},
    }), env);
    expect(rejectedDelete.status).toBe(403);
    expect(store).toHaveBeenCalledTimes(1);
    expect(remove).not.toHaveBeenCalled();
  });

  it("blocks mutations in the production-data read-only environment", async () => {
    const user = await owner();
    const media = await uploadPhoto(user.token);
    env.REMOTE_DATA_READ_ONLY = "true";
    expect((await handleActivateRiApi(upload(user.token), env)).status).toBe(403);
    expect((await handleActivateRiApi(request(`${base}/${media.id}`, user.token, { method: "DELETE", headers: { origin } }), env)).status).toBe(403);
    expect((await handleActivateRiApi(request(media.url, user.token), env)).status).toBe(200);
    expect(store).toHaveBeenCalledTimes(1);
    expect(remove).not.toHaveBeenCalled();
  });

  it.each(["pending", "approved", "withdrawn"])("permits %s activators to contribute", async (status) => {
    const user = await owner();
    await env.DB.prepare("UPDATE activate_ri_activators SET status = ? WHERE id = ?").bind(status, user.activatorId).run();
    expect((await handleActivateRiApi(upload(user.token), env)).status).toBe(201);
  });

  it("prevents rejected activators from uploading but keeps their own read/delete access", async () => {
    const user = await owner();
    const media = await uploadPhoto(user.token);
    await env.DB.prepare("UPDATE activate_ri_activators SET status = 'rejected' WHERE id = ?").bind(user.activatorId).run();
    expect((await handleActivateRiApi(upload(user.token), env)).status).toBe(403);
    expect((await handleActivateRiApi(request(media.url, user.token), env)).status).toBe(200);
    expect((await handleActivateRiApi(request(`${base}/${media.id}`, user.token, { method: "DELETE", headers: { origin } }), env)).status).toBe(200);
  });
});

describe("shared activator gallery", () => {
  it("applies metadata schema updates before the first upload", async () => {
    database.close();
    database = createMigratedSqliteD1({ through: "0031_activator_media.sql" });
    env.DB = database.DB;
    database.applyMigrationFile("0032_media_park_reference.sql");
    database.applyMigrationFile("0033_media_sharing_and_details.sql");
    await expect(rowCount()).resolves.toBe(0);
    const user = await owner();
    const media = await uploadPhoto(user.token);
    expect(media).toMatchObject({ parkReference: null, title: null, description: null, canEdit: true });
    await expect(env.DB.prepare("SELECT usage_notice_version FROM activate_ri_media WHERE id = ?").bind(media.id).first())
      .resolves.toEqual({ usage_notice_version: usageNoticeVersion });
  });

  it("shares ready files with registered activators while retaining owner-only mutations", async () => {
    const [first, second] = await Promise.all([owner(), owner("other")]);
    const media = await uploadPhoto(first.token);
    expect(media).toMatchObject({ title: null, description: null, canEdit: true });
    await expect(env.DB.prepare("SELECT usage_notice_version, created_at FROM activate_ri_media WHERE id = ?").bind(media.id).first())
      .resolves.toEqual({ usage_notice_version: usageNoticeVersion, created_at: media.createdAt });
    const listing = await handleActivateRiApi(request(base, second.token), env);
    await expect(listing.json()).resolves.toMatchObject({
      media: [expect.objectContaining({ id: media.id, canEdit: false })],
      usage: { files: 0, bytes: 0 },
    });
    const file = await handleActivateRiApi(request(media.url, second.token), env);
    expect(file.status).toBe(200);
    privateHeaders(file);
    expect(new Uint8Array(await file.arrayBuffer())).toEqual(photo);
    const metadata = await handleActivateRiApi(request(media.url, second.token, { method: "HEAD" }), env);
    expect(metadata.status).toBe(200);
    expect(await metadata.text()).toBe("");
    const ranged = await handleActivateRiApi(request(media.url, second.token, { headers: { range: "bytes=0-1" } }), env);
    expect(ranged.status).toBe(206);
    privateHeaders(ranged);
    expect(new Uint8Array(await ranged.arrayBuffer())).toEqual(photo.slice(0, 2));
    const spoofed = await handleActivateRiApi(parkPatch(media.id, second.token, {
      title: "Mine now", canEdit: true, activatorId: second.activatorId,
    }), env);
    expect(spoofed.status).toBe(404);
    const deleted = await handleActivateRiApi(request(`${base}/${media.id}`, second.token, { method: "DELETE", headers: { origin } }), env);
    expect(deleted.status).toBe(404);
    expect(remove).not.toHaveBeenCalled();
    await expect(env.DB.prepare("SELECT activator_id, title FROM activate_ri_media WHERE id = ?").bind(media.id).first())
      .resolves.toEqual({ activator_id: first.activatorId, title: null });
  });

  it("scopes Mine to the caller while All includes other activators and usage stays personal", async () => {
    const [first, second] = await Promise.all([owner(), owner("other")]);
    const ownFirst = await seedMedia(first.activatorId);
    const ownSecond = await seedMedia(first.activatorId);
    const otherFirst = await seedMedia(second.activatorId);
    const otherSecond = await seedMedia(second.activatorId);
    for (const [suffix, expected] of [["", [ownFirst, ownSecond, otherFirst, otherSecond]], ["?scope=mine", [ownFirst, ownSecond]]] as const) {
      const response = await handleActivateRiApi(request(`${base}${suffix}`, first.token), env);
      expect(response.status).toBe(200);
      privateHeaders(response);
      const result = await response.json() as { media: ActivatorMedia[]; usage: { files: number; bytes: number } };
      expect(result.media.map((item) => item.id).sort()).toEqual([...expected].sort());
      expect(result.usage).toEqual({ files: 2, bytes: photo.length * 2 });
      for (const item of result.media) expect(item.canEdit).toBe([ownFirst, ownSecond].includes(item.id));
    }
  });

  it("paginates all shared gallery records without duplicates", async () => {
    const [first, second] = await Promise.all([owner(), owner("other")]);
    const timestamp = new Date().toISOString();
    const ids: string[] = [];
    for (let index = 0; index < 51; index++) {
      ids.push(await seedMedia(index % 2 ? first.activatorId : second.activatorId, { createdAt: timestamp }));
    }
    const firstResponse = await handleActivateRiApi(request(base, first.token), env);
    const firstPage = await firstResponse.json() as { media: ActivatorMedia[]; nextCursor: string };
    expect(firstPage.media).toHaveLength(50);
    expect(firstPage.nextCursor).toBeTruthy();
    const secondResponse = await handleActivateRiApi(request(`${base}?cursor=${encodeURIComponent(firstPage.nextCursor)}`, first.token), env);
    const secondPage = await secondResponse.json() as { media: ActivatorMedia[]; nextCursor: null };
    expect(secondPage.media).toHaveLength(1);
    expect(secondPage.nextCursor).toBeNull();
    expect([...firstPage.media, ...secondPage.media].map((item) => item.id)).toEqual(ids.sort().reverse());
  });

  it.each(["?scope=someone-else", "?scope=private", "?cursor=invalid", "?cursor="])("rejects invalid gallery filter state %s", async (query) => {
    const user = await owner();
    const response = await handleActivateRiApi(request(`${base}${query}`, user.token), env);
    expect(response.status).toBe(400);
    privateHeaders(response);
  });

  it("keeps unfinished uploads and uploads in other events out of the gallery", async () => {
    const [first, second] = await Promise.all([owner(), owner("other")]);
    for (const state of ["uploading", "deleting"] as const) {
      const id = await seedMedia(first.activatorId, { state });
      expect((await handleActivateRiApi(request(`${base}/${id}/file`, second.token), env)).status).toBe(404);
    }
    const otherEvent = await seedMedia(first.activatorId, { eventId: "other-event" });
    expect((await handleActivateRiApi(request(`${base}/${otherEvent}/file`, second.token), env)).status).toBe(404);
    const response = await handleActivateRiApi(request(base, second.token), env);
    await expect(response.json()).resolves.toMatchObject({ media: [] });
    expect(get).not.toHaveBeenCalled();
  });
});

describe("public media gallery", () => {
  function publicHeaders(response: Response): void {
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("vary")?.toLowerCase().split(/,\s*/)).toEqual(expect.arrayContaining([
      "cookie", "cf-access-jwt-assertion", "cf-access-authenticated-user-email",
    ]));
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("x-robots-tag")).toBeNull();
  }

  it("lists all existing ready uploads anonymously without private metadata or edit authority", async () => {
    const [first, second] = await Promise.all([owner(), owner("other")]);
    const photoId = await seedMedia(first.activatorId, { parkReference: "US-2868" });
    const videoId = await seedMedia(second.activatorId, { kind: "video" });
    await env.DB.prepare("UPDATE activate_ri_media SET usage_notice_version = NULL WHERE id = ?").bind(photoId).run();
    await setChatDisplayName(first.activatorId, "Rob J.");
    const response = await handleActivateRiApi(request(publicBase), env);
    expect(response.status).toBe(200);
    publicHeaders(response);
    const body = await response.json() as { media: ActivatorMedia[]; nextCursor: null };
    expect(body.media.map((media) => media.id).sort()).toEqual([photoId, videoId].sort());
    expect(body.nextCursor).toBeNull();
    expect(body).not.toHaveProperty("usage");
    expect(body).not.toHaveProperty("limits");
    for (const media of body.media) {
      expect(media).toMatchObject({ canEdit: false, isOwn: false, editUrl: null, url: `${publicBase}/${media.id}/file` });
      expect(media).not.toHaveProperty("filename");
      expect(media).not.toHaveProperty("object_key");
      expect(media).not.toHaveProperty("activator_id");
      expect(media.thumbnailUrl).toBe(media.kind === "photo" ? `${publicBase}/${media.id}/thumbnail` : null);
    }
    expect(body.media.find((media) => media.id === photoId)?.authorLabel).toBe("N1OWN - Rob J.");
    expect(JSON.stringify(body)).not.toMatch(/@example|chat_display_name|activator_name|usage_notice_version/);
    expect(get).not.toHaveBeenCalled();
    expect(head).not.toHaveBeenCalled();
  });

  it("personalizes only ownership and authenticated edit links without changing the public collection", async () => {
    const [first, second] = await Promise.all([owner(), owner("other")]);
    const firstId = await seedMedia(first.activatorId);
    const secondId = await seedMedia(second.activatorId);
    const response = await handleActivateRiApi(request(publicBase, first.token), env);
    publicHeaders(response);
    const body = await response.json() as { media: ActivatorMedia[] };
    expect(body.media).toHaveLength(2);
    expect(body.media.find((media) => media.id === firstId)).toMatchObject({
      isOwn: true, canEdit: true, editUrl: `${base}/${firstId}`, url: `${publicBase}/${firstId}/file`,
    });
    expect(body.media.find((media) => media.id === secondId)).toMatchObject({ isOwn: false, canEdit: false, editUrl: null });
    expect((await handleActivateRiApi(parkPatch(firstId, second.token, { title: "Spoofed ownership" }), env)).status).toBe(404);
    expect((await handleActivateRiApi(parkPatch(firstId, undefined, { title: "Anonymous edit" }), env)).status).toBe(401);

    const headers = { "cf-access-authenticated-user-email": "organizer@example.invalid" };
    const adminResponse = await handleActivateRiApi(request(publicBase, first.token, { headers }), env);
    publicHeaders(adminResponse);
    const adminBody = await adminResponse.json() as { media: ActivatorMedia[] };
    for (const media of adminBody.media) {
      expect(media).toMatchObject({ canEdit: true, editUrl: `${adminBase}/${media.id}`, isOwn: media.id === firstId });
    }
    const adminEdit = await handleActivateRiApi(parkPatch(secondId, first.token, { title: "Organizer edit" }, adminBase, headers), env);
    expect(adminEdit.status).toBe(200);
    await expect(adminEdit.json()).resolves.toMatchObject({ media: { canEdit: true, isOwn: false, editUrl: `${adminBase}/${secondId}` } });
  });

  it("requires fresh organizer authentication for public admin edit links while retaining owner access", async () => {
    env.AUTH_ADMIN_MODE = "passkey";
    const [first, second] = await Promise.all([owner(), owner("other")]);
    await grantAdminRole(env, first.userId, null);
    const ownId = await seedMedia(first.activatorId);
    const otherId = await seedMedia(second.activatorId);
    const fresh = await handleActivateRiApi(request(publicBase, first.token), env);
    const freshBody = await fresh.json() as { media: ActivatorMedia[] };
    expect(freshBody.media).toHaveLength(2);
    expect(freshBody.media.every((media) => media.canEdit && media.editUrl === `${adminBase}/${media.id}`)).toBe(true);
    await env.DB.prepare("UPDATE auth_sessions SET passkey_verified_at = ? WHERE id = ?")
      .bind("2020-01-01T00:00:00.000Z", first.sessionId).run();
    const stale = await handleActivateRiApi(request(publicBase, first.token), env);
    expect(stale.status).toBe(200);
    publicHeaders(stale);
    const staleBody = await stale.json() as { media: ActivatorMedia[] };
    expect(staleBody.media.find((media) => media.id === ownId)).toMatchObject({ canEdit: true, isOwn: true, editUrl: `${base}/${ownId}` });
    expect(staleBody.media.find((media) => media.id === otherId)).toMatchObject({ canEdit: false, isOwn: false, editUrl: null });
    expect((await handleActivateRiApi(parkPatch(otherId, first.token, { title: "Stale admin" }, adminBase), env)).status).toBe(401);
  });

  it.each(["anonymous", "account-only", "expired", "revoked", "unknown-token"] as const)(
    "keeps public viewing available with %s credentials while omitting edit links", async (credentials) => {
      const first = await owner();
      const id = await seedMedia(first.activatorId);
      let token: string | undefined = first.token;
      if (credentials === "anonymous") token = undefined;
      else if (credentials === "unknown-token") token = "expired-or-invalid-session";
      else if (credentials === "account-only") {
        const account = await createUserWithVerifiedEmail(env, "hunter@example.invalid", "Hunter", new Date().toISOString());
        token = (await createAuthSession(env, { userId: account.id, authenticationMethod: "passkey", passkeyVerified: true })).token;
      } else {
        const column = credentials === "expired" ? "expires_at" : "revoked_at";
        await env.DB.prepare(`UPDATE auth_sessions SET ${column} = ? WHERE id = ?`)
          .bind("2020-01-01T00:00:00.000Z", first.sessionId).run();
      }
      const response = await handleActivateRiApi(request(publicBase, token), env);
      expect(response.status).toBe(200);
      publicHeaders(response);
      await expect(response.json()).resolves.toMatchObject({ media: [{ id, canEdit: false, isOwn: false, editUrl: null }] });
      const original = await handleActivateRiApi(request(`${publicBase}/${id}/file`, token), env);
      expect(original.status).toBe(200);
      expect(new Uint8Array(await original.arrayBuffer())).toEqual(photo);
    },
  );

  it("applies combined park and kind filters before pagination and preserves identical-timestamp ordering", async () => {
    const first = await owner();
    const matchIds: string[] = [];
    const timestamp = "2026-09-12T12:00:00.000Z";
    for (let index = 0; index < 51; index++) {
      matchIds.push(await seedMedia(first.activatorId, { parkReference: "US-2868", kind: "photo", createdAt: timestamp }));
      await seedMedia(first.activatorId, { parkReference: "US-2868", kind: "video", createdAt: "2026-09-13T12:00:00.000Z" });
    }
    const general = await seedMedia(first.activatorId);
    await seedMedia(first.activatorId, { parkReference: "US-0514" });
    const filtered = `${publicBase}?park=US-2868&kind=photo`;
    const firstResponse = await handleActivateRiApi(request(filtered), env);
    const firstPage = await firstResponse.json() as { media: ActivatorMedia[]; nextCursor: string };
    expect(firstPage.media).toHaveLength(50);
    expect(firstPage.media.every((media) => media.parkReference === "US-2868" && media.kind === "photo")).toBe(true);
    const secondResponse = await handleActivateRiApi(request(`${filtered}&cursor=${encodeURIComponent(firstPage.nextCursor)}`), env);
    const secondPage = await secondResponse.json() as { media: ActivatorMedia[]; nextCursor: null };
    expect(secondPage.media).toHaveLength(1);
    expect(secondPage.nextCursor).toBeNull();
    expect([...firstPage.media, ...secondPage.media].map((media) => media.id)).toEqual(matchIds.sort().reverse());
    const generalResponse = await handleActivateRiApi(request(`${publicBase}?park=general&kind=photo`), env);
    await expect(generalResponse.json()).resolves.toMatchObject({ media: [{ id: general, parkReference: null }], nextCursor: null });
    const videoResponse = await handleActivateRiApi(request(`${publicBase}?park=US-2868&kind=video`), env);
    const videos = await videoResponse.json() as { media: ActivatorMedia[]; nextCursor: string };
    expect(videos.media).toHaveLength(50);
    expect(videos.media.every((media) => media.kind === "video")).toBe(true);
  });

  it.each(["?park=US-0001", "?park=us-2868", "?park=", "?kind=audio", "?kind=", "?cursor=invalid", "?cursor="])(
    "rejects invalid public filters %s", async (query) => {
      const response = await handleActivateRiApi(request(`${publicBase}${query}`), env);
      expect(response.status).toBe(400);
      publicHeaders(response);
      expect(get).not.toHaveBeenCalled();
    },
  );

  it("serves unchanged anonymous originals, downloads, HEAD, and byte ranges", async () => {
    const first = await owner();
    const saved = await uploadPhoto(first.token);
    const url = `${publicBase}/${saved.id}/file`;
    const original = await handleActivateRiApi(request(`${url}?download=1`), env);
    expect(original.status).toBe(200);
    publicHeaders(original);
    expect(original.headers.get("content-disposition")).toContain("attachment;");
    expect(new Uint8Array(await original.arrayBuffer())).toEqual(photo);
    const metadata = await handleActivateRiApi(request(url, undefined, { method: "HEAD" }), env);
    expect(metadata.status).toBe(200);
    expect(metadata.headers.get("content-length")).toBe(String(photo.length));
    expect(await metadata.text()).toBe("");
    const partial = await handleActivateRiApi(request(url, undefined, { headers: { range: "bytes=4-15" } }), env);
    expect(partial.status).toBe(206);
    expect(partial.headers.get("content-range")).toBe(`bytes 4-15/${photo.length}`);
    expect(new Uint8Array(await partial.arrayBuffer())).toEqual(photo.slice(4, 16));
    const changed = await handleActivateRiApi(parkPatch(saved.id, first.token, { title: "Changed title", parkReference: "US-2868" }), env);
    expect(changed.status).toBe(200);
    const unchanged = await handleActivateRiApi(request(url), env);
    expect(new Uint8Array(await unchanged.arrayBuffer())).toEqual(photo);
  });

  it("excludes unfinished and foreign-event originals and thumbnails before any storage access", async () => {
    const first = await owner();
    const thumbnail = vi.spyOn(mediaThumbnails, "servePublicMediaThumbnail");
    const ids = [
      await seedMedia(first.activatorId, { state: "uploading" }),
      await seedMedia(first.activatorId, { state: "deleting" }),
      await seedMedia(first.activatorId, { eventId: "another-event" }),
      crypto.randomUUID(),
    ];
    for (const id of ids) {
      for (const resource of ["file", "thumbnail"]) {
        for (const method of ["GET", "HEAD"]) {
          const response = await handleActivateRiApi(request(`${publicBase}/${id}/${resource}`, undefined, { method }), env);
          expect(response.status).toBe(404);
          publicHeaders(response);
        }
      }
    }
    const list = await handleActivateRiApi(request(publicBase), env);
    await expect(list.json()).resolves.toMatchObject({ media: [] });
    expect(thumbnail).not.toHaveBeenCalled();
    expect(get).not.toHaveBeenCalled();
    expect(head).not.toHaveBeenCalled();
  });

  it("delegates photo thumbnails only after checking ready event metadata", async () => {
    const first = await owner();
    const photoId = await seedMedia(first.activatorId);
    const videoId = await seedMedia(first.activatorId, { kind: "video" });
    const thumbnail = vi.spyOn(mediaThumbnails, "servePublicMediaThumbnail").mockImplementation(async (request) =>
      new Response(request.method === "HEAD" ? null : "thumbnail", { headers: { "content-type": "image/webp" } }));
    for (const method of ["GET", "HEAD"]) {
      const response = await handleActivateRiApi(request(`${publicBase}/${photoId}/thumbnail`, undefined, { method }), env);
      expect(response.status).toBe(200);
      publicHeaders(response);
      expect(await response.text()).toBe(method === "HEAD" ? "" : "thumbnail");
    }
    expect(thumbnail).toHaveBeenCalledTimes(2);
    expect(thumbnail).toHaveBeenLastCalledWith(expect.any(Request), env, expect.objectContaining({ id: photoId, state: "ready", kind: "photo" }));
    expect((await handleActivateRiApi(request(`${publicBase}/${videoId}/thumbnail`), env)).status).toBe(404);
    expect(thumbnail).toHaveBeenCalledTimes(2);
  });

  it("keeps public routes read-only for every viewer and allows original reads in production-data mode", async () => {
    const first = await owner();
    const id = await seedMedia(first.activatorId);
    const thumbnail = vi.spyOn(mediaThumbnails, "servePublicMediaThumbnail");
    for (const token of [undefined, first.token]) {
      for (const method of ["POST", "PATCH", "DELETE"]) {
        for (const path of [publicBase, `${publicBase}/${id}`, `${publicBase}/${id}/file`, `${publicBase}/${id}/thumbnail`]) {
          const response = await handleActivateRiApi(request(path, token, { method, headers: { origin } }), env);
          expect(response.status).toBe(405);
          publicHeaders(response);
        }
      }
    }
    expect(thumbnail).not.toHaveBeenCalled();
    expect(store).not.toHaveBeenCalled();
    expect(remove).not.toHaveBeenCalled();
    env.REMOTE_DATA_READ_ONLY = "true";
    expect((await handleActivateRiApi(request(publicBase), env)).status).toBe(200);
    const original = await handleActivateRiApi(request(`${publicBase}/${id}/file`), env);
    expect(new Uint8Array(await original.arrayBuffer())).toEqual(photo);
    expect((await handleActivateRiApi(parkPatch(id, first.token, { title: "Blocked edit" }), env)).status).toBe(403);
  });

  it("removes both the original and cached thumbnail and immediately hides deleted media publicly", async () => {
    const first = await owner();
    const id = await seedMedia(first.activatorId);
    const objectKey = `test/${id}`;
    const thumbnailKey = mediaThumbnails.mediaThumbnailKey(objectKey);
    objects.set(thumbnailKey, new Uint8Array([1, 2, 3]));
    const response = await handleActivateRiApi(request(`${base}/${id}`, first.token, { method: "DELETE", headers: { origin } }), env);
    expect(response.status).toBe(200);
    expect(remove).toHaveBeenCalledWith([objectKey, thumbnailKey]);
    expect(objects.size).toBe(0);
    for (const resource of ["file", "thumbnail"]) {
      expect((await handleActivateRiApi(request(`${publicBase}/${id}/${resource}`), env)).status).toBe(404);
    }
    const list = await handleActivateRiApi(request(publicBase), env);
    await expect(list.json()).resolves.toMatchObject({ media: [], nextCursor: null });
  });
});

describe("media author preferences", () => {
  it("defaults to the first name without requiring Ops Room membership or exposing private author fields", async () => {
    const user = await owner();
    await env.DB.prepare("UPDATE activate_ri_activators SET name = ? WHERE id = ?")
      .bind("Rob Jackson", user.activatorId).run();
    await env.DB.prepare("DELETE FROM activate_ri_ops_memberships WHERE activator_id = ?").bind(user.activatorId).run();
    const uploaded = await handleActivateRiApi(upload(user.token, { "x-media-author-label": "K1FAKE - Spoofed" }), env);
    expect(uploaded.status).toBe(201);
    const body = await uploaded.json() as { media: ActivatorMedia };
    expect(body.media).toMatchObject({ callsign: "N1OWN", authorLabel: "N1OWN - Rob" });
    expect(JSON.stringify(body)).not.toMatch(/Jackson|owner@example|activator_name|chat_display_name|email_normalized/);
    const list = await handleActivateRiApi(request(base, user.token), env);
    await expect(list.json()).resolves.toMatchObject({ media: [expect.objectContaining({ authorLabel: "N1OWN - Rob" })] });
  });

  it("uses the current custom, blank, or default author name across shared galleries and metadata edits", async () => {
    const [user, other] = await Promise.all([owner(), owner("other")]);
    await env.DB.prepare("UPDATE activate_ri_activators SET name = ? WHERE id = ?")
      .bind("Rob Jackson", user.activatorId).run();
    await setChatDisplayName(user.activatorId, "Rob J.");
    await setChatDisplayName(user.activatorId, "Unrelated event name", "another-event");
    await setChatDisplayName(other.activatorId, "Other activator name");
    const media = await uploadPhoto(user.token);
    expect(media.authorLabel).toBe("N1OWN - Rob J.");
    const adminHeaders = { "cf-access-authenticated-user-email": "organizer@example.invalid" };
    for (const [preference, expected] of [["", "N1OWN"], ["Rob J.", "N1OWN - Rob J."], [null, "N1OWN - Rob"]] as const) {
      await setChatDisplayName(user.activatorId, preference);
      for (const [path, token, headers] of [
        [base, user.token, {}], [base, other.token, {}], [adminBase, undefined, adminHeaders],
      ] as const) {
        const listed = await handleActivateRiApi(request(path, token, { headers }), env);
        expect(listed.status).toBe(200);
        const body = await listed.json() as { media: ActivatorMedia[] };
        expect(body.media).toHaveLength(1);
        expect(body.media[0].authorLabel).toBe(expected);
        expect(JSON.stringify(body)).not.toMatch(/Jackson|@example|activator_name|chat_display_name|Unrelated event|Other activator/);
      }
      for (const [path, token, headers] of [[base, user.token, {}], [adminBase, undefined, adminHeaders]] as const) {
        const edited = await handleActivateRiApi(parkPatch(media.id, token, { title: "A coastal activation" }, path, headers), env);
        expect(edited.status).toBe(200);
        await expect(edited.json()).resolves.toMatchObject({ media: { authorLabel: expected } });
      }
    }
    expect(store).toHaveBeenCalledTimes(1);
    const original = await handleActivateRiApi(request(media.url, user.token), env);
    expect(new Uint8Array(await original.arrayBuffer())).toEqual(photo);
  });

  it("uses a preference changed while the file is uploading in the upload response", async () => {
    const user = await owner();
    await setChatDisplayName(user.activatorId, "Before upload");
    store.mockImplementationOnce(async (_bucket, key, body) => {
      objects.set(key, new Uint8Array(await new Response(body).arrayBuffer()));
      await setChatDisplayName(user.activatorId, "After upload");
    });
    const media = await uploadPhoto(user.token);
    expect(media.authorLabel).toBe("N1OWN - After upload");
    const original = await handleActivateRiApi(request(media.url, user.token), env);
    expect(new Uint8Array(await original.arrayBuffer())).toEqual(photo);
  });
});

describe("editable media titles and descriptions", () => {
  it("returns current metadata when another field changes after the initial lookup", async () => {
    const user = await owner();
    const media = await uploadPhoto(user.token);
    const prepare = env.DB.prepare.bind(env.DB);
    vi.spyOn(env.DB, "prepare").mockImplementation((sql) => {
      if (sql.includes("title = ?") && sql.includes("RETURNING")) {
        return {
          bind: (...values: unknown[]) => ({
            first: async () => {
              await prepare("UPDATE activate_ri_media SET description = ? WHERE id = ?")
                .bind("Description saved by a competing edit.", media.id).run();
              await setChatDisplayName(user.activatorId, "Current name");
              return prepare(sql).bind(...values).first();
            },
          }),
        } as unknown as D1PreparedStatement;
      }
      return prepare(sql);
    });
    const response = await handleActivateRiApi(parkPatch(media.id, user.token, { title: "New title" }), env);
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ media: { title: "New title", description: "Description saved by a competing edit.", authorLabel: "N1OWN - Current name" } });
  });

  it("updates metadata independently, trims text, and preserves the file, upload time, and usage notice", async () => {
    const user = await owner();
    const media = await uploadPhoto(user.token);
    const stableColumns = "object_key, size, created_at, usage_notice_version";
    const before = await env.DB.prepare(`SELECT ${stableColumns} FROM activate_ri_media WHERE id = ?`).bind(media.id).first();
    const response = await handleActivateRiApi(parkPatch(media.id, user.token, {
      title: "  Beavertail activation  ", description: "  A sunny afternoon on 20 meters.  ", parkReference: "US-2868",
    }), env);
    expect(response.status).toBe(200);
    privateHeaders(response);
    await expect(response.json()).resolves.toMatchObject({ media: {
      title: "Beavertail activation", description: "A sunny afternoon on 20 meters.", parkReference: "US-2868", canEdit: true,
    } });
    const changed = await handleActivateRiApi(parkPatch(media.id, user.token, { title: "Sunset activation" }), env);
    expect(changed.status).toBe(200);
    await expect(changed.json()).resolves.toMatchObject({ media: { title: "Sunset activation", description: "A sunny afternoon on 20 meters.", parkReference: "US-2868" } });
    const cleared = await handleActivateRiApi(parkPatch(media.id, user.token, { title: null, description: "   " }), env);
    expect(cleared.status).toBe(200);
    await expect(cleared.json()).resolves.toMatchObject({ media: { title: null, description: null, parkReference: "US-2868" } });
    await expect(env.DB.prepare(`SELECT ${stableColumns} FROM activate_ri_media WHERE id = ?`).bind(media.id).first()).resolves.toEqual(before);
    expect(store).toHaveBeenCalledTimes(1);
    expect(remove).not.toHaveBeenCalled();
  });

  it("allows organizer metadata corrections without changing the usage notice", async () => {
    const user = await owner();
    const id = await seedMedia(user.activatorId);
    const response = await handleActivateRiApi(parkPatch(id, undefined, {
      title: "Organizer-corrected title", description: "At Beavertail.",
    }, adminBase, { "cf-access-authenticated-user-email": "organizer@example.invalid" }), env);
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ media: {
      title: "Organizer-corrected title", description: "At Beavertail.", canEdit: true,
    } });
    await expect(env.DB.prepare("SELECT usage_notice_version FROM activate_ri_media WHERE id = ?").bind(id).first())
      .resolves.toEqual({ usage_notice_version: usageNoticeVersion });
  });

  it.each([
    {}, { title: "x".repeat(121) }, { description: "x".repeat(2001) },
    { title: 1 }, { description: [] }, { title: "bad\u0000title" }, { description: "bad\u0000description" },
    { canEdit: true }, { activatorId: "another-activator" }, { usageNoticeVersion: "forged" },
    { authorLabel: "K1FAKE - Spoofed" }, { callsign: "K1FAKE" }, { chatDisplayName: "Spoofed" },
    { consentVersion: "ri-pota-media-v1" }, { title: "Title", unknown: "value" },
  ])("rejects invalid or self-authorized metadata %j without side effects", async (body) => {
    const user = await owner();
    const media = await uploadPhoto(user.token);
    const before = await env.DB.prepare("SELECT * FROM activate_ri_media WHERE id = ?").bind(media.id).first();
    const response = await handleActivateRiApi(parkPatch(media.id, user.token, body), env);
    expect(response.status).toBe(400);
    privateHeaders(response);
    await expect(env.DB.prepare("SELECT * FROM activate_ri_media WHERE id = ?").bind(media.id).first()).resolves.toEqual(before);
    expect(store).toHaveBeenCalledTimes(1);
    expect(remove).not.toHaveBeenCalled();
  });

  it("accepts titles and descriptions at their maximum length", async () => {
    const user = await owner();
    const media = await uploadPhoto(user.token);
    const response = await handleActivateRiApi(parkPatch(media.id, user.token, { title: "t".repeat(120), description: "d".repeat(2000) }), env);
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ media: { title: "t".repeat(120), description: "d".repeat(2000) } });
  });
});

describe("optional media park association", () => {
  it.each([null, ""])("keeps uploads with park header %j general", async (reference) => {
    const user = await owner();
    const response = await handleActivateRiApi(upload(user.token, { "x-media-park-reference": reference }), env);
    expect(response.status).toBe(201);
    const result = await response.json() as { media: ActivatorMedia };
    expect(result.media.parkReference).toBeNull();
    const list = await handleActivateRiApi(request(base, user.token), env);
    await expect(list.json()).resolves.toMatchObject({ media: [expect.objectContaining({ id: result.media.id, parkReference: null })] });
  });

  it("stores an optional park tag with the original upload", async () => {
    const user = await owner();
    const response = await handleActivateRiApi(upload(user.token, { "x-media-park-reference": "US-2868" }), env);
    expect(response.status).toBe(201);
    privateHeaders(response);
    const result = await response.json() as { media: ActivatorMedia };
    expect(result.media.parkReference).toBe("US-2868");
    await expect(env.DB.prepare("SELECT park_reference FROM activate_ri_media WHERE id = ?").bind(result.media.id).first())
      .resolves.toEqual({ park_reference: "US-2868" });
    const list = await handleActivateRiApi(request(base, user.token), env);
    await expect(list.json()).resolves.toMatchObject({ media: [expect.objectContaining({ id: result.media.id, parkReference: "US-2868" })] });
  });

  it.each(["US-0001", "US-999999", "us-2868"])("rejects an unsupported upload park %s before reserving storage", async (reference) => {
    const user = await owner();
    const response = await handleActivateRiApi(upload(user.token, { "x-media-park-reference": reference }), env);
    expect(response.status).toBe(400);
    privateHeaders(response);
    expect(store).not.toHaveBeenCalled();
    await expect(rowCount()).resolves.toBe(0);
  });

  it("lets an owner add, change, and clear a tag without rewriting the file or upload time", async () => {
    const user = await owner();
    const media = await uploadPhoto(user.token);
    const before = await env.DB.prepare("SELECT object_key, size, created_at FROM activate_ri_media WHERE id = ?").bind(media.id).first();
    for (const parkReference of ["US-2868", "US-0514", null]) {
      const response = await handleActivateRiApi(parkPatch(media.id, user.token, { parkReference }), env);
      expect(response.status).toBe(200);
      privateHeaders(response);
      await expect(response.json()).resolves.toMatchObject({ ok: true, media: { id: media.id, parkReference, createdAt: media.createdAt } });
      const list = await handleActivateRiApi(request(base, user.token), env);
      await expect(list.json()).resolves.toMatchObject({ media: [expect.objectContaining({ id: media.id, parkReference })] });
    }
    await expect(env.DB.prepare("SELECT object_key, size, created_at FROM activate_ri_media WHERE id = ?").bind(media.id).first()).resolves.toEqual(before);
    expect(store).toHaveBeenCalledTimes(1);
    expect(remove).not.toHaveBeenCalled();
    expect(get).not.toHaveBeenCalled();
    expect(head).not.toHaveBeenCalled();
    const file = await handleActivateRiApi(request(media.url, user.token), env);
    expect(new Uint8Array(await file.arrayBuffer())).toEqual(photo);
  });

  it("allows an authenticated organizer to correct a tag", async () => {
    const user = await owner();
    const media = await uploadPhoto(user.token);
    const adminHeaders = { "cf-access-authenticated-user-email": "organizer@example.invalid" };
    const response = await handleActivateRiApi(parkPatch(media.id, undefined, { parkReference: "US-0514" }, adminBase, adminHeaders), env);
    expect(response.status).toBe(200);
    privateHeaders(response);
    await expect(response.json()).resolves.toMatchObject({ media: { id: media.id, parkReference: "US-0514", url: `${adminBase}/${media.id}/file` } });
    for (const audience of [base, adminBase]) {
      const list = await handleActivateRiApi(request(audience, user.token, { headers: adminHeaders }), env);
      await expect(list.json()).resolves.toMatchObject({ media: [expect.objectContaining({ id: media.id, parkReference: "US-0514" })] });
    }
    expect(store).toHaveBeenCalledTimes(1);
    expect(remove).not.toHaveBeenCalled();
  });

  it("isolates tag edits from other activators and unauthenticated organizers", async () => {
    const [first, second] = await Promise.all([owner(), owner("other")]);
    const media = await uploadPhoto(first.token);
    for (const [token, routeBase, status] of [
      [second.token, base, 404], [undefined, base, 401], [undefined, adminBase, 401], [first.token, adminBase, 401],
    ] as const) {
      const response = await handleActivateRiApi(parkPatch(media.id, token, { parkReference: "US-2868" }, routeBase), env);
      expect(response.status).toBe(status);
      privateHeaders(response);
    }
    await expect(env.DB.prepare("SELECT park_reference FROM activate_ri_media WHERE id = ?").bind(media.id).first())
      .resolves.toEqual({ park_reference: null });
  });

  it("rejects tag edits with a missing or wrong Origin and in read-only mode", async () => {
    const user = await owner();
    const media = await uploadPhoto(user.token);
    for (const suppliedOrigin of [null, "https://untrusted.example"]) {
      const mutation = parkPatch(media.id, user.token, { parkReference: "US-2868" });
      if (suppliedOrigin) mutation.headers.set("origin", suppliedOrigin);
      else mutation.headers.delete("origin");
      expect((await handleActivateRiApi(mutation, env)).status).toBe(403);
    }
    env.REMOTE_DATA_READ_ONLY = "true";
    expect((await handleActivateRiApi(parkPatch(media.id, user.token, { parkReference: "US-2868" }), env)).status).toBe(403);
    await expect(env.DB.prepare("SELECT park_reference FROM activate_ri_media WHERE id = ?").bind(media.id).first())
      .resolves.toEqual({ park_reference: null });
  });

  it.each([{}, null, [], { parkReference: "" }, { parkReference: "US-0001" }, { parkReference: 2868 }, { parkReference: false }])(
    "rejects an invalid tag edit %j without changing metadata", async (body) => {
      const user = await owner();
      const media = await uploadPhoto(user.token);
      const response = await handleActivateRiApi(parkPatch(media.id, user.token, body), env);
      expect(response.status).toBe(400);
      privateHeaders(response);
      await expect(env.DB.prepare("SELECT park_reference FROM activate_ri_media WHERE id = ?").bind(media.id).first())
        .resolves.toEqual({ park_reference: null });
    },
  );

  it("bounds and validates JSON before applying a tag edit", async () => {
    const user = await owner();
    const media = await uploadPhoto(user.token);
    for (const [body, contentType, status] of [
      ["{broken", "application/json", 400],
      ['{"parkReference":"US-2868"}', "text/plain", 415],
      [JSON.stringify({ parkReference: "US-2868", extra: "x".repeat(65_536) }), "application/json", 413],
      [JSON.stringify({ parkReference: "US-2868", extra: "é".repeat(9_000) }), "application/json", 413],
    ] as const) {
      const response = await handleActivateRiApi(request(`${base}/${media.id}`, user.token, {
        method: "PATCH", headers: { origin, "content-type": contentType }, body,
      }), env);
      expect(response.status).toBe(status);
      privateHeaders(response);
    }
    const declaredOversize = parkPatch(media.id, user.token, { parkReference: "US-2868" }, base, { "content-length": "16385" });
    expect((await handleActivateRiApi(declaredOversize, env)).status).toBe(413);
    await expect(env.DB.prepare("SELECT park_reference FROM activate_ri_media WHERE id = ?").bind(media.id).first())
      .resolves.toEqual({ park_reference: null });
  });

  it.each(["uploading", "deleting"] as const)("does not edit %s uploads", async (state) => {
    const user = await owner();
    const id = await seedMedia(user.activatorId, { state });
    const response = await handleActivateRiApi(parkPatch(id, user.token, { parkReference: "US-2868" }), env);
    expect([404, 409]).toContain(response.status);
    await expect(env.DB.prepare("SELECT state, park_reference FROM activate_ri_media WHERE id = ?").bind(id).first())
      .resolves.toEqual({ state, park_reference: null });
    expect(store).not.toHaveBeenCalled();
    expect(remove).not.toHaveBeenCalled();
  });

});

describe("upload limits and recovery", () => {
  it.each([
    [{ "content-length": null }, 411], [{ "content-length": "-1" }, 400],
    [{ "content-length": "0" }, 400], [{ "content-length": "1.5" }, 400],
    [{ "content-length": String(mediaLimits.photoBytes + 1) }, 413],
    [{ "content-length": String(mediaLimits.videoBytes + 1), "x-media-filename": "video.mp4", "content-type": "video/mp4" }, 413],
    [{ "x-media-filename": "%broken" }, 400], [{ "x-media-filename": "..%2Fphoto.jpg" }, 400],
    [{ "x-media-filename": "image.svg", "content-type": "image/svg+xml" }, 400],
  ] as const)("rejects invalid upload headers %j before storage", async (headers, status) => {
    const user = await owner();
    const response = await handleActivateRiApi(upload(user.token, headers), env);
    expect(response.status).toBe(status);
    privateHeaders(response);
    expect(store).not.toHaveBeenCalled();
    await expect(rowCount()).resolves.toBe(0);
  });

  it("honors the upload limiter without reserving storage", async () => {
    const user = await owner();
    const limit = vi.fn(async () => ({ success: false }));
    env.MEDIA_UPLOAD_RATE_LIMIT = { limit } as RateLimit;
    const response = await handleActivateRiApi(upload(user.token), env);
    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("60");
    expect(limit).toHaveBeenCalledWith({ key: `${env.ACTIVATE_RI_EVENT_ID}:${user.activatorId}` });
    expect(store).not.toHaveBeenCalled();
    await expect(rowCount()).resolves.toBe(0);
  });

  it("accepts concurrent uploads beyond 50 files while retaining 50-item pagination", async () => {
    const user = await owner();
    for (let index = 0; index < 49; index++) await seedMedia(user.activatorId);
    const responses = await Promise.all([
      handleActivateRiApi(upload(user.token), env), handleActivateRiApi(upload(user.token), env),
    ]);
    expect(responses.map((response) => response.status)).toEqual([201, 201]);
    expect(store).toHaveBeenCalledTimes(2);
    await expect(rowCount()).resolves.toBe(51);
    const first = await handleActivateRiApi(request(`${base}?scope=mine`, user.token), env);
    const page = await first.json() as { media: ActivatorMedia[]; nextCursor: string; usage: { files: number; bytes: number }; limits: unknown };
    expect(page.media).toHaveLength(50);
    expect(page.nextCursor).toBeTruthy();
    expect(page.usage).toEqual({ files: 51, bytes: 51 * photo.length });
    expect(page.limits).toEqual({ photoBytes: 20 * 1024 * 1024, videoBytes: 80 * 1024 * 1024 });
    const second = await handleActivateRiApi(request(`${base}?scope=mine&cursor=${encodeURIComponent(page.nextCursor)}`, user.token), env);
    const last = await second.json() as { media: ActivatorMedia[]; nextCursor: null };
    expect(last.media).toHaveLength(1);
    expect(last.nextCursor).toBeNull();
    expect(new Set([...page.media, ...last.media].map((media) => media.id)).size).toBe(51);
  });

  it("accepts uploads beyond 500 MiB and still reports in-flight and deleting storage", async () => {
    const user = await owner();
    for (let index = 0; index < 26; index++) await seedMedia(user.activatorId, { size: mediaLimits.photoBytes });
    await seedMedia(user.activatorId, { state: "uploading", size: mediaLimits.photoBytes });
    await seedMedia(user.activatorId, { state: "deleting", size: mediaLimits.photoBytes });
    const response = await handleActivateRiApi(upload(user.token), env);
    expect(response.status).toBe(201);
    expect(store).toHaveBeenCalledTimes(1);
    const list = await handleActivateRiApi(request(`${base}?scope=mine`, user.token), env);
    const body = await list.json() as { media: ActivatorMedia[]; usage: { files: number; bytes: number } };
    expect(body.media).toHaveLength(27);
    expect(body.usage).toEqual({ files: 29, bytes: 28 * mediaLimits.photoBytes + photo.length });
  });

  it("releases a reservation after content validation fails", async () => {
    const user = await owner();
    store.mockRejectedValueOnce(new mediaStorage.MediaUploadError("Invalid container"));
    const response = await handleActivateRiApi(upload(user.token), env);
    expect(response.status).toBe(400);
    await expect(rowCount()).resolves.toBe(0);
    expect(remove).toHaveBeenCalledTimes(1);
  });

  it("removes a stored object if publishing its metadata fails", async () => {
    const user = await owner();
    const prepare = env.DB.prepare.bind(env.DB);
    vi.spyOn(env.DB, "prepare").mockImplementation((sql) => {
      if (sql.includes("SET state = 'ready'")) {
        return { bind: () => ({ run: async () => { throw new Error("D1 unavailable"); } }) } as unknown as D1PreparedStatement;
      }
      return prepare(sql);
    });
    const response = await handleActivateRiApi(upload(user.token), env);
    expect(response.status).toBe(503);
    privateHeaders(response);
    expect(objects.size).toBe(0);
    await expect(rowCount()).resolves.toBe(0);
  });

  it("preserves a completed object if D1 commits finalization but its response is lost", async () => {
    const user = await owner();
    const prepare = env.DB.prepare.bind(env.DB);
    vi.spyOn(env.DB, "prepare").mockImplementation((sql) => {
      if (sql.includes("SET state = 'ready'")) {
        return {
          bind: (...values: unknown[]) => ({
            run: async () => {
              await prepare(sql).bind(...values).run();
              throw new Error("D1 response lost after commit");
            },
          }),
        } as unknown as D1PreparedStatement;
      }
      return prepare(sql);
    });
    const response = await handleActivateRiApi(upload(user.token), env);
    expect(response.status).toBe(503);
    expect(remove).not.toHaveBeenCalled();
    expect(objects.size).toBe(1);
    const list = await handleActivateRiApi(request(base, user.token), env);
    const result = await list.json() as { media: ActivatorMedia[] };
    expect(result.media).toHaveLength(1);
    const file = await handleActivateRiApi(request(result.media[0].url, user.token), env);
    expect(file.status).toBe(200);
    expect(new Uint8Array(await file.arrayBuffer())).toEqual(photo);
  });

  it("retains an upload reservation for cleanup when R2 and immediate cleanup fail", async () => {
    const user = await owner();
    store.mockRejectedValueOnce(new Error("R2 upload unavailable"));
    remove.mockRejectedValueOnce(new Error("R2 delete unavailable"));
    const response = await handleActivateRiApi(upload(user.token), env);
    expect(response.status).toBe(503);
    await expect(rowCount()).resolves.toBe(1);
    await expect(env.DB.prepare("SELECT state FROM activate_ri_media").first()).resolves.toEqual({ state: "deleting" });
    const list = await handleActivateRiApi(request(base, user.token), env);
    await expect(list.json()).resolves.toMatchObject({ media: [], usage: { files: 1, bytes: photo.length } });
    const later = new Date(Date.now() + 25 * 60 * 60 * 1000);
    await expect(mediaStorage.cleanupMediaUploads(env, later)).resolves.toBe(1);
    await expect(rowCount()).resolves.toBe(0);
  });

  it("keeps failed deletions hidden and retries their object cleanup", async () => {
    const user = await owner();
    const media = await uploadPhoto(user.token);
    remove.mockRejectedValueOnce(new Error("R2 unavailable"));
    const deletion = await handleActivateRiApi(request(`${base}/${media.id}`, user.token, { method: "DELETE", headers: { origin } }), env);
    expect(deletion.status).toBe(503);
    expect((await handleActivateRiApi(request(media.url, user.token), env)).status).toBe(404);
    const list = await handleActivateRiApi(request(base, user.token), env);
    await expect(list.json()).resolves.toMatchObject({ media: [], usage: { files: 1, bytes: photo.length } });
    const later = new Date(Date.now() + 25 * 60 * 60 * 1000);
    await expect(mediaStorage.cleanupMediaUploads(env, later)).resolves.toBe(1);
    expect(objects.size).toBe(0);
    await expect(rowCount()).resolves.toBe(0);
  });

  it("cleans only stale unfinished uploads for this event and respects read-only mode", async () => {
    const user = await owner();
    const old = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString();
    await seedMedia(user.activatorId, { state: "uploading", createdAt: old });
    await seedMedia(user.activatorId, { state: "ready", createdAt: old });
    await seedMedia(user.activatorId, { state: "uploading" });
    await seedMedia(user.activatorId, { state: "uploading", createdAt: old, eventId: "other-event" });
    env.REMOTE_DATA_READ_ONLY = "true";
    await expect(mediaStorage.cleanupMediaUploads(env)).resolves.toBe(0);
    expect(remove).not.toHaveBeenCalled();
    env.REMOTE_DATA_READ_ONLY = "false";
    await expect(mediaStorage.cleanupMediaUploads(env)).resolves.toBe(1);
    expect(remove).toHaveBeenCalledTimes(1);
    await expect(rowCount()).resolves.toBe(3);
  });

  it("does not delete an upload that finishes after the cleanup scan", async () => {
    const user = await owner();
    const old = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString();
    const id = await seedMedia(user.activatorId, { state: "uploading", createdAt: old });
    const prepare = env.DB.prepare.bind(env.DB);
    vi.spyOn(env.DB, "prepare").mockImplementation((sql) => {
      if (sql.includes("SET state = 'deleting'") && sql.includes("updated_at < ?")) {
        return {
          bind: (...values: unknown[]) => ({
            run: async () => {
              await prepare("UPDATE activate_ri_media SET state = 'ready', updated_at = ? WHERE id = ?")
                .bind(new Date().toISOString(), id).run();
              return prepare(sql).bind(...values).run();
            },
          }),
        } as unknown as D1PreparedStatement;
      }
      return prepare(sql);
    });
    await expect(mediaStorage.cleanupMediaUploads(env)).resolves.toBe(0);
    expect(remove).not.toHaveBeenCalled();
    expect(objects.size).toBe(1);
    await expect(env.DB.prepare("SELECT state FROM activate_ri_media WHERE id = ?").bind(id).first())
      .resolves.toEqual({ state: "ready" });
  });

  it("returns a private availability error when storage is unconfigured", async () => {
    const user = await owner();
    delete env.ACTIVATOR_MEDIA;
    const response = await handleActivateRiApi(upload(user.token), env);
    expect(response.status).toBe(503);
    privateHeaders(response);
    await expect(rowCount()).resolves.toBe(0);
  });
});

describe("authenticated content responses", () => {
  it.each([
    ["bytes=0-1", 0, 2], ["bytes=10-", 10, photo.length - 10],
    ["bytes=-4", photo.length - 4, 4], ["bytes=0-999", 0, photo.length],
  ])("serves video-compatible range %s with exact content headers", async (range, offset, length) => {
    const user = await owner();
    const media = await uploadPhoto(user.token);
    const response = await handleActivateRiApi(request(media.url, user.token, { headers: { range } }), env);
    expect(response.status).toBe(206);
    privateHeaders(response);
    expect(response.headers.get("accept-ranges")).toBe("bytes");
    expect(response.headers.get("content-range")).toBe(`bytes ${offset}-${offset + length - 1}/${photo.length}`);
    expect(response.headers.get("content-length")).toBe(String(length));
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(photo.slice(offset, offset + length));
  });

  it.each(["bytes=999-", "bytes=-0", "bytes=5-1", "bytes=0-1,4-5", "bytes=9007199254740992-", "garbage"])(
    "rejects invalid or unsatisfiable range %s", async (range) => {
      const user = await owner();
      const media = await uploadPhoto(user.token);
      const response = await handleActivateRiApi(request(media.url, user.token, { headers: { range } }), env);
      expect(response.status).toBe(416);
      privateHeaders(response);
      expect(response.headers.get("content-range")).toBe(`bytes */${photo.length}`);
      expect(get).not.toHaveBeenCalled();
    },
  );

  it("serves a full response for If-Range and a bodyless HEAD response", async () => {
    const user = await owner();
    const media = await uploadPhoto(user.token);
    const full = await handleActivateRiApi(request(media.url, user.token, { headers: { range: "bytes=0-1", "if-range": '"old-version"' } }), env);
    expect(full.status).toBe(200);
    expect(full.headers.has("content-range")).toBe(false);
    expect(new Uint8Array(await full.arrayBuffer())).toEqual(photo);
    get.mockClear();
    const metadata = await handleActivateRiApi(request(media.url, user.token, { method: "HEAD", headers: { range: "bytes=0-1" } }), env);
    expect(metadata.status).toBe(200);
    privateHeaders(metadata);
    expect(metadata.headers.get("content-length")).toBe(String(photo.length));
    expect(await metadata.text()).toBe("");
    expect(get).not.toHaveBeenCalled();
    expect(head).toHaveBeenCalledTimes(1);
  });

  it("does not expose objects absent from the ready metadata set", async () => {
    const user = await owner();
    for (const state of ["uploading", "deleting"] as const) {
      const id = await seedMedia(user.activatorId, { state });
      expect((await handleActivateRiApi(request(`${base}/${id}/file`, user.token), env)).status).toBe(404);
    }
    expect(get).not.toHaveBeenCalled();
    const media = await uploadPhoto(user.token);
    objects.clear();
    const response = await handleActivateRiApi(request(media.url, user.token), env);
    expect(response.status).toBe(404);
    privateHeaders(response);
  });
});
