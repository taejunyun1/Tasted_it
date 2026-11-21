CREATE TABLE place_intake_review_links (
  batch_id TEXT NOT NULL,
  position INTEGER NOT NULL,
  work_item_id TEXT NOT NULL UNIQUE REFERENCES place_review_work_items(id) ON DELETE RESTRICT,
  mode TEXT NOT NULL CHECK(mode IN ('LINK', 'CREATE')),
  -- Retain the verified actor ID as audit evidence after account removal.
  actor_user_id TEXT NOT NULL,
  enrolled_at TEXT NOT NULL CHECK(length(enrolled_at) <= 40 AND julianday(enrolled_at) IS NOT NULL),
  subject_name TEXT NOT NULL CHECK(length(subject_name) <= 300 AND length(trim(subject_name)) > 0),
  subject_address TEXT NOT NULL CHECK(length(subject_address) <= 800 AND length(trim(subject_address)) > 0),
  subject_latitude REAL NOT NULL CHECK(subject_latitude BETWEEN 33 AND 39),
  subject_longitude REAL NOT NULL CHECK(subject_longitude BETWEEN 124 AND 132),
  PRIMARY KEY (batch_id, position),
  FOREIGN KEY (batch_id, position) REFERENCES place_intake_entries(batch_id, position) ON DELETE RESTRICT
);

CREATE TRIGGER place_intake_review_link_insert_guard
BEFORE INSERT ON place_intake_review_links
BEGIN
  SELECT CASE WHEN EXISTS (
    SELECT 1 FROM place_intake_review_links
    WHERE (batch_id = NEW.batch_id AND position = NEW.position) OR work_item_id = NEW.work_item_id
  ) THEN RAISE(ABORT, 'PLACE_INTAKE_REVIEW_LINK_EXISTS') END;

  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM users AS actor
    WHERE actor.id = NEW.actor_user_id AND actor.role = 'ADMIN' AND actor.email_verified_at IS NOT NULL
      AND actor.email NOT LIKE 'withdrawn.%@invalid.local'
      AND NOT EXISTS (
        SELECT 1 FROM member_access_restrictions AS restriction
        WHERE restriction.user_id = actor.id AND restriction.lifted_at IS NULL
          AND julianday(restriction.starts_at) <= julianday('now')
          AND julianday(restriction.expires_at) > julianday('now')
      )
  ) THEN RAISE(ABORT, 'PLACE_INTAKE_REVIEW_ADMIN_REQUIRED') END;

  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM place_intake_entries AS entry
    JOIN place_intake_batches AS batch ON batch.id = entry.batch_id
    WHERE entry.batch_id = NEW.batch_id AND entry.position = NEW.position AND batch.state = 'READY'
      AND entry.selection = 'CANDIDATE' AND entry.region_code IN ('GWANGJU', 'JEONNAM', 'JEONBUK')
      AND entry.kind IN ('DINING', 'CAFE')
  ) THEN RAISE(ABORT, 'PLACE_INTAKE_REVIEW_ENTRY_INELIGIBLE') END;

  SELECT CASE WHEN NEW.mode = 'LINK' AND NOT EXISTS (
    SELECT 1 FROM place_review_work_items AS work
    JOIN business_licenses AS license ON license.id = work.business_license_id
    JOIN place_intake_entries AS entry ON entry.batch_id = NEW.batch_id AND entry.position = NEW.position
    WHERE work.id = NEW.work_item_id AND work.source_kind = 'PUBLIC_DATA' AND work.status = 'ACTIVE'
      AND work.claim_token IS NULL AND license.normalized_status = 'OPEN' AND license.review_status = 'PENDING'
      AND license.source_type IN ('GENERAL_RESTAURANT', 'REST_CAFE', 'BAKERY')
      AND license.region_code = entry.region_code AND license.business_name = NEW.subject_name
      AND coalesce(license.road_address, license.lot_address) = NEW.subject_address
      AND license.latitude = NEW.subject_latitude AND license.longitude = NEW.subject_longitude
      AND NOT EXISTS (SELECT 1 FROM place_source_links WHERE business_license_id = license.id)
      AND NOT EXISTS (
        SELECT 1 FROM business_license_exclusions WHERE business_license_id = license.id AND status = 'ACTIVE'
      )
  ) THEN RAISE(ABORT, 'PLACE_INTAKE_REVIEW_LICENSE_INVALID') END;

  SELECT CASE WHEN NEW.mode = 'CREATE' AND NOT EXISTS (
    SELECT 1 FROM place_review_work_items AS work
    JOIN places AS place ON place.id = work.place_id
    JOIN place_intake_entries AS entry ON entry.batch_id = NEW.batch_id AND entry.position = NEW.position
    WHERE work.id = NEW.work_item_id AND work.source_kind = 'PLACE_SUGGESTION' AND work.status = 'ACTIVE'
      AND work.stage = 'SOURCE_REVIEW' AND work.stage_version = 0 AND work.claim_token IS NULL
      AND place.status = 'DRAFT' AND place.closed_at IS NULL
      AND place.name = NEW.subject_name AND entry.name = NEW.subject_name
      AND place.address = NEW.subject_address AND entry.address = NEW.subject_address
      AND place.latitude = NEW.subject_latitude AND entry.latitude = NEW.subject_latitude
      AND place.longitude = NEW.subject_longitude AND entry.longitude = NEW.subject_longitude
  ) THEN RAISE(ABORT, 'PLACE_INTAKE_REVIEW_DRAFT_INVALID') END;
END;

CREATE TRIGGER place_intake_review_link_update_guard
BEFORE UPDATE ON place_intake_review_links
BEGIN
  SELECT RAISE(ABORT, 'PLACE_INTAKE_REVIEW_LINK_IMMUTABLE');
END;

CREATE TRIGGER place_intake_review_link_delete_guard
BEFORE DELETE ON place_intake_review_links
BEGIN
  SELECT RAISE(ABORT, 'PLACE_INTAKE_REVIEW_LINK_IMMUTABLE');
END;
