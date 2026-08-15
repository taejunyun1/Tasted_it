CREATE TABLE place_operating_hours (
  id TEXT PRIMARY KEY,
  place_id TEXT NOT NULL REFERENCES places(id) ON DELETE CASCADE,
  weekday INTEGER NOT NULL CHECK(weekday BETWEEN 0 AND 6),
  opens_at TEXT,
  closes_at TEXT,
  is_closed INTEGER NOT NULL DEFAULT 0 CHECK(is_closed IN (0, 1)),
  verified_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  last_verified_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK((is_closed = 1 AND opens_at IS NULL AND closes_at IS NULL) OR (is_closed = 0 AND opens_at IS NOT NULL AND closes_at IS NOT NULL))
);

CREATE INDEX place_operating_hours_place_weekday_idx ON place_operating_hours(place_id, weekday);
CREATE INDEX place_operating_hours_verified_idx ON place_operating_hours(last_verified_at);

CREATE TABLE place_course_contexts (
  place_id TEXT PRIMARY KEY NOT NULL REFERENCES places(id) ON DELETE CASCADE,
  traits_json TEXT NOT NULL DEFAULT '[]',
  source TEXT NOT NULL CHECK(source IN ('DERIVED', 'MANUAL')),
  algorithm_version TEXT NOT NULL,
  updated_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX place_course_contexts_source_updated_idx ON place_course_contexts(source, updated_at);
