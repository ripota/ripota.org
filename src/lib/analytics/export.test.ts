import { describe, expect, it, vi } from "vitest";
import { parseExportOptions, readAnalyticsHistory } from "../../../scripts/analytics-export";
import { exportAfterActionEvidence, type ArchiveQuery } from "./archive";
import { createMigratedSqliteD1 } from "../../worker/test-utils/sqlite-d1";

describe("manual analytics export options", () => {
  it("normalizes explicit intervals and preserves destination and legacy/upload flags", () => {
    expect(parseExportOptions(["--since", "2026-09-10T08:00:00-04:00", "--until", "2026-09-10T13:01:02.999Z", "--directory", "/tmp/private evidence", "--upload", "--legacy-only"]))
      .toEqual({ since: "2026-09-10T12:00:00.000Z", until: "2026-09-10T13:01:02.000Z", directory: "/tmp/private evidence", upload: true, legacyOnly: true });
  });
  it("freezes the default upper bound at invocation time", () => {
    expect(parseExportOptions([], new Date("2026-09-10T14:00:00.999Z"))).toMatchObject({ until: "2026-09-10T14:00:00.000Z", upload: false, legacyOnly: false });
  });
  it.each([
    ["--since"], ["--until", "--upload"], ["--unknown"],
    ["--since", "bad"], ["--since", "2026-09-11", "--until", "2026-09-10"],
    ["--since", "2026-09-10T00:00:00.001Z", "--until", "2026-09-10T00:00:00.999Z"],
  ].map(args => ({ args })))("rejects an invalid or empty normalized interval: $args", ({ args }) => {
    expect(() => parseExportOptions(args)).toThrow();
  });
});

describe("bounded Analytics Engine history extraction", () => {
  it("keeps short results unchanged without extra requests", async () => {
    const rows = [{ timestamp: "2026-09-10 00:00:00", _sample_interval: 7, double1: 1 }];
    const query = vi.fn(async () => rows);
    expect(await readAnalyticsHistory(query, "2026-09-10T00:00:00.000Z", "2026-09-10T00:00:04.000Z")).toEqual(rows);
    expect(query).toHaveBeenCalledOnce();
  });
  it("subdivides a capped response into disjoint second-precision intervals without using capped parent rows", async () => {
    const start = "2026-09-10T00:00:00.000Z";
    const middle = "2026-09-10T00:00:02.000Z";
    const end = "2026-09-10T00:00:04.000Z";
    const query = vi.fn(async (since: string, until: string) => {
      if (since === start && until === end) return Array.from({ length: 10_000 }, () => ({ id: "capped-parent" }));
      return since === start ? [{ id: "left", _sample_interval: 1 }] : [{ id: "right", _sample_interval: 3 }];
    });
    expect(await readAnalyticsHistory(query, start, end)).toEqual([{ id: "left", _sample_interval: 1 }, { id: "right", _sample_interval: 3 }]);
    expect(query.mock.calls).toEqual([[start, end], [start, middle], [middle, end]]);
  });
  it("fails instead of silently accepting a capped one-second response", async () => {
    const query = async () => Array.from({ length: 10_000 }, () => ({}));
    await expect(readAnalyticsHistory(query, "2026-09-10T00:00:00.000Z", "2026-09-10T00:00:01.000Z")).rejects.toThrow("incomplete");
  });
  it("propagates a failing subrange without returning a partial history", async () => {
    const query = vi.fn(async (since: string, until: string) => {
      if (until === "2026-09-10T00:00:04.000Z" && since.endsWith("00.000Z")) return Array.from({ length: 10_000 }, () => ({}));
      if (since.endsWith("02.000Z")) throw new Error("upstream unavailable");
      return [{ id: "left" }];
    });
    await expect(readAnalyticsHistory(query, "2026-09-10T00:00:00.000Z", "2026-09-10T00:00:04.000Z")).rejects.toThrow("upstream unavailable");
  });
});

describe("D1 evidence pagination", () => {
  it("exports scoped rows once across rowid gaps and excludes rows added after the table boundary", async () => {
    const context = createMigratedSqliteD1();
    try {
      const insert = async (id: string, scope = "activate-ri-2026") => context.DB.prepare(`INSERT INTO analytics_anonymous_events
        (scope,subject_hash,event_id,event_name,schema_version,occurred_at,received_at,properties_json)
        VALUES (?, 'subject', ?, 'hunter_checklist_resumed', 1, '2026-09-10T00:00:00.000Z', '2026-09-10T00:00:00.000Z', '{}')`).bind(scope, id).run();
      await insert("one");
      await insert("other", "another-scope");
      await insert("two");
      await insert("three");
      let insertedLate = false;
      const query: ArchiveQuery = async (sql, bindings) => {
        const result = await context.DB.prepare(sql).bind(...bindings).all<Record<string, unknown>>();
        if (!insertedLate && sql.includes("COUNT(*)") && sql.includes("analytics_anonymous_events")) {
          insertedLate = true;
          await insert("late");
        }
        return result.results;
      };
      const files = new Map<string, string>();
      const manifest = await exportAfterActionEvidence(query, async (key, body) => { files.set(key, body); }, { prefix: "activate-ri-2026/test/pagination", pageSize: 2 });
      const table = manifest.tables.find(table => table.name === "analytics_anonymous_events");
      expect(table).toMatchObject({ rows: 3, highWaterRowid: 4 });
      const pages = manifest.files.filter(file => file.key.includes("/analytics_anonymous_events/"));
      expect(pages.map(file => file.rows)).toEqual([2, 1]);
      const rows = pages.flatMap(file => JSON.parse(files.get(file.key)!) as { event_id: string }[]);
      expect(rows.map(row => row.event_id)).toEqual(["one", "two", "three"]);
      expect(manifest.consistency).toContain("high-water");
      expect((await context.DB.prepare("SELECT COUNT(*) AS count FROM analytics_anonymous_events").first())?.count).toBe(5);
    } finally {
      context.close();
    }
  });
});
