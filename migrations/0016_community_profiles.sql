CREATE TABLE auth_community_profiles (
  user_id TEXT PRIMARY KEY REFERENCES auth_users(id) ON DELETE CASCADE,
  callsign_normalized TEXT NOT NULL,
  callsign_display TEXT NOT NULL,
  public_name TEXT NOT NULL DEFAULT '',
  callsign_claim_status TEXT NOT NULL CHECK (
    callsign_claim_status IN ('self-asserted', 'event-linked', 'moderator-reviewed')
  ),
  callsign_claim_active INTEGER NOT NULL DEFAULT 1 CHECK (
    callsign_claim_active IN (0, 1)
  ),
  callsign_claimed_at TEXT NOT NULL,
  callsign_released_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK (length(callsign_normalized) BETWEEN 3 AND 24),
  CHECK (length(callsign_display) BETWEEN 3 AND 24),
  CHECK (length(public_name) <= 80),
  CHECK (
    (callsign_claim_active = 1 AND callsign_released_at IS NULL) OR
    (callsign_claim_active = 0 AND callsign_released_at IS NOT NULL)
  )
);

CREATE UNIQUE INDEX auth_community_profiles_active_callsign_idx
  ON auth_community_profiles(callsign_normalized)
  WHERE callsign_claim_active = 1;

CREATE INDEX auth_community_profiles_public_idx
  ON auth_community_profiles(callsign_claim_active, callsign_display);

CREATE TABLE auth_site_roles (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES auth_users(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('moderator')),
  granted_by_user_id TEXT REFERENCES auth_users(id) ON DELETE SET NULL,
  granted_at TEXT NOT NULL,
  revoked_by_user_id TEXT REFERENCES auth_users(id) ON DELETE SET NULL,
  revoked_at TEXT,
  CHECK (
    (revoked_at IS NULL AND revoked_by_user_id IS NULL) OR
    revoked_at IS NOT NULL
  )
);

CREATE UNIQUE INDEX auth_site_roles_active_role_idx
  ON auth_site_roles(user_id, role)
  WHERE revoked_at IS NULL;

CREATE INDEX auth_site_roles_user_history_idx
  ON auth_site_roles(user_id, role, granted_at);
