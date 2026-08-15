ALTER TABLE place_liveness_states ADD COLUMN naver_status TEXT NOT NULL DEFAULT 'SKIPPED'
  CHECK(naver_status IN ('MATCHED', 'AMBIGUOUS', 'NOT_FOUND', 'ERROR', 'SKIPPED'));
ALTER TABLE place_liveness_states ADD COLUMN naver_match_score REAL;
ALTER TABLE place_liveness_states ADD COLUMN naver_evidence_codes_json TEXT NOT NULL DEFAULT '[]';
ALTER TABLE place_liveness_states ADD COLUMN naver_last_checked_at TEXT;

CREATE INDEX place_liveness_naver_status_idx ON place_liveness_states(naver_status, naver_last_checked_at);
