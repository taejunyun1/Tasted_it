CREATE TABLE naver_local_category_verifications (
  business_license_id TEXT PRIMARY KEY NOT NULL REFERENCES business_licenses(id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK(status IN ('VERIFIED','LIKELY','AMBIGUOUS','NO_MATCH','OUT_OF_SCOPE','FAILED','SKIPPED')),
  mapped_category_id TEXT REFERENCES categories(id) ON DELETE SET NULL,
  match_score INTEGER NOT NULL CHECK(match_score BETWEEN 0 AND 100),
  specificity_score INTEGER NOT NULL CHECK(specificity_score BETWEEN 0 AND 20),
  confidence_score INTEGER NOT NULL CHECK(confidence_score BETWEEN 0 AND 100),
  evidence_codes_json TEXT NOT NULL,
  rule_version TEXT NOT NULL,
  input_fingerprint TEXT NOT NULL,
  queried_at TEXT NOT NULL,
  expires_at TEXT,
  failure_code TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX naver_local_category_verifications_status_queried_idx
  ON naver_local_category_verifications(status, queried_at);
CREATE INDEX naver_local_category_verifications_expiry_idx
  ON naver_local_category_verifications(expires_at);

CREATE TABLE naver_local_category_runs (
  id TEXT PRIMARY KEY,
  mode TEXT NOT NULL CHECK(mode IN ('PREVIEW','APPLY')),
  scope TEXT NOT NULL CHECK(scope IN ('PENDING','PUBLISHED')),
  status TEXT NOT NULL CHECK(status IN ('RUNNING','COMPLETED','FAILED','SKIPPED')),
  after_business_license_id TEXT,
  requested_limit INTEGER NOT NULL CHECK(requested_limit BETWEEN 1 AND 100),
  scanned_count INTEGER NOT NULL DEFAULT 0,
  verified_count INTEGER NOT NULL DEFAULT 0,
  change_count INTEGER NOT NULL DEFAULT 0,
  conflict_count INTEGER NOT NULL DEFAULT 0,
  failed_count INTEGER NOT NULL DEFAULT 0,
  api_call_count INTEGER NOT NULL DEFAULT 0,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  error_code TEXT,
  created_by TEXT REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX naver_local_category_runs_status_started_idx
  ON naver_local_category_runs(status, started_at);
