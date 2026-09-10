import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { evidenceTables, sha256, type ArchiveManifest } from "../lib/analytics/archive";
import { runAfterActionArchive } from "./after-action-archive";
import type { Env } from "./env";
import { createMigratedSqliteD1 } from "./test-utils/sqlite-d1";

const databases: ReturnType<typeof createMigratedSqliteD1>[] = [];
const today = new Date("2026-09-10T13:43:00.000Z");
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(today);
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  databases.splice(0).forEach(context => context.close());
  vi.useRealTimers();
  vi.restoreAllMocks();
});

function setup() {
  const context = createMigratedSqliteD1();
  databases.push(context);
  const objects = new Map<string, { body: string; metadata: Record<string, string> }>();
  const put = vi.fn(async (key: string, value: string, options: R2PutOptions) => {
    if (objects.has(key)) return null;
    expect(options.onlyIf).toEqual({ etagDoesNotMatch: "*" });
    expect(options.sha256).toBe(await sha256(value));
    objects.set(key, { body: value, metadata: options.customMetadata ?? {} });
    return { key } as R2Object;
  });
  const head = vi.fn(async (key: string) => {
    const object = objects.get(key);
    return object ? { key, size: Buffer.byteLength(object.body), customMetadata: object.metadata } as R2Object : null;
  });
  const env = { DB: context.DB, EVENT_ARCHIVES: { put, head } } as unknown as Env;
  return { env, objects, put, head };
}

