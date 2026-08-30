ALTER TABLE auth_sessions ADD COLUMN ceremony_challenge_id TEXT;
ALTER TABLE auth_sessions ADD COLUMN source_email_token_hash TEXT;

CREATE UNIQUE INDEX auth_sessions_ceremony_challenge_idx
  ON auth_sessions(ceremony_challenge_id)
  WHERE ceremony_challenge_id IS NOT NULL;

CREATE UNIQUE INDEX auth_sessions_source_email_token_idx
  ON auth_sessions(source_email_token_hash)
  WHERE source_email_token_hash IS NOT NULL;
