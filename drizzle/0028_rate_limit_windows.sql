CREATE TABLE rate_limit_windows (
  bucket_hash TEXT NOT NULL,
  window_started_at TEXT NOT NULL,
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK(attempt_count >= 0),
  PRIMARY KEY (bucket_hash, window_started_at)
);

CREATE INDEX rate_limit_windows_started_idx
  ON rate_limit_windows(window_started_at);
