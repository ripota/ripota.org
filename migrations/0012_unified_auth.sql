CREATE TABLE auth_users (
  id TEXT PRIMARY KEY,
  webauthn_user_id TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  disabled_at TEXT
);

CREATE TABLE auth_user_emails (
  user_id TEXT NOT NULL REFERENCES auth_users(id) ON DELETE CASCADE,
  email_normalized TEXT NOT NULL UNIQUE,
  is_primary INTEGER NOT NULL DEFAULT 1 CHECK (is_primary IN (0, 1)),
  verified_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (user_id, email_normalized)
);

CREATE UNIQUE INDEX auth_user_emails_one_primary_idx
  ON auth_user_emails(user_id)
  WHERE is_primary = 1;

CREATE TABLE auth_passkey_credentials (
  id TEXT PRIMARY KEY,
  credential_id TEXT NOT NULL UNIQUE,
  user_id TEXT NOT NULL REFERENCES auth_users(id) ON DELETE CASCADE,
  public_key BLOB NOT NULL,
  counter INTEGER NOT NULL DEFAULT 0,
  device_type TEXT NOT NULL CHECK (device_type IN ('singleDevice', 'multiDevice')),
  backed_up INTEGER NOT NULL DEFAULT 0 CHECK (backed_up IN (0, 1)),
  transports_json TEXT NOT NULL DEFAULT '[]',
  label TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  last_used_at TEXT,
  revoked_at TEXT
);

CREATE INDEX auth_passkeys_user_idx
  ON auth_passkey_credentials(user_id, revoked_at);

CREATE TABLE auth_sessions (
  id TEXT PRIMARY KEY,
  token_hash TEXT NOT NULL UNIQUE,
  user_id TEXT NOT NULL REFERENCES auth_users(id) ON DELETE CASCADE,
  purpose TEXT NOT NULL CHECK (purpose IN ('authenticated', 'enrollment', 'recovery')),
  authentication_method TEXT NOT NULL CHECK (
    authentication_method IN ('passkey', 'email', 'legacy-link', 'legacy-session', 'access-bootstrap')
  ),
  authenticated_at TEXT NOT NULL,
  passkey_verified_at TEXT,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  last_used_at TEXT,
  revoked_at TEXT
);

CREATE INDEX auth_sessions_user_idx
  ON auth_sessions(user_id, revoked_at);

CREATE INDEX auth_sessions_expiry_idx
  ON auth_sessions(expires_at);

CREATE TABLE auth_webauthn_challenges (
  id TEXT PRIMARY KEY,
  challenge TEXT NOT NULL UNIQUE,
  ceremony TEXT NOT NULL CHECK (ceremony IN ('authentication', 'registration')),
  user_id TEXT REFERENCES auth_users(id) ON DELETE CASCADE,
  session_id TEXT REFERENCES auth_sessions(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  used_at TEXT
);

CREATE INDEX auth_challenges_expiry_idx
  ON auth_webauthn_challenges(expires_at);

CREATE TABLE auth_email_tokens (
  token_hash TEXT PRIMARY KEY,
  purpose TEXT NOT NULL CHECK (purpose IN ('login', 'account-claim', 'passkey-reset')),
  email_normalized TEXT NOT NULL,
  user_id TEXT REFERENCES auth_users(id) ON DELETE CASCADE,
  activator_id TEXT REFERENCES activate_ri_activators(id) ON DELETE CASCADE,
  created_by_user_id TEXT REFERENCES auth_users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  used_at TEXT
);

CREATE INDEX auth_email_tokens_expiry_idx
  ON auth_email_tokens(expires_at);

CREATE TABLE auth_event_roles (
  user_id TEXT NOT NULL REFERENCES auth_users(id) ON DELETE CASCADE,
  event_id TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('admin')),
  granted_by_user_id TEXT REFERENCES auth_users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL,
  revoked_at TEXT,
  PRIMARY KEY (user_id, event_id, role)
);

CREATE TABLE auth_activator_memberships (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES auth_users(id) ON DELETE CASCADE,
  event_id TEXT NOT NULL,
  activator_id TEXT NOT NULL REFERENCES activate_ri_activators(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  revoked_at TEXT
);

CREATE UNIQUE INDEX auth_activator_membership_activator_idx
  ON auth_activator_memberships(event_id, activator_id)
  WHERE revoked_at IS NULL;

CREATE UNIQUE INDEX auth_activator_membership_user_idx
  ON auth_activator_memberships(event_id, user_id)
  WHERE revoked_at IS NULL;

CREATE TABLE auth_audit_events (
  id TEXT PRIMARY KEY,
  event_id TEXT,
  actor_user_id TEXT REFERENCES auth_users(id) ON DELETE SET NULL,
  subject_user_id TEXT REFERENCES auth_users(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  summary TEXT NOT NULL,
  details_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL
);

CREATE INDEX auth_audit_events_created_idx
  ON auth_audit_events(created_at);

CREATE INDEX auth_audit_events_subject_idx
  ON auth_audit_events(subject_user_id, created_at);
