CREATE TABLE reviewer_photo_cleanup_jobs (
  review_id TEXT PRIMARY KEY NOT NULL,
  object_keys_json TEXT NOT NULL,
  next_attempt_at TEXT NOT NULL,
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK(attempt_count >= 0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX reviewer_photo_cleanup_due_idx
  ON reviewer_photo_cleanup_jobs(next_attempt_at, created_at);