describe("scheduled after-action snapshots", () => {
  it("publishes verified evidence and manifest before marking one snapshot per UTC day complete", async () => {
    const { env, objects, put } = setup();
    await runAfterActionArchive(env, today.valueOf());
    const row = await env.DB.prepare("SELECT * FROM analytics_archive_exports").first<Record<string, unknown>>();
    expect(row).toMatchObject({ id: "activate-ri-2026:2026-09-10", status: "complete", table_count: evidenceTables.length });
    const manifestKey = `${row!.prefix}/manifest.json`;
    expect([...objects.keys()].at(-1)).toBe(manifestKey);
    const manifest = JSON.parse(objects.get(manifestKey)!.body) as ArchiveManifest;
    expect(row!.row_count).toBe(manifest.tables.reduce((sum, table) => sum + table.rows, 0));
    for (const file of manifest.files) {
      const stored = objects.get(file.key)!;
      expect(Buffer.byteLength(stored.body)).toBe(file.bytes);
      expect(await sha256(stored.body)).toBe(file.sha256);
      expect(stored.metadata.retainUntil).toBe("2027-01-01T00:00:00.000Z");
    }
    const firstWrites = put.mock.calls.length;
    await runAfterActionArchive(env, today.valueOf() + 3_600_000);
    expect(put).toHaveBeenCalledTimes(firstWrites);
    vi.setSystemTime(new Date("2026-09-11T00:43:00.000Z"));
    await runAfterActionArchive(env, Date.now());
    expect((await env.DB.prepare("SELECT status FROM analytics_archive_exports").all()).results).toEqual([{ status: "complete" }, { status: "complete" }]);
    expect(put.mock.calls.length).toBe(firstWrites * 2);
  });

  it("leaves no complete manifest after failure and retries under a fresh prefix", async () => {
    const { env, objects, put } = setup();
    const ordinaryPut = put.getMockImplementation()!;
    put.mockImplementation(async (...args) => {
      if (args[0].includes("/analytics_anonymous_events/")) throw new Error("Synthetic R2 failure");
      return ordinaryPut(...args);
    });
    await expect(runAfterActionArchive(env, today.valueOf())).rejects.toThrow("Synthetic R2 failure");
    const failed = await env.DB.prepare("SELECT * FROM analytics_archive_exports").first<Record<string, unknown>>();
    expect(failed).toMatchObject({ status: "failed", error_category: "export" });
    expect(objects.has(`${failed!.prefix}/manifest.json`)).toBe(false);
    put.mockImplementation(ordinaryPut);
    vi.setSystemTime(new Date(today.valueOf() + 3_600_000));
    await runAfterActionArchive(env, Date.now());
    const complete = await env.DB.prepare("SELECT * FROM analytics_archive_exports").first<Record<string, unknown>>();
    expect(complete).toMatchObject({ status: "complete", error_category: "" });
    expect(complete!.prefix).not.toBe(failed!.prefix);
    expect(objects.has(`${complete!.prefix}/manifest.json`)).toBe(true);
  });

  it("rejects an object whose verification metadata or size does not match", async () => {
    const { env, objects, head } = setup();
    head.mockResolvedValueOnce({ size: 1, customMetadata: { sha256: "bad" } } as unknown as R2Object);
    await expect(runAfterActionArchive(env, today.valueOf())).rejects.toThrow("verification failed");
    expect((await env.DB.prepare("SELECT status FROM analytics_archive_exports").first())?.status).toBe("failed");
    expect([...objects.keys()].some(key => key.endsWith("/manifest.json"))).toBe(false);
  });

  it("does not steal an active claim but retries a crashed claim after thirty minutes", async () => {
    const { env, put } = setup();
    await env.DB.prepare("INSERT INTO analytics_archive_exports(id,scope,prefix,status,started_at) VALUES(?,?,?,?,?)")
      .bind("activate-ri-2026:2026-09-10", "activate-ri-2026", "activate-ri-2026/old", "running", today.toISOString()).run();
    await runAfterActionArchive(env, today.valueOf());
    expect(put).not.toHaveBeenCalled();
    vi.setSystemTime(new Date(today.valueOf() + 31 * 60_000));
    await runAfterActionArchive(env, Date.now());
    expect((await env.DB.prepare("SELECT status FROM analytics_archive_exports").first())?.status).toBe("complete");
  });

  it("does not let a replaced lease complete the replacement's unfinished snapshot", async () => {
    const { env, objects, put } = setup();
    const ordinaryPut = put.getMockImplementation()!;
    let startedFirst!: () => void;
    let startedSecond!: () => void;
    let releaseFirst!: () => void;
    let releaseSecond!: () => void;
    const firstStarted = new Promise<void>(resolve => { startedFirst = resolve; });
    const secondStarted = new Promise<void>(resolve => { startedSecond = resolve; });
    const firstGate = new Promise<void>(resolve => { releaseFirst = resolve; });
    const secondGate = new Promise<void>(resolve => { releaseSecond = resolve; });
    let started = 0;
    put.mockImplementation(async (...args) => {
      if (args[0].endsWith("/park-catalog.json")) {
        started += 1;
        if (started === 1) { startedFirst(); await firstGate; }
        else if (started === 2) { startedSecond(); await secondGate; }
      }
      return ordinaryPut(...args);
    });
    const first = runAfterActionArchive(env, today.valueOf());
    await firstStarted;
    vi.setSystemTime(new Date(today.valueOf() + 31 * 60_000));
    const second = runAfterActionArchive(env, Date.now());
    await secondStarted;
    try {
      releaseFirst();
      await first;
      const row = await env.DB.prepare("SELECT status,prefix FROM analytics_archive_exports").first<Record<string, unknown>>();
      expect(objects.has(`${row!.prefix}/manifest.json`)).toBe(false);
      expect(row!.status).toBe("running");
    } finally {
      releaseFirst();
      releaseSecond();
      await Promise.allSettled([first, second]);
    }
    expect((await env.DB.prepare("SELECT status FROM analytics_archive_exports").first())?.status).toBe("complete");
  });

  it("keeps September 30 snapshots but stops at October 1 without deleting retained evidence", async () => {
    const { env, objects, put } = setup();
    const lastSeptemberRun = Date.parse("2026-09-30T23:43:00.000Z");
    vi.setSystemTime(lastSeptemberRun);
    await runAfterActionArchive(env, Date.now());
    const writes = put.mock.calls.length;
    const retained = [...objects.entries()];
    expect(writes).toBeGreaterThan(0);

    vi.setSystemTime(new Date("2026-10-01T00:00:00.000Z"));
    await runAfterActionArchive(env, Date.now());
    // A delayed September invocation must also stop once October arrives.
    await runAfterActionArchive(env, lastSeptemberRun - 86_400_000);
    // The month-limited cron must not resume snapshots in a later year.
    vi.setSystemTime(new Date("2027-09-01T00:43:00.000Z"));
    await runAfterActionArchive(env, Date.now());

    expect(put).toHaveBeenCalledTimes(writes);
    expect([...objects.entries()]).toEqual(retained);
    expect((await env.DB.prepare("SELECT id,status FROM analytics_archive_exports").all()).results)
      .toEqual([{ id: "activate-ri-2026:2026-09-30", status: "complete" }]);
  });

  it("skips missing buckets", async () => {
    const { env, put } = setup();
    delete env.EVENT_ARCHIVES;
    await runAfterActionArchive(env, today.valueOf());
    expect(put).not.toHaveBeenCalled();
    expect((await env.DB.prepare("SELECT * FROM analytics_archive_exports").all()).results).toEqual([]);
  });
});
