import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

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
    const backupIndex = task.indexOf("mise run backup-production");
    const migrationIndex = task.indexOf("d1 migrations apply", backupIndex);
    const deployIndex = task.indexOf('deploy "${base_env[@]}"', migrationIndex);

    expect(backupIndex).toBeGreaterThan(-1);
    expect(backupIndex).toBeLessThan(migrationIndex);
    expect(migrationIndex).toBeLessThan(deployIndex);
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

describe("share card asset tasks", () => {
  it("defines an Activate RI share card task with force support and metadata output", () => {
    const task = readTask("assets/activate-ri-share-card");

    expect(task).toContain('description="Regenerate the Activate RI 2026 social share card image"');
    expect(task).toContain('#USAGE flag "--force"');
    expect(task).toContain('#USAGE flag "--local-stops"');
    expect(task).toContain("scripts/activate-ri-2026/render-share-card.mjs");
    expect(task).not.toContain("#MISE outputs=");
  });
});

describe("workspace tasks", () => {
  it("creates a jj workspace and hydrates only reusable local state", () => {
    const task = readTask("workspace/create");

    expect(task).toContain('jj workspace add --name "${WORKSPACE_NAME}"');
    expect(task).toContain('#USAGE flag "--name <name>"');
    expect(task).toContain('#USAGE flag "--parent-workspace <workspace>"');
    expect(task).toContain('#USAGE complete "parent-workspace"');
    expect(task).not.toContain("#USAGE arg");
    expect(task).toContain("target.current_working_copy()");
    expect(task).toContain('PARENT_WORKSPACE="${usage_parent_workspace:-${CURRENT_WORKSPACE}}"');
    expect(task).toContain('REVISION="${usage_revision:-${PARENT_WORKSPACE}@}"');
    expect(task).not.toContain("workspace root --name default");
    expect(task).toContain('jj --repository "${SOURCE_ROOT}" log');
    expect(task).toContain('cmp -s "${SOURCE_ROOT}/package-lock.json"');
    expect(task).toContain('cp -cR "${source_path}" "${destination_path}"');
    expect(task).toContain("npm install --prefer-offline --no-audit --no-fund");
    expect(task).toContain('#USAGE flag "--with-wrangler-state"');
    expect(task).not.toContain('copy_seed_path "${SOURCE_ROOT}/dist"');
    expect(task).not.toContain('copy_seed_path "${SOURCE_ROOT}/tmp"');
  });

  it("has valid bash syntax", () => {
    const taskPath = new URL("../mise/tasks/workspace/create", import.meta.url);
    const result = spawnSync("bash", ["-n", taskPath.pathname], { encoding: "utf8" });

    expect(result.stderr).toBe("");
    expect(result.status).toBe(0);
  });
});
