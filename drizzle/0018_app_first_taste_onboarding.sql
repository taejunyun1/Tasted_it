CREATE TABLE guest_taste_sessions (
  id TEXT PRIMARY KEY NOT NULL,
  onboarding_version INTEGER NOT NULL DEFAULT 1,
  location_mode TEXT NOT NULL DEFAULT 'DEFAULT' CHECK (location_mode IN ('DEVICE', 'DEFAULT')),
  completed_steps_json TEXT NOT NULL DEFAULT '[]',
  completed_at TEXT,
  skipped_at TEXT,
  merged_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX guest_taste_sessions_expiry_idx
  ON guest_taste_sessions(expires_at, merged_user_id);

CREATE TABLE guest_taste_badges (
  session_id TEXT NOT NULL REFERENCES guest_taste_sessions(id) ON DELETE CASCADE,
  badge_id TEXT NOT NULL REFERENCES taste_badges(id) ON DELETE RESTRICT,
  selected_at TEXT NOT NULL,
  PRIMARY KEY (session_id, badge_id)
);

CREATE INDEX guest_taste_badges_badge_idx ON guest_taste_badges(badge_id);

CREATE TABLE recommendation_feedback (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  place_id TEXT NOT NULL REFERENCES places(id) ON DELETE CASCADE,
  value INTEGER NOT NULL CHECK (value IN (-1, 1)),
  reason TEXT CHECK (reason IN ('MENU', 'DISTANCE', 'PRICE', 'ATMOSPHERE', 'ALREADY_VISITED')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (user_id, place_id)
);

CREATE TABLE product_events (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  guest_session_id TEXT REFERENCES guest_taste_sessions(id) ON DELETE SET NULL,
  event_name TEXT NOT NULL,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  occurred_at TEXT NOT NULL
);

CREATE INDEX product_events_name_time_idx ON product_events(event_name, occurred_at);
CREATE INDEX product_events_guest_idx ON product_events(guest_session_id, occurred_at);
CREATE INDEX product_events_user_idx ON product_events(user_id, occurred_at);
