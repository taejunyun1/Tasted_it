-- Photo supplementation is separate from immutable original TEMP manifests.
CREATE TABLE temp_photo_supplement_batches (
 id TEXT PRIMARY KEY NOT NULL,
 target_batch_id TEXT NOT NULL UNIQUE REFERENCES temp_catalog_batches(id) ON DELETE RESTRICT,
 manifest_hash TEXT NOT NULL UNIQUE,
 manifest_json TEXT NOT NULL CHECK(json_valid(manifest_json) AND length(manifest_json)<=1048576),
 target_version INTEGER NOT NULL,
 canonical_version INTEGER NOT NULL,
 status TEXT NOT NULL CHECK(status IN ('ACTIVE','WITHDRAWN')),
 version INTEGER NOT NULL DEFAULT 0,
 created_by TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
 updated_by TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
 created_at TEXT NOT NULL,
 updated_at TEXT NOT NULL
);
CREATE TABLE temp_photo_supplements (
 entry_id TEXT PRIMARY KEY NOT NULL REFERENCES temp_catalog_entries(id) ON DELETE RESTRICT,
 supplement_batch_id TEXT NOT NULL REFERENCES temp_photo_supplement_batches(id) ON DELETE RESTRICT,
 payload_json TEXT NOT NULL CHECK(json_valid(payload_json)),
 object_key TEXT NOT NULL UNIQUE,
 created_at TEXT NOT NULL,
 CHECK(json_extract(payload_json,'$.rightsStatus') IS 'UNVERIFIED')
);
CREATE INDEX temp_photo_supplements_batch_idx ON temp_photo_supplements(supplement_batch_id);
CREATE TRIGGER temp_photo_supplement_batch_insert BEFORE INSERT ON temp_photo_supplement_batches BEGIN
 SELECT CASE WHEN NEW.status<>'ACTIVE' OR NEW.version<>0 OR NEW.created_by<>NEW.updated_by
  OR NEW.id<>'tempphotos-'||substr(NEW.manifest_hash,1,16)
  OR length(NEW.manifest_hash)<>64 OR NEW.manifest_hash GLOB '*[^0-9a-f]*'
  OR NOT EXISTS(SELECT 1 FROM users WHERE id=NEW.created_by AND role='ADMIN' AND email NOT LIKE 'withdrawn.%@invalid.local')
  THEN RAISE(ABORT,'TEMP_PHOTO_ACTOR_INVALID') END;
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM temp_catalog_batches WHERE id=NEW.target_batch_id AND status='PUBLISHED' AND version=NEW.target_version)
  OR NOT EXISTS(SELECT 1 FROM temp_catalog_versions WHERE id=1 AND version=NEW.canonical_version)
  THEN RAISE(ABORT,'TEMP_PHOTO_VERSION_CONFLICT') END;
 SELECT CASE WHEN json_extract(NEW.manifest_json,'$.schemaVersion') IS NOT 1
  OR json_extract(NEW.manifest_json,'$.targetBatchId') IS NOT NEW.target_batch_id
  OR json_type(NEW.manifest_json,'$.entries') IS NOT 'array'
  OR json_array_length(NEW.manifest_json,'$.entries')<>77
  OR (SELECT count(DISTINCT json_extract(value,'$.sourceId')) FROM json_each(NEW.manifest_json,'$.entries'))<>77
  OR (SELECT count(*) FROM temp_catalog_entries WHERE batch_id=NEW.target_batch_id AND json_type(payload_json,'$.photo')='null')<>77
  THEN RAISE(ABORT,'TEMP_PHOTO_COUNT_INVALID') END;
 SELECT CASE WHEN EXISTS(
  SELECT 1 FROM json_each(NEW.manifest_json,'$.entries') j
  LEFT JOIN temp_catalog_entries e ON e.id=NEW.target_batch_id||'-'||json_extract(j.value,'$.sourceId')
  LEFT JOIN places p ON p.id=e.place_id
  WHERE e.id IS NULL OR e.batch_id<>NEW.target_batch_id OR p.status IS NOT 'PUBLISHED'
   OR json_type(e.payload_json,'$.photo') IS NOT 'null'
   OR json_extract(e.payload_json,'$.name') IS NOT json_extract(j.value,'$.name')
   OR json_extract(e.payload_json,'$.address') IS NOT json_extract(j.value,'$.address')
   OR json_extract(j.value,'$.rightsStatus') IS NOT 'UNVERIFIED'
 ) THEN RAISE(ABORT,'TEMP_PHOTO_TARGET_INVALID') END;
