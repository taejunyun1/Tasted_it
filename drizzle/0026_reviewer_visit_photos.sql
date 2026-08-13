CREATE TABLE reviewer_visit_photos (
  id TEXT PRIMARY KEY NOT NULL,
  review_id TEXT NOT NULL REFERENCES reviewer_visit_reviews(id) ON DELETE CASCADE,
  object_key TEXT NOT NULL,
  content_type TEXT NOT NULL CHECK(content_type = 'image/jpeg'),
  byte_size INTEGER NOT NULL CHECK(byte_size BETWEEN 1 AND 8388608),
  position INTEGER NOT NULL CHECK(position BETWEEN 0 AND 4),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE UNIQUE INDEX reviewer_visit_photos_object_key_uidx
  ON reviewer_visit_photos(object_key);
CREATE UNIQUE INDEX reviewer_visit_photos_review_position_uidx
  ON reviewer_visit_photos(review_id, position);
CREATE INDEX reviewer_visit_photos_review_idx
  ON reviewer_visit_photos(review_id, position);
