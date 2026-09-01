import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import process from "node:process";

export default function globalSetup(): () => void {
  const buildEnv = { ...process.env };
  delete buildEnv.RIPOTA_E2E_BUILD_READY;

  run("npm", ["run", "build:local"], buildEnv);

  process.env.RIPOTA_E2E_BUILD_READY = "1";

  const databaseTemplate = mkdtempSync(join(tmpdir(), "ripota-e2e-d1-template-"));
  try {
    run("./node_modules/.bin/wrangler", [
      "d1",
      "migrations",
      "apply",
      "ripota-org",
      "--local",
      "--env",
      "local",
      "--persist-to",
      databaseTemplate,
    ]);
  } catch (error) {
    rmSync(databaseTemplate, { recursive: true, force: true });
    throw error;
  }

  process.env.RIPOTA_E2E_D1_TEMPLATE = databaseTemplate;

  return () => {
    rmSync(databaseTemplate, { recursive: true, force: true });
  };
}

function run(command: string, args: string[], env = process.env): void {
  const result = spawnSync(command, args, {
    cwd: process.cwd(),
    env,
    shell: process.platform === "win32",
    stdio: "inherit",
  });

  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(`${command} failed with status ${result.status}.`);
  }
}
