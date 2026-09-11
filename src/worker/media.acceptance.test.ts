import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";
import { mediaLimits, type ActivatorMedia } from "../lib/activate-ri/media";
import { createUserWithVerifiedEmail, linkActivatorMembership } from "./auth/db";
import { createAuthSession } from "./auth/session";
import { insertPendingPlan } from "./db";
import type { Env } from "./env";
import * as mediaStorage from "./media";
import { handleActivateRiApi } from "./routes/activate-ri";
import { createMigratedSqliteD1 } from "./test-utils/sqlite-d1";

const origin = "https://ripota.org";
const base = "/api/activate-ri-2026/activator/media";
const adminBase = "/api/activate-ri-2026/admin/media";
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
  remove = vi.fn(async (key: string) => { objects.delete(key); });
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

function upload(token?: string, overrides: Record<string, string | null> = {}): Request {
  const headers = new Headers({
    origin, "content-type": "image/jpeg", "content-length": String(photo.length),
    "x-media-filename": encodeURIComponent("Activation — café.jpg"),
  });
  for (const [name, value] of Object.entries(overrides)) {
    if (value === null) headers.delete(name);
    else headers.set(name, value);
  }
  return request(base, token, { method: "POST", headers, body: photo });
}

async function uploadPhoto(token: string): Promise<ActivatorMedia> {
  const response = await handleActivateRiApi(upload(token), env);
  expect(response.status).toBe(201);
  const result = await response.json() as { media: ActivatorMedia };
  return result.media;
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
} = {}): Promise<string> {
  const id = crypto.randomUUID();
  const createdAt = options.createdAt ?? new Date().toISOString();
  const key = `test/${id}`;
  await env.DB.prepare(`INSERT INTO activate_ri_media
    (id, event_id, activator_id, object_key, filename, content_type, kind, size, state, created_at, updated_at)
    VALUES (?, ?, ?, ?, 'photo.jpg', 'image/jpeg', 'photo', ?, ?, ?, ?)`)
    .bind(id, options.eventId ?? env.ACTIVATE_RI_EVENT_ID, activatorId, key,
      options.size ?? photo.length, options.state ?? "ready", createdAt, createdAt).run();
  objects.set(key, photo);
  return id;
}

describe("private activator media", () => {
  it("uploads, lists, downloads and removes an owner's photo", async () => {
    const user = await owner();
    const media = await uploadPhoto(user.token);
    expect(media).toMatchObject({ filename: "Activation — café.jpg", kind: "photo", size: photo.length, callsign: "N1OWN" });
    expect(media).not.toHaveProperty("object_key");
    const list = await handleActivateRiApi(request(base, user.token), env);
    privateHeaders(list);
    await expect(list.json()).resolves.toMatchObject({ ok: true, media: [media], usage: { files: 1, bytes: photo.length }, limits: mediaLimits });

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

  it("does not disclose or mutate another activator's upload", async () => {
    const [first, second] = await Promise.all([owner(), owner("other")]);
    const media = await uploadPhoto(first.token);
    const list = await handleActivateRiApi(request(base, second.token), env);
    await expect(list.json()).resolves.toMatchObject({ media: [], usage: { files: 0, bytes: 0 } });
    for (const method of ["GET", "HEAD", "DELETE"]) {
      const path = method === "DELETE" ? `${base}/${media.id}` : media.url;
      const denied = await handleActivateRiApi(request(path, second.token, { method, headers: { origin } }), env);
      expect(denied.status).toBe(404);
      privateHeaders(denied);
    }
    expect(get).not.toHaveBeenCalled();
    expect(head).not.toHaveBeenCalled();
    expect(remove).not.toHaveBeenCalled();
    await expect(rowCount()).resolves.toBe(1);
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

describe("upload limits and recovery", () => {
  it.each([
    [{ "content-length": null }, 411], [{ "content-length": "-1" }, 400],
    [{ "content-length": "0" }, 400], [{ "content-length": "1.5" }, 400],
    [{ "content-length": String(mediaLimits.photoBytes + 1) }, 413],
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

  it("reserves quota atomically when two uploads compete for the final slot", async () => {
    const user = await owner();
    for (let index = 0; index < 49; index++) await seedMedia(user.activatorId);
    const responses = await Promise.all([
      handleActivateRiApi(upload(user.token), env), handleActivateRiApi(upload(user.token), env),
    ]);
    expect(responses.map((response) => response.status).sort()).toEqual([201, 409]);
    expect(store).toHaveBeenCalledTimes(1);
    await expect(rowCount()).resolves.toBe(50);
  });

  it("counts in-flight and deleting files toward the byte quota", async () => {
    const user = await owner();
    await seedMedia(user.activatorId, { state: "uploading", size: mediaLimits.totalBytes - photo.length + 1 });
    const response = await handleActivateRiApi(upload(user.token), env);
    expect(response.status).toBe(409);
    expect(store).not.toHaveBeenCalled();
    await env.DB.prepare("UPDATE activate_ri_media SET state = 'deleting'").run();
    expect((await handleActivateRiApi(upload(user.token), env)).status).toBe(409);
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
