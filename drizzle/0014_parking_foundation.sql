CREATE TABLE parking_data_snapshots (
  id TEXT PRIMARY KEY NOT NULL,
  source TEXT NOT NULL CHECK(source IN ('PARKING','EV')),
  status TEXT NOT NULL CHECK(status IN ('STAGING','ACTIVE','RETIRED','FAILED')),
  source_reference_date_min TEXT,
  source_reference_date_max TEXT,
  row_count INTEGER NOT NULL DEFAULT 0,
  activated_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX parking_snapshots_source_status_idx ON parking_data_snapshots(source, status, activated_at);
CREATE UNIQUE INDEX parking_snapshots_one_active_source_idx ON parking_data_snapshots(source) WHERE status = 'ACTIVE';

CREATE TABLE parking_sync_runs (
  id TEXT PRIMARY KEY NOT NULL,
  source TEXT NOT NULL CHECK(source IN ('PARKING','EV')),
  status TEXT NOT NULL CHECK(status IN ('RUNNING','COMPLETED','FAILED')),
  snapshot_id TEXT REFERENCES parking_data_snapshots(id) ON DELETE SET NULL,
  next_page INTEGER NOT NULL DEFAULT 1,
  total_count INTEGER,
  fetched_count INTEGER NOT NULL DEFAULT 0,
  accepted_count INTEGER NOT NULL DEFAULT 0,
  skipped_count INTEGER NOT NULL DEFAULT 0,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  error_summary TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX parking_sync_runs_source_status_idx ON parking_sync_runs(source, status, finished_at);

CREATE TABLE parking_facilities (
  id TEXT PRIMARY KEY NOT NULL,
  snapshot_id TEXT NOT NULL REFERENCES parking_data_snapshots(id) ON DELETE CASCADE,
  source_management_no TEXT NOT NULL,
  name TEXT NOT NULL,
  ownership_type TEXT NOT NULL CHECK(ownership_type IN ('PUBLIC','PRIVATE','STORE_FREE','UNKNOWN')),
  facility_type TEXT NOT NULL CHECK(facility_type IN ('ON_STREET','OFF_STREET','ATTACHED','UNKNOWN')),
  road_address TEXT,
  lot_address TEXT,
  region_code TEXT NOT NULL CHECK(region_code IN ('GWANGJU','JEONNAM')),
  latitude REAL NOT NULL,
  longitude REAL NOT NULL,
  capacity INTEGER,
  disabled_spaces INTEGER,
  weekday_open TEXT,
  weekday_close TEXT,
  saturday_open TEXT,
  saturday_close TEXT,
  holiday_open TEXT,
  holiday_close TEXT,
  fee_status TEXT NOT NULL CHECK(fee_status IN ('FREE','PAID','MIXED','UNKNOWN')),
  base_minutes INTEGER,
  base_fee INTEGER,
  additional_minutes INTEGER,
  additional_fee INTEGER,
  daily_max_fee INTEGER,
  payment_methods TEXT,
  public_access_status TEXT NOT NULL CHECK(public_access_status IN ('PUBLIC','RESTRICTED','UNKNOWN')),
  reliability_grade TEXT NOT NULL CHECK(reliability_grade IN ('A','B','C')),
  reference_date TEXT NOT NULL,
  raw_payload TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(snapshot_id, source_management_no)
);
CREATE INDEX parking_facilities_snapshot_region_geo_idx ON parking_facilities(snapshot_id, region_code, latitude, longitude);
CREATE INDEX parking_facilities_snapshot_grade_idx ON parking_facilities(snapshot_id, reliability_grade);

CREATE TABLE ev_charging_stations (
  id TEXT PRIMARY KEY NOT NULL,
  snapshot_id TEXT NOT NULL REFERENCES parking_data_snapshots(id) ON DELETE CASCADE,
  source_station_id TEXT NOT NULL,
  name TEXT NOT NULL,
  address TEXT,
  latitude REAL NOT NULL,
  longitude REAL NOT NULL,
  fast_charger_count INTEGER NOT NULL DEFAULT 0,
  slow_charger_count INTEGER NOT NULL DEFAULT 0,
  connector_summary TEXT,
  available_hours TEXT,
  user_restriction TEXT,
  parking_fee_free INTEGER CHECK(parking_fee_free IN (0,1)),
  is_deleted INTEGER NOT NULL DEFAULT 0 CHECK(is_deleted IN (0,1)),
  reference_date TEXT NOT NULL,
  raw_payload TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(snapshot_id, source_station_id)
);
CREATE INDEX ev_stations_snapshot_geo_idx ON ev_charging_stations(snapshot_id, latitude, longitude);

CREATE TABLE parking_ev_links (
  parking_facility_id TEXT NOT NULL REFERENCES parking_facilities(id) ON DELETE CASCADE,
  ev_station_id TEXT NOT NULL REFERENCES ev_charging_stations(id) ON DELETE CASCADE,
  relationship TEXT NOT NULL CHECK(relationship IN ('ONSITE_CONFIRMED','NEARBY_ONLY')),
  match_method TEXT NOT NULL,
  confidence REAL NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY(parking_facility_id, ev_station_id)
);
CREATE INDEX parking_ev_links_relationship_idx ON parking_ev_links(parking_facility_id, relationship);
