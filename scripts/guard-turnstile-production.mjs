#!/usr/bin/env node

import { execFileSync } from "node:child_process";

const mode = process.argv.includes("--required") ? "required" : "if-production";

function envNameFromCommand(command) {
  const tokens = command.split(/\s+/).filter(Boolean);

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];

    if (token === "--env" || token === "-e") {
      return tokens[index + 1];
    }

    if (token.startsWith("--env=")) {
      return token.slice("--env=".length);
    }

    if (token.startsWith("-e=")) {
      return token.slice("-e=".length);
    }
  }

  return undefined;
}

function parentProcessCommand(pid) {
  const output = execFileSync("ps", ["-o", "ppid=", "-o", "command=", "-p", String(pid)], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  }).trim();

  const match = output.match(/^(\d+)\s+([\s\S]+)$/);
  if (!match) {
    return undefined;
  }

  return {
    ppid: Number.parseInt(match[1], 10),
    command: match[2],
  };
}

function inferWranglerEnvFromParents() {
  if (!process.env.WRANGLER_COMMAND) {
    return undefined;
  }

  let pid = process.ppid;

  for (let depth = 0; depth < 8 && pid > 1; depth += 1) {
    let parent;

    try {
      parent = parentProcessCommand(pid);
    } catch {
      return undefined;
    }

    if (!parent) {
      return undefined;
    }

    const envName = envNameFromCommand(parent.command);
    if (envName) {
      return envName;
    }

    pid = parent.ppid;
  }

  return undefined;
}

const selectedWranglerEnv =
  process.env.WRANGLER_ENV?.trim() ||
  process.env.CLOUDFLARE_ENV?.trim() ||
  inferWranglerEnvFromParents();

const localBuildRequested = selectedWranglerEnv === "local";

const productionBuildRequested =
  !localBuildRequested &&
  (mode === "required" ||
    process.env.MODE === "production" ||
    selectedWranglerEnv === "production" ||
    process.env.CF_PAGES === "1" ||
    process.env.CF_PAGES === "true");

if (!productionBuildRequested) {
  process.exit(0);
}

const value = process.env.PUBLIC_TURNSTILE_SITE_KEY?.trim() ?? "";

const blockedValues = new Set([
  "",
  "1x00000000000000000000AA",
  "2x00000000000000000000AB",
  "3x00000000000000000000FF",
  "REPLACE_WITH_PRODUCTION_TURNSTILE_SITE_KEY",
]);

if (blockedValues.has(value)) {
  console.error(
    [
      "Production deploy requires PUBLIC_TURNSTILE_SITE_KEY at build time.",
      "Pass the real Cloudflare Turnstile site key in the deploy environment.",
      "The always-pass test key and repository placeholder are blocked.",
    ].join("\n"),
  );
  process.exit(1);
}
