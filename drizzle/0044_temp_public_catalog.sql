-- TEMP facts remain separate from canonical records and all member/reviewer scores.
CREATE TABLE temp_catalog_batches (
  id TEXT PRIMARY KEY NOT NULL,
  source_hash TEXT NOT NULL,
  manifest_hash TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL CHECK(status IN ('STAGED','PUBLISHED','WITHDRAWN')),
  version INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
-- A conservative version across all canonical writes closes normalization races.
CREATE TABLE temp_catalog_versions (id INTEGER PRIMARY KEY CHECK(id=1), version INTEGER NOT NULL);
INSERT INTO temp_catalog_versions(id,version) VALUES(1,0);
CREATE TRIGGER temp_catalog_places_insert AFTER INSERT ON places BEGIN UPDATE temp_catalog_versions SET version=version+1 WHERE id=1; END;
CREATE TRIGGER temp_catalog_places_update AFTER UPDATE ON places BEGIN UPDATE temp_catalog_versions SET version=version+1 WHERE id=1; END;
CREATE TRIGGER temp_catalog_places_delete AFTER DELETE ON places BEGIN UPDATE temp_catalog_versions SET version=version+1 WHERE id=1; END;
CREATE TABLE temp_catalog_entries (
  id TEXT PRIMARY KEY NOT NULL,
  batch_id TEXT NOT NULL REFERENCES temp_catalog_batches(id) ON DELETE CASCADE,
  source_id TEXT NOT NULL,
  place_id TEXT UNIQUE REFERENCES places(id) ON DELETE RESTRICT,
  owns_place INTEGER NOT NULL DEFAULT 0 CHECK(owns_place IN (0,1)),
  payload_json TEXT NOT NULL CHECK(json_valid(payload_json)),
  latitude REAL,
  longitude REAL,
  geo_status TEXT NOT NULL DEFAULT 'PENDING' CHECK(geo_status IN ('PENDING','CLAIMED','MATCHED','FAILED')),
  geo_code TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(batch_id,source_id),
  CHECK((latitude IS NULL AND longitude IS NULL) OR (latitude BETWEEN 33 AND 36 AND longitude BETWEEN 125 AND 128)),
  CHECK(geo_status <> 'MATCHED' OR (latitude IS NOT NULL AND longitude IS NOT NULL))
);
CREATE INDEX temp_catalog_entries_batch_idx ON temp_catalog_entries(batch_id,geo_status);
CREATE TRIGGER temp_catalog_manifest_immutable BEFORE UPDATE OF id,source_hash,manifest_hash ON temp_catalog_batches
BEGIN SELECT RAISE(ABORT,'TEMP_MANIFEST_IMMUTABLE'); END;
CREATE TRIGGER temp_catalog_entry_source_immutable BEFORE UPDATE OF id,batch_id,source_id,payload_json ON temp_catalog_entries
BEGIN SELECT RAISE(ABORT,'TEMP_MANIFEST_IMMUTABLE'); END;
-- A generic admin edit cannot accidentally revive withdrawn TEMP-only places.
CREATE TRIGGER temp_catalog_withdrawn_place_guard
BEFORE UPDATE OF status ON places WHEN NEW.status='PUBLISHED'
AND EXISTS(SELECT 1 FROM temp_catalog_entries e JOIN temp_catalog_batches b ON b.id=e.batch_id WHERE e.place_id=NEW.id AND e.owns_place=1 AND b.status<>'PUBLISHED')
BEGIN SELECT RAISE(ABORT,'TEMP_BATCH_NOT_PUBLISHED'); END;
