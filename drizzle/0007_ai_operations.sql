CREATE TABLE ai_classification_runs (
  id TEXT PRIMARY KEY NOT NULL,
  candidate_id TEXT NOT NULL REFERENCES business_licenses(id) ON DELETE CASCADE,
  input_hash TEXT NOT NULL,
  model TEXT NOT NULL,
  prompt_version TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('SUCCESS','FAILED')),
  category_slug TEXT,
  confidence REAL,
  reasons_json TEXT,
  validation_error TEXT,
  cached_from_id TEXT REFERENCES ai_classification_runs(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX ai_classification_candidate_created_idx ON ai_classification_runs(candidate_id, created_at);
CREATE INDEX ai_classification_hash_created_idx ON ai_classification_runs(input_hash, created_at);
CREATE INDEX ai_classification_status_created_idx ON ai_classification_runs(status, created_at);

CREATE TABLE operational_alerts (
  id TEXT PRIMARY KEY NOT NULL,
  alert_type TEXT NOT NULL CHECK(alert_type IN ('PUBLIC_DATA_SYNC','AI_CLASSIFICATION','RATING_RECOMPUTE')),
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
CREATE INDEX operational_alerts_status_last_idx ON operational_alerts(status, last_occurred_at);
