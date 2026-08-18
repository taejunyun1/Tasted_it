ALTER TABLE naver_local_category_runs ADD COLUMN region_code TEXT
  CHECK(region_code IS NULL OR region_code IN ('GWANGJU', 'JEONNAM'));

CREATE INDEX naver_local_category_runs_region_started_idx
  ON naver_local_category_runs(region_code, started_at);
