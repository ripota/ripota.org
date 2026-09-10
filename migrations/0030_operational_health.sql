-- Coarse incident observations only. No request, browser, actor, URL, message,
-- exception, or stack identifiers are retained in this daily aggregate.
CREATE TABLE operational_health_daily (
  scope TEXT NOT NULL CHECK (scope = 'activate-ri-2026'),
  day TEXT NOT NULL,
  category TEXT NOT NULL CHECK (category IN (
    'browser_error', 'browser_resource', 'browser_unhandledrejection',
    'worker_exception', 'worker_response_5xx', 'scheduled_pota',
    'scheduled_archive', 'scheduled_spot_cleanup', 'auth_cleanup',
    'ops_email_delivery', 'ops_email_drain', 'legacy_auth_upgrade', 'feature_analytics'
  )),
  count INTEGER NOT NULL DEFAULT 1,
  first_seen_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  PRIMARY KEY (scope, day, category)
);
INSERT INTO analytics_collection_metadata (scope, stream, started_at)
VALUES ('activate-ri-2026', 'operational_health', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));
-- No automatic purge; these counts accompany the event's verified archives.
