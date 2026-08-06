ALTER TABLE places ADD COLUMN last_verified_at TEXT;
ALTER TABLE places ADD COLUMN closed_at TEXT;

CREATE TABLE place_suggestions (
  id TEXT PRIMARY KEY NOT NULL, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  status TEXT NOT NULL DEFAULT 'SUBMITTED' CHECK(status IN ('SUBMITTED','NEEDS_INFO','REVIEWING','APPROVED','REJECTED','DUPLICATE')),
  name TEXT NOT NULL, normalized_name TEXT NOT NULL, address TEXT NOT NULL, normalized_address TEXT NOT NULL,
  neighborhood TEXT NOT NULL, latitude REAL, longitude REAL, phone TEXT,
  category_id TEXT NOT NULL REFERENCES categories(id) ON DELETE RESTRICT, description TEXT,
  duplicate_override_reason TEXT, approved_place_id TEXT REFERENCES places(id) ON DELETE SET NULL,
  review_reason TEXT, reviewed_by TEXT REFERENCES users(id) ON DELETE SET NULL, reviewed_at TEXT,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE INDEX place_suggestions_user_status_idx ON place_suggestions(user_id,status);
CREATE INDEX place_suggestions_status_created_idx ON place_suggestions(status,created_at);

CREATE TABLE place_correction_requests (
  id TEXT PRIMARY KEY NOT NULL, place_id TEXT REFERENCES places(id) ON DELETE SET NULL,
  requester_user_id TEXT REFERENCES users(id) ON DELETE SET NULL, requester_email TEXT NOT NULL,
  requester_relation TEXT NOT NULL, request_type TEXT NOT NULL CHECK(request_type IN ('INFORMATION','MOVED','TEMPORARILY_CLOSED','CLOSED','RIGHTS','OTHER')),
  status TEXT NOT NULL DEFAULT 'PENDING_VERIFICATION' CHECK(status IN ('PENDING_VERIFICATION','SUBMITTED','REVIEWING','APPLIED','REJECTED')),
  requested_changes_json TEXT NOT NULL, evidence_note TEXT, verification_token_hash TEXT UNIQUE,
  verification_expires_at TEXT, verified_at TEXT, admin_response TEXT,
  reviewed_by TEXT REFERENCES users(id) ON DELETE SET NULL, reviewed_at TEXT,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE INDEX place_corrections_status_created_idx ON place_correction_requests(status,created_at);
CREATE INDEX place_corrections_place_idx ON place_correction_requests(place_id);

CREATE TABLE place_duplicate_candidates (
  id TEXT PRIMARY KEY NOT NULL, suggestion_id TEXT REFERENCES place_suggestions(id) ON DELETE CASCADE,
  left_place_id TEXT REFERENCES places(id) ON DELETE CASCADE, right_place_id TEXT NOT NULL REFERENCES places(id) ON DELETE CASCADE,
  confidence TEXT NOT NULL CHECK(confidence IN ('EXACT','HIGH','MEDIUM')), distance_meters REAL, reasons_json TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'OPEN' CHECK(status IN ('OPEN','DISMISSED','MERGED')),
  resolved_by TEXT REFERENCES users(id) ON DELETE SET NULL, resolved_at TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE INDEX place_duplicates_status_confidence_idx ON place_duplicate_candidates(status,confidence);

CREATE TABLE place_slug_redirects (old_slug TEXT PRIMARY KEY NOT NULL, place_id TEXT NOT NULL REFERENCES places(id) ON DELETE CASCADE, created_at TEXT NOT NULL);
CREATE TABLE place_revisions (
  id TEXT PRIMARY KEY NOT NULL, place_id TEXT NOT NULL REFERENCES places(id) ON DELETE CASCADE,
  actor_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  action TEXT NOT NULL CHECK(action IN ('CREATE_FROM_SUGGESTION','CORRECTION','MERGE','RESTORE','STATUS_CHANGE')),
  reason TEXT NOT NULL, before_json TEXT, after_json TEXT NOT NULL, source_type TEXT NOT NULL, source_id TEXT, created_at TEXT NOT NULL
);
CREATE INDEX place_revisions_place_created_idx ON place_revisions(place_id,created_at);

CREATE TABLE place_revalidation_cases (
  id TEXT PRIMARY KEY NOT NULL, place_id TEXT NOT NULL REFERENCES places(id) ON DELETE CASCADE,
  reason_type TEXT NOT NULL CHECK(reason_type IN ('CLOSED','TEMPORARILY_CLOSED','UNKNOWN','SOURCE_CONFLICT','STALE_90D')),
  status TEXT NOT NULL DEFAULT 'OPEN' CHECK(status IN ('OPEN','REVIEWING','RESOLVED')),
  evidence_json TEXT NOT NULL, resolution TEXT, reviewed_by TEXT REFERENCES users(id) ON DELETE SET NULL, reviewed_at TEXT,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE INDEX place_revalidation_status_reason_idx ON place_revalidation_cases(status,reason_type);
CREATE INDEX place_revalidation_place_reason_idx ON place_revalidation_cases(place_id,reason_type);
