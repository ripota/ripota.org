-- Supersede the announcement-only opt-in with an overall email preference
-- and a separate opt-in for every message. No preferences means announcements on.
CREATE TABLE activate_ri_ops_email_preferences (
  event_id TEXT NOT NULL,
  email_normalized TEXT NOT NULL,
  email_enabled INTEGER NOT NULL DEFAULT 1 CHECK (email_enabled IN (0, 1)),
  chat_messages INTEGER NOT NULL DEFAULT 0 CHECK (chat_messages IN (0, 1)),
  author_key TEXT NOT NULL,
  admin_user_id TEXT REFERENCES auth_users(id) ON DELETE SET NULL,
  local_admin INTEGER NOT NULL DEFAULT 0 CHECK (local_admin IN (0, 1)),
  updated_at TEXT NOT NULL,
  PRIMARY KEY (event_id, email_normalized)
);

ALTER TABLE activate_ri_ops_messages
  ADD COLUMN email_broadcast_requested INTEGER NOT NULL DEFAULT 0;

CREATE TABLE activate_ri_ops_email_deliveries (
  message_id TEXT NOT NULL REFERENCES activate_ri_ops_messages(id) ON DELETE CASCADE,
  event_id TEXT NOT NULL,
  email_normalized TEXT NOT NULL,
  is_admin INTEGER NOT NULL,
  category TEXT NOT NULL CHECK (category IN ('announcement', 'chat')),
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'sending', 'sent', 'failed', 'skipped')),
  attempt_count INTEGER NOT NULL DEFAULT 0,
  next_attempt_at TEXT NOT NULL,
  claim_token TEXT,
  last_error TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  sent_at TEXT,
  PRIMARY KEY (message_id, email_normalized)
);
CREATE INDEX activate_ri_ops_email_deliveries_due_idx
  ON activate_ri_ops_email_deliveries(event_id, status, next_attempt_at);
