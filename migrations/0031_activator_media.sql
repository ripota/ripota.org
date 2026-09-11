CREATE TABLE activate_ri_media (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL,
  activator_id TEXT NOT NULL REFERENCES activate_ri_activators(id),
  object_key TEXT NOT NULL UNIQUE,
  filename TEXT NOT NULL,
  content_type TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('photo', 'video')),
  size INTEGER NOT NULL CHECK (size > 0),
  state TEXT NOT NULL CHECK (state IN ('uploading', 'ready', 'deleting')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX activate_ri_media_owner_idx ON activate_ri_media(event_id, activator_id, state);
CREATE INDEX activate_ri_media_gallery_idx ON activate_ri_media(event_id, state, created_at DESC, id DESC);