END;
CREATE TRIGGER temp_photo_supplement_batch_apply AFTER INSERT ON temp_photo_supplement_batches BEGIN
 INSERT INTO temp_photo_supplements(entry_id,supplement_batch_id,payload_json,object_key,created_at)
 SELECT NEW.target_batch_id||'-'||json_extract(value,'$.sourceId'),NEW.id,json(value),
  'temp100-naver/'||NEW.target_batch_id||'/'||json_extract(value,'$.sourceId')||'-'||json_extract(value,'$.sha256')||
  CASE json_extract(value,'$.contentType') WHEN 'image/jpeg' THEN '.jpg' WHEN 'image/png' THEN '.png' WHEN 'image/webp' THEN '.webp' END,
  NEW.created_at FROM json_each(NEW.manifest_json,'$.entries');
 INSERT INTO admin_audit_logs(id,actor_user_id,action,target_type,target_id,after_state,created_at)
 VALUES('temp-photo-apply-'||NEW.id,NEW.created_by,'TEMP_PHOTO_SUPPLEMENT_APPLIED','TEMP_PHOTO_BATCH',NEW.id,
  json_object('targetBatchId',NEW.target_batch_id,'manifestHash',NEW.manifest_hash,'count',77,'rightsStatus','UNVERIFIED'),NEW.created_at);
END;
CREATE TRIGGER temp_photo_supplement_target BEFORE INSERT ON temp_photo_supplements BEGIN
 SELECT CASE WHEN NOT EXISTS (
  SELECT 1 FROM temp_catalog_entries e JOIN temp_catalog_batches b ON b.id=e.batch_id
  JOIN temp_photo_supplement_batches s ON s.id=NEW.supplement_batch_id AND s.target_batch_id=b.id
  JOIN places p ON p.id=e.place_id
  WHERE e.id=NEW.entry_id AND b.status='PUBLISHED' AND p.status='PUBLISHED' AND s.status='ACTIVE'
   AND json_type(e.payload_json,'$.photo')='null'
   AND json_extract(e.payload_json,'$.sourceId')=json_extract(NEW.payload_json,'$.sourceId')
   AND json_extract(e.payload_json,'$.name')=json_extract(NEW.payload_json,'$.name')
   AND json_extract(e.payload_json,'$.address')=json_extract(NEW.payload_json,'$.address')
 ) THEN RAISE(ABORT,'TEMP_PHOTO_TARGET_INVALID') END;
 SELECT CASE WHEN (SELECT count(*) FROM temp_photo_supplements WHERE supplement_batch_id=NEW.supplement_batch_id)>=77
  THEN RAISE(ABORT,'TEMP_PHOTO_COUNT_INVALID') END;
END;
CREATE TRIGGER temp_photo_supplement_immutable BEFORE UPDATE ON temp_photo_supplements BEGIN SELECT RAISE(ABORT,'TEMP_PHOTO_IMMUTABLE'); END;
CREATE TRIGGER temp_photo_supplement_no_delete BEFORE DELETE ON temp_photo_supplements BEGIN SELECT RAISE(ABORT,'TEMP_PHOTO_IMMUTABLE'); END;
CREATE TRIGGER temp_photo_supplement_batch_identity BEFORE UPDATE OF id,target_batch_id,manifest_hash,manifest_json,target_version,canonical_version,created_at,created_by ON temp_photo_supplement_batches BEGIN SELECT RAISE(ABORT,'TEMP_PHOTO_IMMUTABLE'); END;
CREATE TRIGGER temp_photo_supplement_batch_transition BEFORE UPDATE ON temp_photo_supplement_batches
 WHEN OLD.status<>'ACTIVE' OR NEW.status<>'WITHDRAWN' OR NEW.version<>OLD.version+1
  OR NOT EXISTS(SELECT 1 FROM users WHERE id=NEW.updated_by AND role='ADMIN' AND email NOT LIKE 'withdrawn.%@invalid.local')
 BEGIN SELECT RAISE(ABORT,'TEMP_PHOTO_TRANSITION_INVALID'); END;
CREATE TRIGGER temp_photo_supplement_batch_withdraw AFTER UPDATE ON temp_photo_supplement_batches BEGIN
 INSERT INTO admin_audit_logs(id,actor_user_id,action,target_type,target_id,after_state,created_at)
 VALUES('temp-photo-withdraw-'||NEW.id,NEW.updated_by,'TEMP_PHOTO_SUPPLEMENT_WITHDRAWN','TEMP_PHOTO_BATCH',NEW.id,
  json_object('targetBatchId',NEW.target_batch_id,'manifestHash',NEW.manifest_hash,'count',77),NEW.updated_at);
END;
CREATE TRIGGER temp_photo_supplement_batch_no_delete BEFORE DELETE ON temp_photo_supplement_batches BEGIN SELECT RAISE(ABORT,'TEMP_PHOTO_IMMUTABLE'); END;
