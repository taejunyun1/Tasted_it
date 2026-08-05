CREATE TABLE business_licenses (
  id TEXT PRIMARY KEY NOT NULL,
  source_type TEXT NOT NULL,
  source_management_no TEXT NOT NULL,
  business_name TEXT NOT NULL,
  business_subtype TEXT,
  sales_status_code TEXT,
  sales_status_name TEXT,
  detail_status_code TEXT,
  detail_status_name TEXT,
  normalized_status TEXT NOT NULL CHECK(normalized_status IN ('OPEN','TEMPORARILY_CLOSED','CLOSED','UNKNOWN')),
  lot_address TEXT, road_address TEXT, phone TEXT,
  source_x REAL, source_y REAL, latitude REAL, longitude REAL,
  region_code TEXT NOT NULL CHECK(region_code IN ('GWANGJU','JEONNAM')),
  source_updated_at TEXT, raw_payload TEXT NOT NULL,
  review_status TEXT NOT NULL DEFAULT 'PENDING' CHECK(review_status IN ('PENDING','APPROVED','REJECTED')),
  review_reason TEXT, reviewed_by TEXT REFERENCES users(id) ON DELETE SET NULL, reviewed_at TEXT,
  first_seen_at TEXT NOT NULL, last_seen_at TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
  UNIQUE(source_type, source_management_no)
);
CREATE INDEX business_licenses_candidate_idx ON business_licenses(normalized_status, review_status);
CREATE INDEX business_licenses_region_idx ON business_licenses(region_code);
CREATE TABLE place_source_links (
  id TEXT PRIMARY KEY NOT NULL,
  place_id TEXT NOT NULL REFERENCES places(id) ON DELETE CASCADE,
  business_license_id TEXT NOT NULL UNIQUE REFERENCES business_licenses(id) ON DELETE RESTRICT,
  is_primary INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL
);
CREATE INDEX place_source_links_place_idx ON place_source_links(place_id);
CREATE TABLE public_data_sync_runs (
  id TEXT PRIMARY KEY NOT NULL, source_type TEXT NOT NULL, region_code TEXT NOT NULL, address_field TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('RUNNING','COMPLETED','FAILED')), next_page INTEGER NOT NULL DEFAULT 1,
  total_count INTEGER NOT NULL DEFAULT 0, fetched_count INTEGER NOT NULL DEFAULT 0, inserted_count INTEGER NOT NULL DEFAULT 0,
  updated_count INTEGER NOT NULL DEFAULT 0, skipped_count INTEGER NOT NULL DEFAULT 0,
  started_at TEXT NOT NULL, finished_at TEXT, error_summary TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE admin_audit_logs (
  id TEXT PRIMARY KEY NOT NULL, actor_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  action TEXT NOT NULL, target_type TEXT NOT NULL, target_id TEXT NOT NULL,
  before_state TEXT, after_state TEXT, created_at TEXT NOT NULL
);
