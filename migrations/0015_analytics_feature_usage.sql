CREATE TABLE analytics_feature_usage (
  scope TEXT NOT NULL,
  subject_type TEXT NOT NULL,
  subject_id TEXT NOT NULL,
  feature TEXT NOT NULL,
  first_used_at TEXT NOT NULL,
  last_used_at TEXT NOT NULL,
  use_count INTEGER NOT NULL DEFAULT 1 CHECK (use_count > 0),
  PRIMARY KEY (scope, subject_type, subject_id, feature)
);

CREATE INDEX analytics_feature_usage_report_idx
  ON analytics_feature_usage(scope, feature, last_used_at);
