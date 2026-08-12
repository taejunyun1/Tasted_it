CREATE TABLE reviewer_visit_reviews (
  id TEXT PRIMARY KEY NOT NULL,
  place_id TEXT NOT NULL REFERENCES places(id) ON DELETE RESTRICT,
  reviewer_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  category_id TEXT NOT NULL REFERENCES categories(id) ON DELETE RESTRICT,
  evaluation TEXT NOT NULL CHECK(evaluation IN ('RECOMMEND', 'HOLD', 'NOT_RECOMMEND')),
  badges_json TEXT NOT NULL CHECK(json_valid(badges_json)),
  photo_count INTEGER NOT NULL DEFAULT 0 CHECK(photo_count BETWEEN 0 AND 5),
  golden_pick_event_id TEXT REFERENCES golden_pick_events(id) ON DELETE RESTRICT,
  version INTEGER NOT NULL DEFAULT 1 CHECK(version >= 1),
  published_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX reviewer_visit_reviews_reviewer_published_idx
  ON reviewer_visit_reviews(reviewer_user_id, published_at);
CREATE INDEX reviewer_visit_reviews_place_published_idx
  ON reviewer_visit_reviews(place_id, published_at);
CREATE UNIQUE INDEX reviewer_visit_reviews_golden_event_idx
  ON reviewer_visit_reviews(golden_pick_event_id);
