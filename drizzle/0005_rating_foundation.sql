CREATE TABLE rating_configs (
  id TEXT PRIMARY KEY NOT NULL,
  algorithm_version TEXT NOT NULL UNIQUE,
  minimum_visible_samples INTEGER NOT NULL CHECK (minimum_visible_samples >= 1),
  alpha_prior REAL NOT NULL CHECK (alpha_prior > 0),
  beta_prior REAL NOT NULL CHECK (beta_prior > 0),
  reviewer_max_share REAL NOT NULL CHECK (reviewer_max_share >= 0 AND reviewer_max_share < 1),
  settings_json TEXT NOT NULL,
  active_from TEXT NOT NULL,
  active_until TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

INSERT INTO rating_configs VALUES (
  'rating-config-v2', 'rating-v2.0', 8, 2, 2, 0.3,
  '{"reliabilityMinimumEligible":5,"reliabilityMinimum":0.6,"reliabilityMaximum":1.4,"similarityMinimumOverlap":10,"similarityMinimumAgreement":0.8}',
  '2026-08-06T00:00:00.000Z', NULL, '2026-08-06T00:00:00.000Z', '2026-08-06T00:00:00.000Z'
);

CREATE TABLE rating_snapshots (
  id TEXT PRIMARY KEY NOT NULL,
  place_id TEXT NOT NULL REFERENCES places(id) ON DELETE CASCADE,
  config_id TEXT NOT NULL REFERENCES rating_configs(id) ON DELETE RESTRICT,
  input_hash TEXT NOT NULL,
  overall_score INTEGER,
  user_score INTEGER,
  reviewer_score INTEGER,
  overall_sample_count INTEGER NOT NULL,
  user_sample_count INTEGER NOT NULL,
  reviewer_sample_count INTEGER NOT NULL,
  reviewer_raw_weight REAL NOT NULL,
  reviewer_combined_weight REAL NOT NULL,
  reviewer_weight_share REAL NOT NULL,
  reasons_json TEXT NOT NULL,
  is_stale INTEGER NOT NULL DEFAULT 0 CHECK (is_stale IN (0,1)),
  computed_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(place_id, config_id, input_hash)
);
CREATE INDEX rating_snapshots_place_computed_idx ON rating_snapshots(place_id, computed_at);
CREATE INDEX rating_snapshots_stale_idx ON rating_snapshots(is_stale, computed_at);

CREATE TABLE reviewer_reliability_snapshots (
  id TEXT PRIMARY KEY NOT NULL,
  reviewer_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  config_id TEXT NOT NULL REFERENCES rating_configs(id) ON DELETE RESTRICT,
  eligible_count INTEGER NOT NULL,
  correct_count INTEGER NOT NULL,
  posterior_accuracy REAL NOT NULL,
  reliability_weight REAL NOT NULL,
  calibration_status TEXT NOT NULL CHECK (calibration_status IN ('CALIBRATING','ACTIVE')),
  computed_at TEXT NOT NULL
);
CREATE INDEX reviewer_reliability_user_computed_idx ON reviewer_reliability_snapshots(reviewer_user_id, computed_at);

CREATE TABLE reviewer_similarity_edges (
  id TEXT PRIMARY KEY NOT NULL,
  config_id TEXT NOT NULL REFERENCES rating_configs(id) ON DELETE CASCADE,
  left_reviewer_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  right_reviewer_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  overlap_count INTEGER NOT NULL,
  agreement_rate REAL NOT NULL,
  cluster_id TEXT NOT NULL,
  damping REAL NOT NULL,
  computed_at TEXT NOT NULL,
  UNIQUE(config_id, left_reviewer_user_id, right_reviewer_user_id)
);
CREATE INDEX reviewer_similarity_cluster_idx ON reviewer_similarity_edges(cluster_id);

CREATE TABLE rating_recompute_jobs (
  id TEXT PRIMARY KEY NOT NULL,
  place_id TEXT REFERENCES places(id) ON DELETE CASCADE,
  config_id TEXT NOT NULL REFERENCES rating_configs(id) ON DELETE RESTRICT,
  scope TEXT NOT NULL CHECK (scope IN ('PLACE','ALL')),
  status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','RUNNING','COMPLETED','FAILED')),
  reason TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  error_summary TEXT,
  started_at TEXT,
  finished_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK ((scope = 'PLACE' AND place_id IS NOT NULL) OR scope = 'ALL')
);
CREATE INDEX rating_recompute_jobs_status_created_idx ON rating_recompute_jobs(status, created_at);

CREATE TABLE golden_pick_events (
  id TEXT PRIMARY KEY NOT NULL,
  reviewer_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  place_id TEXT NOT NULL REFERENCES places(id) ON DELETE RESTRICT,
  event_type TEXT NOT NULL CHECK (event_type IN ('GRANT','WITHDRAW','EXPIRE')),
  previous_event_id TEXT,
  reason TEXT,
  effective_at TEXT NOT NULL,
  expires_at TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX golden_pick_reviewer_effective_idx ON golden_pick_events(reviewer_user_id, effective_at);
CREATE INDEX golden_pick_place_effective_idx ON golden_pick_events(place_id, effective_at);

CREATE TABLE flavor_templates (
  id TEXT PRIMARY KEY NOT NULL,
  category_id TEXT NOT NULL REFERENCES categories(id) ON DELETE RESTRICT,
  version TEXT NOT NULL,
  dimensions_json TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','ACTIVE','ARCHIVED')),
  approved_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  approved_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(category_id, version)
);

CREATE TABLE flavor_ratings (
  id TEXT PRIMARY KEY NOT NULL,
  place_id TEXT NOT NULL REFERENCES places(id) ON DELETE CASCADE,
  reviewer_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  template_id TEXT NOT NULL REFERENCES flavor_templates(id) ON DELETE RESTRICT,
  values_json TEXT NOT NULL,
  confidence TEXT NOT NULL CHECK (confidence IN ('LOW','MEDIUM','HIGH')),
  status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','WITHDRAWN')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(place_id, reviewer_user_id, template_id)
);

CREATE TABLE place_daily_metrics (
  place_id TEXT NOT NULL REFERENCES places(id) ON DELETE CASCADE,
  metric_date TEXT NOT NULL,
  detail_views INTEGER NOT NULL DEFAULT 0,
  direction_clicks INTEGER NOT NULL DEFAULT 0,
  save_actions INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY(place_id, metric_date)
);

CREATE TABLE integrity_cases (
  id TEXT PRIMARY KEY NOT NULL,
  signal_type TEXT NOT NULL,
  subject_type TEXT NOT NULL CHECK (subject_type IN ('USER','PLACE','REVIEWER_CLUSTER')),
  subject_id TEXT NOT NULL,
  dedupe_key TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','REVIEWING','DISMISSED','CONFIRMED')),
  evidence_json TEXT NOT NULL,
  resolution_reason TEXT,
  reviewed_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  reviewed_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX integrity_cases_status_created_idx ON integrity_cases(status, created_at);

CREATE TABLE invalidated_vote_events (
  vote_event_id TEXT PRIMARY KEY NOT NULL REFERENCES vote_events(id) ON DELETE RESTRICT,
  integrity_case_id TEXT NOT NULL REFERENCES integrity_cases(id) ON DELETE RESTRICT,
  reason TEXT NOT NULL,
  invalidated_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  invalidated_at TEXT NOT NULL
);
