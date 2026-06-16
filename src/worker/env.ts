export type Env = {
  ASSETS: Fetcher;
  DB: D1Database;
  ACTIVATE_RI_EVENT_ID: "activate-ri-2026";
  TURNSTILE_REQUIRED?: "true" | "false";
  TURNSTILE_SECRET_KEY?: string;
  CF_ACCESS_TEAM_DOMAIN?: string;
  CF_ACCESS_AUD?: string;
  ALLOW_ADMIN_HEADER_AUTH?: "true" | "false";
};
