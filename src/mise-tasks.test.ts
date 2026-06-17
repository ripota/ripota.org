import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const readTask = (name: string): string =>
  readFileSync(new URL(`../mise/tasks/${name}`, import.meta.url), "utf8");

describe("production database backup tasks", () => {
  it("defines a production backup task that exports remote D1 into ignored tmp storage", () => {
    const task = readTask("backup-production");

    expect(task).toContain("npx wrangler");
    expect(task).toContain("d1 export");
    expect(task).toContain("--remote");
    expect(task).toContain("--env \"\"");
    expect(task).toContain("tmp/d1-backups");
    expect(task).toContain("d1 time-travel info");
  });

  it("backs up production before deploy applies remote migrations", () => {
    const task = readTask("deploy");

    expect(task.indexOf("mise run backup-production")).toBeGreaterThan(-1);
    expect(task.indexOf("mise run backup-production")).toBeLessThan(
      task.indexOf("d1 migrations apply"),
    );
    expect(task.indexOf("d1 migrations apply")).toBeLessThan(
      task.indexOf("deploy \"${base_env[@]}\""),
    );
  });

  it("backs up production before database-only remote migrations", () => {
    const task = readTask("d1/migrate-production");

    expect(task.indexOf("mise run backup-production")).toBeGreaterThan(-1);
    expect(task.indexOf("mise run backup-production")).toBeLessThan(
      task.indexOf("d1 migrations apply"),
    );
    expect(task).toContain("--remote");
    expect(task).toContain("--env \"\"");
  });
});
