CREATE TABLE place_review_work_items (
  id TEXT PRIMARY KEY NOT NULL,
  business_license_id TEXT REFERENCES business_licenses(id) ON DELETE CASCADE,
  place_id TEXT REFERENCES places(id) ON DELETE CASCADE,
  source_kind TEXT NOT NULL CHECK(source_kind IN ('PUBLIC_DATA','PLACE_SUGGESTION','CATEGORY_RECALL','LIVENESS_RECHECK')),
  stage TEXT NOT NULL CHECK(stage IN ('SOURCE_REVIEW','NAVER_VERIFICATION','CATEGORY_CONFIRMATION','DUPLICATE_REVIEW','FINAL_APPROVAL')),
  status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK(status IN ('ACTIVE','ON_HOLD','COMPLETED','EXCLUDED')),
  selected_category_id TEXT REFERENCES categories(id) ON DELETE SET NULL,
  category_override_reason TEXT,
  manual_evidence_reason TEXT,
  stage_version INTEGER NOT NULL DEFAULT 0 CHECK(stage_version >= 0),
  claim_token TEXT,
  claimed_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  claimed_at TEXT,
  last_transition_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  last_transition_at TEXT,
  hold_code TEXT,
  hold_note TEXT,
  completed_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK(
    (business_license_id IS NOT NULL AND place_id IS NULL)
    OR (business_license_id IS NULL AND place_id IS NOT NULL)
  )
);

CREATE INDEX place_review_stage_status_updated_idx
  ON place_review_work_items(stage, status, updated_at, id);
CREATE UNIQUE INDEX place_review_active_business_idx
  ON place_review_work_items(business_license_id)
  WHERE business_license_id IS NOT NULL AND status IN ('ACTIVE','ON_HOLD');
CREATE UNIQUE INDEX place_review_active_place_idx
  ON place_review_work_items(place_id)
  WHERE place_id IS NOT NULL AND status IN ('ACTIVE','ON_HOLD');

CREATE TABLE place_review_duplicate_resolutions (
  id TEXT PRIMARY KEY NOT NULL,
  work_item_id TEXT NOT NULL REFERENCES place_review_work_items(id) ON DELETE CASCADE,
  candidate_place_id TEXT NOT NULL REFERENCES places(id) ON DELETE CASCADE,
  decision TEXT NOT NULL CHECK(decision IN ('LINK_EXISTING','MERGE','DISTINCT')),
  reason TEXT NOT NULL,
  reviewed_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  reviewed_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(work_item_id, candidate_place_id)
);

CREATE INDEX place_review_duplicate_work_idx
  ON place_review_duplicate_resolutions(work_item_id, decision);

INSERT INTO place_review_work_items (
  id, business_license_id, place_id, source_kind, stage, status, stage_version, created_at, updated_at
)
SELECT 'public-data:' || id, id, NULL, 'PUBLIC_DATA', 'SOURCE_REVIEW', 'ACTIVE', 0, updated_at, updated_at
FROM business_licenses
WHERE review_status = 'PENDING' AND normalized_status = 'OPEN';

INSERT INTO place_review_work_items (
  id, business_license_id, place_id, source_kind, stage, status, stage_version, created_at, updated_at
)
SELECT 'category-recall:' || p.id, NULL, p.id, 'CATEGORY_RECALL', 'SOURCE_REVIEW', 'ACTIVE', 0, p.updated_at, p.updated_at
FROM places p
WHERE p.status = 'HIDDEN'
  AND EXISTS (
    SELECT 1 FROM admin_audit_logs a
    WHERE a.target_type = 'PLACE'
      AND a.target_id = p.id
      AND a.action = 'RECALL_PUBLISHED_PLACES_FOR_CATEGORY_AUDIT'
  );

INSERT INTO place_review_work_items (
  id, business_license_id, place_id, source_kind, stage, status, stage_version, created_at, updated_at
)
SELECT 'place-suggestion:' || p.id, NULL, p.id, 'PLACE_SUGGESTION', 'SOURCE_REVIEW', 'ACTIVE', 0, p.updated_at, p.updated_at
FROM places p
WHERE p.status = 'DRAFT'
  AND EXISTS (
    SELECT 1 FROM place_revisions r
    WHERE r.place_id = p.id AND r.action = 'CREATE_FROM_SUGGESTION'
  );
