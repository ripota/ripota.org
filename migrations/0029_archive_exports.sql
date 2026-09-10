CREATE TABLE analytics_archive_exports (
  id TEXT PRIMARY KEY,
  scope TEXT NOT NULL,
  prefix TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('running', 'complete', 'failed')),
  started_at TEXT NOT NULL,
  finished_at TEXT,
  table_count INTEGER,
  row_count INTEGER,
  error_category TEXT NOT NULL DEFAULT ''
);
