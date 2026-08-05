CREATE TABLE reviewer_applications (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'APPLIED' CHECK (status IN ('APPLIED','REVIEWING','APPROVED','REJECTED')),
  statement TEXT NOT NULL,
  occupation TEXT NOT NULL,
  taste_direction TEXT NOT NULL,
  region_code TEXT NOT NULL CHECK (region_code IN ('GWANGJU','JEONNAM')),
  specialty_slugs TEXT NOT NULL,
  approved_suggestion_count INTEGER NOT NULL DEFAULT 0,
  override_reason TEXT,
  admin_note TEXT,
  reviewed_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  reviewed_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX reviewer_applications_user_status_idx ON reviewer_applications(user_id, status);
CREATE INDEX reviewer_applications_status_created_idx ON reviewer_applications(status, created_at);

CREATE TABLE reviewer_profiles (
  user_id TEXT PRIMARY KEY NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  slug TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','DORMANT','SUSPENDED')),
  occupation TEXT NOT NULL,
  taste_direction TEXT NOT NULL,
  region_code TEXT NOT NULL CHECK (region_code IN ('GWANGJU','JEONNAM')),
  specialty_slugs TEXT NOT NULL,
  last_activity_at TEXT NOT NULL,
  approved_at TEXT NOT NULL,
  approved_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  status_reason TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX reviewer_profiles_status_activity_idx ON reviewer_profiles(status, last_activity_at);
