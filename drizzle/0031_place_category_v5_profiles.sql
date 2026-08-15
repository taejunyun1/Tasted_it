INSERT OR IGNORE INTO categories(id,slug,name,emoji,sort_order,parent_id,description,is_active,created_at,updated_at) VALUES
('cat-korean-general','korean-general','한식 일반','🍚',199,'cat-korean','상세 메뉴 근거가 없는 한식',1,datetime('now'),datetime('now')),
('cat-japanese-general','japanese-general','일식 일반','🍣',299,'cat-japanese','상세 메뉴 근거가 없는 일식',1,datetime('now'),datetime('now')),
('cat-chinese-general','chinese-general','중식 일반','🥟',399,'cat-chinese','상세 메뉴 근거가 없는 중식',1,datetime('now'),datetime('now')),
('cat-western-general','western-general','양식 일반','🍝',499,'cat-western','상세 메뉴 근거가 없는 양식',1,datetime('now'),datetime('now')),
('cat-world-general','world-general','세계음식 일반','🌏',799,'cat-world','상세 메뉴 근거가 없는 세계음식',1,datetime('now'),datetime('now'));

CREATE TABLE place_category_v5_profiles (
  place_id TEXT PRIMARY KEY NOT NULL REFERENCES places(id) ON DELETE CASCADE,
  primary_category_slug TEXT NOT NULL,
  secondary_category_slugs_json TEXT NOT NULL DEFAULT '[]',
  traits_json TEXT NOT NULL DEFAULT '[]',
  food_place_score INTEGER NOT NULL CHECK(food_place_score BETWEEN 0 AND 100),
  state TEXT NOT NULL CHECK(state IN ('GREEN','YELLOW','ORANGE','RED')),
  decision TEXT NOT NULL CHECK(decision IN ('AUTO','MANUAL','EXCLUDE')),
  evidence_codes_json TEXT NOT NULL DEFAULT '[]',
  reason_codes_json TEXT NOT NULL DEFAULT '[]',
  algorithm_version TEXT NOT NULL,
  last_classified_at TEXT NOT NULL,
  applied_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX place_category_v5_state_score_idx ON place_category_v5_profiles(state, food_place_score);
CREATE INDEX place_category_v5_version_classified_idx ON place_category_v5_profiles(algorithm_version, last_classified_at);

CREATE TABLE place_category_v5_runs (
  id TEXT PRIMARY KEY,
  mode TEXT NOT NULL CHECK(mode IN ('SHADOW','APPLY_VERIFIED')),
  status TEXT NOT NULL CHECK(status IN ('RUNNING','COMPLETED','FAILED','SKIPPED')),
  requested_limit INTEGER NOT NULL CHECK(requested_limit BETWEEN 1 AND 100),
  scanned_count INTEGER NOT NULL DEFAULT 0,
  stored_count INTEGER NOT NULL DEFAULT 0,
  verified_apply_count INTEGER NOT NULL DEFAULT 0,
  manual_count INTEGER NOT NULL DEFAULT 0,
  excluded_count INTEGER NOT NULL DEFAULT 0,
  error_code TEXT,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  created_by TEXT REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX place_category_v5_runs_status_started_idx ON place_category_v5_runs(status, started_at);
