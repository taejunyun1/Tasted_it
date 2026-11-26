-- This table and its private bucket are independent of the legacy photo cleanup.
-- Keep the row after loss of its parent review until its exact object is cleared.
CREATE TABLE student_review_pilot_photos (
  id TEXT PRIMARY KEY NOT NULL CHECK(length(id) = 36 AND id NOT GLOB '*[^0-9a-f-]*'),
  review_id TEXT NOT NULL,
  author_user_id TEXT NOT NULL,
  place_id TEXT NOT NULL,
  place_name TEXT NOT NULL,
  place_address TEXT NOT NULL,
  content_version INTEGER NOT NULL CHECK(content_version > 0),
  object_key TEXT NOT NULL UNIQUE CHECK(object_key = 'student-review-pilot/' || id || '.jpg'),
  byte_size INTEGER NOT NULL CHECK(byte_size BETWEEN 4 AND 8388608),
  caption TEXT NOT NULL,
  taken_on TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('UPLOADING', 'PENDING', 'APPROVED', 'RETIRED')),
  sealed INTEGER NOT NULL DEFAULT 0 CHECK(sealed IN (0, 1)),
  decision_id TEXT,
  created_at TEXT NOT NULL,
  upload_expires_at TEXT NOT NULL,
  cleanup_after TEXT NOT NULL,
  CHECK(status NOT IN ('PENDING', 'APPROVED') OR sealed = 1),
  CHECK(status = 'RETIRED' OR (length(trim(caption)) BETWEEN 1 AND 240 AND length(taken_on) = 10))
);

CREATE UNIQUE INDEX student_review_pilot_one_active
  ON student_review_pilot_photos(review_id, content_version) WHERE status <> 'RETIRED';
CREATE INDEX student_review_pilot_upload_expiry
  ON student_review_pilot_photos(upload_expires_at, id) WHERE status = 'UPLOADING';
CREATE INDEX student_review_pilot_cleanup
  ON student_review_pilot_photos(cleanup_after, id) WHERE status = 'RETIRED';
CREATE INDEX student_review_pilot_place
  ON student_review_pilot_photos(place_id, status, created_at);
CREATE INDEX student_review_pilot_author
  ON student_review_pilot_photos(author_user_id, status);

CREATE TRIGGER student_review_pilot_identity_guard
BEFORE UPDATE ON student_review_pilot_photos
WHEN NEW.id IS NOT OLD.id OR NEW.object_key IS NOT OLD.object_key
  OR NEW.review_id IS NOT OLD.review_id OR NEW.content_version IS NOT OLD.content_version
  OR NEW.author_user_id IS NOT OLD.author_user_id OR NEW.place_id IS NOT OLD.place_id
  OR NEW.place_name IS NOT OLD.place_name OR NEW.place_address IS NOT OLD.place_address
  OR NEW.byte_size IS NOT OLD.byte_size OR (OLD.sealed = 1 AND NEW.sealed <> 1)
  OR (OLD.status = 'RETIRED' AND NEW.status <> 'RETIRED')
BEGIN
  SELECT RAISE(ABORT, 'STUDENT_REVIEW_PILOT_IDENTITY_IMMUTABLE');
END;

CREATE TRIGGER student_review_pilot_review_update
AFTER UPDATE OF content_version, status, is_current, reviewer_user_id, place_id ON reviewer_visit_reviews
BEGIN
  UPDATE student_review_pilot_photos SET status = 'RETIRED', caption = '', taken_on = '',
    cleanup_after = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  WHERE review_id = OLD.id AND status <> 'RETIRED' AND (
    content_version <> NEW.content_version OR author_user_id <> NEW.reviewer_user_id
    OR place_id <> NEW.place_id OR NEW.is_current <> 1
    OR NEW.status NOT IN ('PENDING', 'APPROVED')
  );
END;

CREATE TRIGGER student_review_pilot_review_delete
AFTER DELETE ON reviewer_visit_reviews
BEGIN
  UPDATE student_review_pilot_photos SET status = 'RETIRED', caption = '', taken_on = '',
    cleanup_after = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  WHERE review_id = OLD.id AND status <> 'RETIRED';
END;

CREATE TRIGGER student_review_pilot_user_update
AFTER UPDATE OF role, email, email_verified_at ON users
WHEN NEW.role <> 'REVIEWER' OR NEW.email_verified_at IS NULL OR lower(NEW.email) LIKE 'withdrawn.%@invalid.local'
BEGIN
  UPDATE student_review_pilot_photos SET status = 'RETIRED', caption = '', taken_on = '',
    cleanup_after = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  WHERE author_user_id = OLD.id AND status <> 'RETIRED';
END;

CREATE TRIGGER student_review_pilot_profile_update
AFTER UPDATE OF status ON reviewer_profiles
WHEN NEW.status <> 'ACTIVE'
BEGIN
  UPDATE student_review_pilot_photos SET status = 'RETIRED', caption = '', taken_on = '',
    cleanup_after = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  WHERE author_user_id = OLD.user_id AND status <> 'RETIRED';
END;

CREATE TRIGGER student_review_pilot_profile_delete
AFTER DELETE ON reviewer_profiles
BEGIN
  UPDATE student_review_pilot_photos SET status = 'RETIRED', caption = '', taken_on = '',
    cleanup_after = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  WHERE author_user_id = OLD.user_id AND status <> 'RETIRED';
END;

CREATE TRIGGER student_review_pilot_place_update
AFTER UPDATE OF name, address, status, closed_at ON places
WHEN NEW.name IS NOT OLD.name OR NEW.address IS NOT OLD.address
  OR NEW.status <> 'PUBLISHED' OR NEW.closed_at IS NOT NULL
BEGIN
  UPDATE student_review_pilot_photos SET status = 'RETIRED', caption = '', taken_on = '',
    cleanup_after = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  WHERE place_id = OLD.id AND status <> 'RETIRED';
END;
