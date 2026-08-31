type RequiredBindings = Pick<
  Cloudflare.Env,
  "ACTIVATE_RI_EVENT_ID" | "ASSETS" | "DB"
>;

type OptionalBindings = Partial<Pick<
  Cloudflare.Env,
  | "ACTIVATE_RI_OPS_ROOM"
  | "ANALYTICS"
  | "AUTH_EMAIL_RATE_LIMIT"
  | "AUTH_RATE_LIMIT_BURST"
  | "CLIENT_ERROR_RATE_LIMIT"
  | "EMAIL"
  | "OPS_RATE_LIMIT_BURST"
  | "OPS_RATE_LIMIT_SUSTAINED"
>>;

export type Env = RequiredBindings & OptionalBindings & {
  ANALYTICS_HASH_KEY?: string;
  TURNSTILE_REQUIRED?: "true" | "false";
  TURNSTILE_SECRET_KEY?: string;
  ACTIVATE_RI_EMAIL_FROM?: string;
  ACTIVATE_RI_EMAIL_FROM_NAME?: string;
  ACTIVATE_RI_ADMIN_EMAILS?: string;
  SITE_ORIGIN?: string;
  ACTIVATE_RI_OPS_HARD_DISABLED?: "true" | "false";
  CF_ACCESS_TEAM_DOMAIN?: string;
  CF_ACCESS_AUD?: string;
  ALLOW_ADMIN_HEADER_AUTH?: "true" | "false";
  ALLOW_LOCAL_ADMIN_AUTH?: "true" | "false";
  LOCAL_ADMIN_EMAIL?: string;
  REMOTE_DATA_READ_ONLY?: "true" | "false";
  AUTH_ADMIN_MODE?: "access" | "dual" | "passkey";
  AUTH_ACTIVATOR_MODE?: "legacy" | "dual" | "unified";
  AUTH_EMAIL_LOGIN_ENABLED?: "true" | "false";
  AUTH_LEGACY_LINK_ISSUANCE_ENABLED?: "true" | "false";
  AUTH_BOOTSTRAP_ADMIN_EMAILS?: string;
  AUTH_ADMIN_REAUTH_SECONDS?: string;
};
