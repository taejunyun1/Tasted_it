CREATE TABLE business_license_exclusions (
  business_license_id TEXT PRIMARY KEY NOT NULL REFERENCES business_licenses(id) ON DELETE CASCADE,
  reason TEXT NOT NULL CHECK(reason IN ('CHAIN_STORE')),
  matched_rule TEXT NOT NULL,
  chain_name TEXT NOT NULL,
  matched_term TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('ACTIVE','OVERRIDDEN','CLEARED')),
  excluded_at TEXT NOT NULL,
  overridden_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  overridden_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX business_license_exclusions_status_idx
  ON business_license_exclusions(status, updated_at);
