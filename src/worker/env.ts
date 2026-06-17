export type Env = {
  ASSETS: Fetcher;
  DB: D1Database;
  EMAIL?: SendEmail;
  ACTIVATE_RI_EVENT_ID: "activate-ri-2026";
  TURNSTILE_REQUIRED?: "true" | "false";
  TURNSTILE_SECRET_KEY?: string;
  ACTIVATE_RI_EMAIL_FROM?: string;
  ACTIVATE_RI_EMAIL_FROM_NAME?: string;
  ACTIVATE_RI_ADMIN_EMAILS?: string;
  CF_ACCESS_TEAM_DOMAIN?: string;
  CF_ACCESS_AUD?: string;
  ALLOW_ADMIN_HEADER_AUTH?: "true" | "false";
};
