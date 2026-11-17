-- NAVER cutover starts CLOSED. A later audited operator plan verifies the
-- retired Worker and sets the first complete UTC day; calendar rollover alone
-- must never activate accounting.
CREATE TABLE provider_daily_quotas (
 provider TEXT NOT NULL CHECK(provider='NAVER_LOCAL_SEARCH'), utc_day TEXT NOT NULL CHECK(date(utc_day) IS NOT NULL AND utc_day=date(utc_day)),
 legacy_total INTEGER NOT NULL DEFAULT 0 CHECK(legacy_total>=0), legacy_gwangju INTEGER NOT NULL DEFAULT 0 CHECK(legacy_gwangju>=0), legacy_jeonnam INTEGER NOT NULL DEFAULT 0 CHECK(legacy_jeonnam>=0),
 reserved_total INTEGER NOT NULL DEFAULT 0 CHECK(reserved_total>=0), reserved_gwangju INTEGER NOT NULL DEFAULT 0 CHECK(reserved_gwangju>=0), reserved_jeonnam INTEGER NOT NULL DEFAULT 0 CHECK(reserved_jeonnam>=0),
 baseline_at TEXT NOT NULL, baseline_source TEXT NOT NULL CHECK(baseline_source IN ('LEGACY_RUN_ESTIMATE','EMPTY_NEW_DAY')),
 cutover_state TEXT NOT NULL CHECK(cutover_state IN ('READY','CLOSED_LEGACY_UNCERTAIN')), is_cutover_anchor INTEGER NOT NULL DEFAULT 0 CHECK(is_cutover_anchor IN (0,1)),
 cutover_verified_at TEXT, ready_after_utc_day TEXT, cutover_receipt_ref TEXT,
 last_reservation_id TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
 PRIMARY KEY(provider,utc_day),
 CHECK(reserved_total=reserved_gwangju+reserved_jeonnam),
 CHECK((cutover_verified_at IS NULL AND ready_after_utc_day IS NULL AND cutover_receipt_ref IS NULL) OR (is_cutover_anchor=1 AND cutover_verified_at IS NOT NULL AND date(ready_after_utc_day) IS NOT NULL AND ready_after_utc_day=date(ready_after_utc_day) AND julianday(cutover_verified_at) IS NOT NULL AND ready_after_utc_day>utc_day AND ready_after_utc_day>date(cutover_verified_at) AND cutover_receipt_ref IS NOT NULL AND length(trim(cutover_receipt_ref)) BETWEEN 1 AND 512))
);
CREATE UNIQUE INDEX provider_one_cutover_anchor ON provider_daily_quotas(provider) WHERE is_cutover_anchor=1;
CREATE TABLE provider_call_attempts (
 id TEXT PRIMARY KEY, provider TEXT NOT NULL CHECK(provider='NAVER_LOCAL_SEARCH'), utc_day TEXT NOT NULL,
 region_code TEXT NOT NULL CHECK(region_code IN ('GWANGJU','JEONNAM')),
 source TEXT NOT NULL CHECK(source IN ('PENDING_VERIFICATION','CATEGORY_REVERIFICATION','PLACE_LIVENESS','TEMP_GEOCODE','CATEGORY_V2')),
 run_id TEXT REFERENCES naver_local_category_runs(id) ON DELETE RESTRICT,
 reserved_at TEXT NOT NULL, dispatch_started_at TEXT, finished_at TEXT,
 outcome TEXT NOT NULL DEFAULT 'PENDING' CHECK(outcome IN ('PENDING','SUCCEEDED','FAILED','UNKNOWN')), failure_code TEXT,
 FOREIGN KEY(provider,utc_day) REFERENCES provider_daily_quotas(provider,utc_day) ON DELETE RESTRICT,
 CHECK((outcome='PENDING' AND finished_at IS NULL) OR (outcome<>'PENDING' AND finished_at IS NOT NULL))
);
CREATE INDEX provider_attempts_day_region_idx ON provider_call_attempts(provider,utc_day,region_code);
CREATE INDEX provider_attempts_run_idx ON provider_call_attempts(run_id);
CREATE TABLE provider_migration_guard(passed INTEGER CHECK(passed=1));
INSERT INTO provider_migration_guard SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM naver_local_category_runs WHERE date(started_at) IS NULL OR typeof(api_call_count)<>'integer' OR api_call_count<0 OR (region_code IS NOT NULL AND region_code NOT IN ('GWANGJU','JEONNAM'))) THEN 1 ELSE 0 END;
DROP TABLE provider_migration_guard;
INSERT INTO provider_daily_quotas(provider,utc_day,legacy_total,legacy_gwangju,legacy_jeonnam,baseline_at,baseline_source,cutover_state,created_at,updated_at)
 SELECT 'NAVER_LOCAL_SEARCH',date(started_at),sum(api_call_count),sum(CASE WHEN region_code IS NULL OR region_code='GWANGJU' THEN api_call_count ELSE 0 END),sum(CASE WHEN region_code IS NULL OR region_code='JEONNAM' THEN api_call_count ELSE 0 END),strftime('%Y-%m-%dT%H:%M:%fZ','now'),'LEGACY_RUN_ESTIMATE','CLOSED_LEGACY_UNCERTAIN',strftime('%Y-%m-%dT%H:%M:%fZ','now'),strftime('%Y-%m-%dT%H:%M:%fZ','now') FROM naver_local_category_runs GROUP BY date(started_at);
INSERT INTO provider_daily_quotas(provider,utc_day,baseline_at,baseline_source,cutover_state,created_at,updated_at)
 VALUES('NAVER_LOCAL_SEARCH',date('now'),strftime('%Y-%m-%dT%H:%M:%fZ','now'),'LEGACY_RUN_ESTIMATE','CLOSED_LEGACY_UNCERTAIN',strftime('%Y-%m-%dT%H:%M:%fZ','now'),strftime('%Y-%m-%dT%H:%M:%fZ','now')) ON CONFLICT DO NOTHING;
UPDATE provider_daily_quotas SET is_cutover_anchor=1 WHERE provider='NAVER_LOCAL_SEARCH' AND utc_day=date('now');
