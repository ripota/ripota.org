-- Editorial selection is separate from successful upload/public visibility.
ALTER TABLE activate_ri_media ADD COLUMN featured_on_recap INTEGER NOT NULL DEFAULT 0
  CHECK (featured_on_recap IN (0, 1) AND (featured_on_recap = 0 OR kind = 'photo'));

CREATE INDEX activate_ri_media_featured_idx
  ON activate_ri_media(event_id, created_at DESC, id DESC)
  WHERE featured_on_recap = 1 AND state = 'ready' AND kind = 'photo';
