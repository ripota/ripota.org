ALTER TABLE activate_ri_ops_memberships
  ADD COLUMN email_announcements INTEGER NOT NULL DEFAULT 0
  CHECK (email_announcements IN (0, 1));

ALTER TABLE activate_ri_ops_email_recipients ADD COLUMN skipped_at TEXT;
ALTER TABLE activate_ri_ops_email_broadcasts
  ADD COLUMN skipped_count INTEGER NOT NULL DEFAULT 0;
