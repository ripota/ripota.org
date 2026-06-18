CREATE TABLE activate_ri_edit_tokens (
  token_hash TEXT PRIMARY KEY,
  activator_id TEXT NOT NULL REFERENCES activate_ri_activators(id) ON DELETE CASCADE,
  event_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  last_sent_at TEXT,
  revoked_at TEXT
);

INSERT INTO activate_ri_edit_tokens (
  token_hash,
  activator_id,
  event_id,
  created_at,
  last_sent_at
)
SELECT
  magic_token_hash,
  id,
  event_id,
  created_at,
  last_magic_link_sent_at
FROM activate_ri_activators
WHERE magic_token_hash IS NOT NULL;

CREATE INDEX activate_ri_edit_tokens_activator_idx
  ON activate_ri_edit_tokens(activator_id, event_id);

CREATE INDEX activate_ri_edit_tokens_active_idx
  ON activate_ri_edit_tokens(event_id, token_hash)
  WHERE revoked_at IS NULL;
