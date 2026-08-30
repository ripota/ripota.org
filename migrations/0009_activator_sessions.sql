CREATE TABLE activate_ri_activator_sessions (
  token_hash TEXT PRIMARY KEY,
  event_id TEXT NOT NULL,
  activator_id TEXT NOT NULL
    REFERENCES activate_ri_activators(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  last_used_at TEXT,
  revoked_at TEXT
);

CREATE INDEX activate_ri_activator_sessions_actor_idx
  ON activate_ri_activator_sessions(event_id, activator_id);

CREATE INDEX activate_ri_activator_sessions_expiry_idx
  ON activate_ri_activator_sessions(expires_at);

INSERT OR IGNORE INTO activate_ri_edit_tokens (
  token_hash,
  activator_id,
  event_id,
  created_at,
  last_sent_at,
  revoked_at
)
SELECT
  magic_token_hash,
  id,
  event_id,
  created_at,
  last_magic_link_sent_at,
  NULL
FROM activate_ri_activators
WHERE magic_token_hash IS NOT NULL;

UPDATE activate_ri_activators
SET magic_token_hash = NULL
WHERE magic_token_hash IS NOT NULL;
