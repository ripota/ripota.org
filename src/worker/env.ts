export type Env = {
  ASSETS: Fetcher;
  DB: D1Database;
  ACTIVATE_RI_EVENT_ID: "activate-ri-2026";
  TURNSTILE_REQUIRED: "true" | "false";
  TURNSTILE_SECRET_KEY?: string;
};
