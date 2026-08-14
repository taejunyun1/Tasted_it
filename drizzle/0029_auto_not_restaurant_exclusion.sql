ALTER TABLE business_license_exclusions RENAME TO business_license_exclusions_legacy_0029;

DROP INDEX business_license_exclusions_status_idx;

CREATE TABLE business_license_exclusions (
  business_license_id TEXT PRIMARY KEY NOT NULL REFERENCES business_licenses(id) ON DELETE CASCADE,
  reason TEXT NOT NULL CHECK(reason IN ('CHAIN_STORE','ADULT_ENTERTAINMENT','NOT_RESTAURANT','ADMIN_EXCEPTION')),
  exclusion_category TEXT NOT NULL CHECK(exclusion_category IN ('CHAIN_STORE','ADULT_ENTERTAINMENT','BUSINESS_TYPE','NOT_RESTAURANT','BAD_OR_DUPLICATE_DATA','POLICY','OTHER')),
  matched_rule TEXT,
  chain_name TEXT,
  matched_term TEXT,
  matched_brand TEXT,
  matched_alias TEXT,
  chain_scope TEXT CHECK(chain_scope IN ('NATIONAL_CHAIN','REGIONAL_CHAIN','LOCAL_CHAIN','UNKNOWN')),
  match_method TEXT,
  match_confidence REAL,
  note TEXT,
  excluded_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  status TEXT NOT NULL CHECK(status IN ('ACTIVE','OVERRIDDEN','CLEARED')),
  excluded_at TEXT NOT NULL,
  overridden_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  overridden_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

INSERT INTO business_license_exclusions (
  business_license_id, reason, exclusion_category, matched_rule, chain_name, matched_term,
  matched_brand, matched_alias, chain_scope, match_method, match_confidence, note,
  excluded_by, status, excluded_at, overridden_by, overridden_at, created_at, updated_at
)
SELECT
  business_license_id, reason, exclusion_category, matched_rule, chain_name, matched_term,
  matched_brand, matched_alias, chain_scope, match_method, match_confidence, note,
  excluded_by, status, excluded_at, overridden_by, overridden_at, created_at, updated_at
FROM business_license_exclusions_legacy_0029;

DROP TABLE business_license_exclusions_legacy_0029;

CREATE INDEX business_license_exclusions_status_idx
  ON business_license_exclusions(status, updated_at);
