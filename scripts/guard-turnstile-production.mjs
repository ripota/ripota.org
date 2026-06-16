#!/usr/bin/env node

const mode = process.argv.includes("--required") ? "required" : "if-production";

const productionBuildRequested =
  mode === "required" ||
  process.env.MODE === "production" ||
  process.env.WRANGLER_ENV === "production" ||
  process.env.CF_PAGES === "1" ||
  process.env.CF_PAGES === "true";

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
