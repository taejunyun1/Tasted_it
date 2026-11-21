-- Keep imported records separate from the public catalog.
CREATE TABLE place_intake_batches (
  id TEXT PRIMARY KEY NOT NULL CHECK(typeof(id) = 'text' AND length(CAST(id AS BLOB)) = 64
    AND instr(id, char(0)) = 0 AND id NOT GLOB '*[^0-9a-f]*'),
  label TEXT NOT NULL CHECK(length(label) <= 200 AND length(trim(label)) > 0),
  expected_count INTEGER NOT NULL CHECK(typeof(expected_count) = 'integer' AND expected_count BETWEEN 1 AND 1000),
  state TEXT NOT NULL CHECK(state IN ('STAGING', 'READY')),
  created_at TEXT NOT NULL CHECK(length(created_at) <= 40 AND julianday(created_at) IS NOT NULL)
);

CREATE TABLE place_intake_entries (
  batch_id TEXT NOT NULL REFERENCES place_intake_batches(id) ON DELETE RESTRICT,
  position INTEGER NOT NULL CHECK(typeof(position) = 'integer' AND position BETWEEN 1 AND 1000),
  name TEXT NOT NULL CHECK(length(name) <= 300 AND length(trim(name)) > 0),
  address TEXT CHECK(address IS NULL OR (length(address) <= 800 AND length(trim(address)) > 0)),
  neighborhood TEXT CHECK(neighborhood IS NULL OR (length(neighborhood) <= 300 AND length(trim(neighborhood)) > 0)),
  latitude REAL,
  longitude REAL,
  category_label TEXT CHECK(category_label IS NULL OR (length(category_label) <= 200 AND length(trim(category_label)) > 0)),
  category_slug TEXT CHECK(category_slug IS NULL OR (
    typeof(category_slug) = 'text' AND length(category_slug) BETWEEN 1 AND 80
    AND instr(category_slug, char(0)) = 0 AND category_slug NOT GLOB '*[^a-z0-9-]*'
    AND category_slug NOT GLOB '-*' AND category_slug NOT GLOB '*-' AND category_slug NOT GLOB '*--*'
  )),
  kind TEXT NOT NULL CHECK(kind IN ('DINING', 'CAFE', 'BAR', 'OTHER', 'ADDRESS', 'UNKNOWN')),
  source TEXT NOT NULL CHECK(source IN ('SHARED_MAP', 'USER_SUPPLIED')),
  region_code TEXT NOT NULL CHECK(region_code IN ('GWANGJU', 'JEONNAM', 'JEONBUK', 'OUTSIDE', 'UNKNOWN')),
  selection TEXT NOT NULL CHECK(selection IN ('CANDIDATE', 'REVIEW', 'HIDDEN')),
  reason TEXT CHECK(reason IS NULL OR (length(reason) <= 500 AND length(trim(reason)) > 0)),
  note TEXT CHECK(note IS NULL OR (length(note) <= 2000 AND length(trim(note)) > 0)),
  photo TEXT NOT NULL CHECK(photo IN ('NOT_SUPPLIED', 'UNVERIFIED')),
  PRIMARY KEY (batch_id, position),
  CHECK (
    (latitude IS NULL AND longitude IS NULL)
    OR (latitude IS NOT NULL AND longitude IS NOT NULL AND latitude BETWEEN -90 AND 90 AND longitude BETWEEN -180 AND 180)
  ),
  CHECK (selection <> 'CANDIDATE' OR (
    region_code IN ('GWANGJU', 'JEONNAM', 'JEONBUK') AND kind IN ('DINING', 'CAFE')
    AND address IS NOT NULL AND neighborhood IS NOT NULL AND category_slug IS NOT NULL
    AND latitude IS NOT NULL AND longitude IS NOT NULL AND latitude BETWEEN 33 AND 39 AND longitude BETWEEN 124 AND 132
  ))
);

CREATE TRIGGER place_intake_batch_insert_guard
BEFORE INSERT ON place_intake_batches
WHEN NEW.state <> 'STAGING'
  OR EXISTS (SELECT 1 FROM place_intake_batches WHERE id = NEW.id AND state = 'READY')
BEGIN
  SELECT RAISE(ABORT, 'PLACE_INTAKE_BATCH_START_INVALID');
END;

CREATE TRIGGER place_intake_batch_update_guard
BEFORE UPDATE ON place_intake_batches
BEGIN
  SELECT CASE WHEN OLD.state <> 'STAGING' OR NEW.state <> 'READY' OR NEW.id IS NOT OLD.id
    OR NEW.label IS NOT OLD.label OR NEW.expected_count IS NOT OLD.expected_count OR NEW.created_at IS NOT OLD.created_at
    THEN RAISE(ABORT, 'PLACE_INTAKE_BATCH_IMMUTABLE') END;
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM place_intake_entries WHERE batch_id = OLD.id
    GROUP BY batch_id
    HAVING COUNT(*) = OLD.expected_count AND MIN(position) = 1 AND MAX(position) = OLD.expected_count
  ) THEN RAISE(ABORT, 'PLACE_INTAKE_BATCH_INCOMPLETE') END;
END;

CREATE TRIGGER place_intake_batch_delete_guard
BEFORE DELETE ON place_intake_batches
WHEN OLD.state = 'READY'
BEGIN
  SELECT RAISE(ABORT, 'PLACE_INTAKE_BATCH_IMMUTABLE');
END;

CREATE TRIGGER place_intake_entry_insert_guard
BEFORE INSERT ON place_intake_entries
WHEN NOT EXISTS (
  SELECT 1 FROM place_intake_batches
  WHERE id = NEW.batch_id AND state = 'STAGING' AND NEW.position BETWEEN 1 AND expected_count
)
BEGIN
  SELECT RAISE(ABORT, 'PLACE_INTAKE_ENTRY_NOT_STAGING');
END;

CREATE TRIGGER place_intake_entry_update_guard
BEFORE UPDATE ON place_intake_entries
BEGIN
  SELECT RAISE(ABORT, 'PLACE_INTAKE_ENTRY_IMMUTABLE');
END;

CREATE TRIGGER place_intake_entry_delete_guard
BEFORE DELETE ON place_intake_entries
WHEN EXISTS (SELECT 1 FROM place_intake_batches WHERE id = OLD.batch_id AND state = 'READY')
BEGIN
  SELECT RAISE(ABORT, 'PLACE_INTAKE_ENTRY_IMMUTABLE');
END;
