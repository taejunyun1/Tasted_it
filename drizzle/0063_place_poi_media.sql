CREATE TABLE place_poi_media (
  id TEXT PRIMARY KEY NOT NULL CHECK(
    length(id) = 36 AND id = lower(id)
    AND substr(id, 9, 1) = '-' AND substr(id, 14, 1) = '-'
    AND substr(id, 19, 1) = '-' AND substr(id, 24, 1) = '-'
    AND length(replace(id, '-', '')) = 32 AND replace(id, '-', '') NOT GLOB '*[^a-f0-9]*'
  ),
  place_id TEXT NOT NULL REFERENCES places(id) ON DELETE CASCADE,
  state TEXT NOT NULL DEFAULT 'STAGED' CHECK(state IN ('STAGED', 'PUBLISHED', 'WITHDRAWN')),
  source_url TEXT NOT NULL CHECK(length(source_url) BETWEEN 9 AND 2048 AND substr(source_url, 1, 8) = 'https://'),
  attribution TEXT NOT NULL CHECK(length(trim(attribution)) BETWEEN 1 AND 160),
  rights_basis TEXT NOT NULL CHECK(rights_basis IN ('OWN_WORK', 'MERCHANT_PERMISSION', 'KOGL_1', 'OPEN_LICENSE')),
  rights_evidence TEXT NOT NULL CHECK(length(trim(rights_evidence)) BETWEEN 1 AND 1000),
  sha256 TEXT NOT NULL CHECK(length(sha256) = 64 AND sha256 NOT GLOB '*[^a-f0-9]*'),
  byte_size INTEGER NOT NULL CHECK(typeof(byte_size) = 'integer' AND byte_size BETWEEN 4 AND 8388608),
  content_type TEXT NOT NULL CHECK(content_type = 'image/jpeg'),
  reviewed_at TEXT NOT NULL CHECK(length(reviewed_at) = 24 AND julianday(reviewed_at) IS NOT NULL AND substr(reviewed_at, -1) = 'Z')
);

CREATE INDEX place_poi_media_public_idx ON place_poi_media(place_id, state, reviewed_at DESC, id DESC);

CREATE TRIGGER place_poi_media_immutable_provenance
BEFORE UPDATE OF id, place_id, source_url, attribution, rights_basis, rights_evidence, sha256, byte_size, content_type, reviewed_at
ON place_poi_media
BEGIN
  SELECT RAISE(ABORT, 'POI_MEDIA_PROVENANCE_IMMUTABLE');
END;

CREATE TRIGGER place_poi_media_withdrawal_is_final
BEFORE UPDATE OF state ON place_poi_media
WHEN (OLD.state = 'WITHDRAWN' AND NEW.state <> 'WITHDRAWN')
  OR (OLD.state = 'PUBLISHED' AND NEW.state = 'STAGED')
BEGIN
  SELECT RAISE(ABORT, 'POI_MEDIA_INVALID_STATE_TRANSITION');
END;
