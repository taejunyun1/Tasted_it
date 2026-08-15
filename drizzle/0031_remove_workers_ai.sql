DROP TABLE ai_classification_runs;

CREATE TABLE operational_alerts_next (
  id TEXT PRIMARY KEY NOT NULL,
  alert_type TEXT NOT NULL CHECK(alert_type IN ('PUBLIC_DATA_SYNC','RATING_RECOMPUTE','NAVER_LOCAL_SEARCH')),
  severity TEXT NOT NULL CHECK(severity IN ('WARNING','ERROR')),
  status TEXT NOT NULL DEFAULT 'OPEN' CHECK(status IN ('OPEN','RESOLVED')),
  source_id TEXT,
  message TEXT NOT NULL,
  details_json TEXT NOT NULL,
  occurrence_count INTEGER NOT NULL DEFAULT 1,
  first_occurred_at TEXT NOT NULL,
  last_occurred_at TEXT NOT NULL,
  resolved_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  resolved_at TEXT,
  resolution_note TEXT
);

INSERT INTO operational_alerts_next (
  id, alert_type, severity, status, source_id, message, details_json,
  occurrence_count, first_occurred_at, last_occurred_at, resolved_by, resolved_at, resolution_note
)
SELECT
  id, alert_type, severity, status, source_id, message, details_json,
  occurrence_count, first_occurred_at, last_occurred_at, resolved_by, resolved_at, resolution_note
FROM operational_alerts
WHERE alert_type <> 'AI_CLASSIFICATION';

DROP TABLE operational_alerts;
ALTER TABLE operational_alerts_next RENAME TO operational_alerts;
CREATE INDEX operational_alerts_status_last_idx ON operational_alerts(status, last_occurred_at);
