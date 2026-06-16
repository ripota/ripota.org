#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import process from "node:process";

const testSiteKey = "1x00000000000000000000AA";

const result = spawnSync("npm", ["run", "build", "--", ...process.argv.slice(2)], {
  env: {
    ...process.env,
    WRANGLER_ENV: "local",
    PUBLIC_TURNSTILE_SITE_KEY:
      process.env.PUBLIC_TURNSTILE_SITE_KEY?.trim() || testSiteKey,
  },
  shell: process.platform === "win32",
  stdio: "inherit",
});

if (result.error) {
  throw result.error;
}

process.exit(result.status ?? 1);
