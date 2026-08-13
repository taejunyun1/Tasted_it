CREATE TABLE place_liveness_states (
  place_id TEXT PRIMARY KEY NOT NULL REFERENCES places(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'MONITORING' CHECK(status IN ('VERIFIED', 'MONITORING', 'SUSPECTED', 'HIDDEN')),
  kakao_status TEXT NOT NULL DEFAULT 'SKIPPED' CHECK(kakao_status IN ('MATCHED', 'AMBIGUOUS', 'NOT_FOUND', 'ERROR', 'SKIPPED')),
  matched_kakao_place_id TEXT,
  match_score REAL,
  consecutive_not_found INTEGER NOT NULL DEFAULT 0 CHECK(consecutive_not_found >= 0),
  first_not_found_at TEXT,
  last_matched_at TEXT,
  last_checked_at TEXT,
  next_check_at TEXT,
  recommendation_excluded INTEGER NOT NULL DEFAULT 0 CHECK(recommendation_excluded IN (0, 1)),
  protected_until TEXT,
  lease_token TEXT,
  lease_expires_at TEXT,
  evidence_json TEXT NOT NULL DEFAULT '{}',
  updated_at TEXT NOT NULL
);

CREATE INDEX place_liveness_due_idx
  ON place_liveness_states(next_check_at, lease_expires_at);
CREATE INDEX place_liveness_status_idx
  ON place_liveness_states(status, recommendation_excluded);
