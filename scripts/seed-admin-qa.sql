INSERT OR IGNORE INTO users (id,email,display_name,role,email_verified_at,created_at,updated_at)
VALUES ('qa-admin','qa-admin@retaste.local','QA 관리자','ADMIN','2026-08-05T12:00:00Z','2026-08-05T12:00:00Z','2026-08-05T12:00:00Z');
INSERT OR REPLACE INTO sessions (id,user_id,expires_at,created_at)
VALUES ('qa-admin-session','qa-admin','2027-08-05T12:00:00Z','2026-08-05T12:00:00Z');

DELETE FROM places
WHERE id IN (
  SELECT place_id FROM place_source_links
  WHERE business_license_id IN ('qa-high','qa-conflict','qa-low','qa-no-coords','qa-duplicate','qa-closed')
);

INSERT OR REPLACE INTO business_licenses
(id,source_type,source_management_no,business_name,business_subtype,normalized_status,road_address,latitude,longitude,region_code,raw_payload,review_status,first_seen_at,last_seen_at,created_at,updated_at)
VALUES
('qa-high','GENERAL_RESTAURANT','qa-high','QA 양평해장국','한식','OPEN','광주광역시 동구 증심사길 25 (운림동)',35.134266,126.955304,'GWANGJU','{}','PENDING','2026-08-05T12:00:00Z','2026-08-05T12:00:00Z','2026-08-05T12:00:00Z','2026-08-05T12:00:00Z'),
('qa-conflict','GENERAL_RESTAURANT','qa-conflict','QA 스시하루','한식','OPEN','광주광역시 동구 동명로 1 (동명동)',35.150000,126.920000,'GWANGJU','{}','PENDING','2026-08-05T12:00:00Z','2026-08-05T12:00:00Z','2026-08-05T12:00:00Z','2026-08-05T12:00:00Z'),
('qa-low','GENERAL_RESTAURANT','qa-low','QA 맛있는집',NULL,'OPEN','광주광역시 서구 치평로 1 (치평동)',35.152000,126.850000,'GWANGJU','{}','PENDING','2026-08-05T12:00:00Z','2026-08-05T12:00:00Z','2026-08-05T12:00:00Z','2026-08-05T12:00:00Z'),
('qa-no-coords','REST_CAFE','qa-no-coords','QA 카페봄','커피숍','OPEN','전라남도 여수시 여서1로 25 (여서동)',NULL,NULL,'JEONNAM','{}','PENDING','2026-08-05T12:00:00Z','2026-08-05T12:00:00Z','2026-08-05T12:00:00Z','2026-08-05T12:00:00Z'),
('qa-duplicate','GENERAL_RESTAURANT','qa-duplicate','Re:Taste 샘플 라멘 동명','일식','OPEN','광주광역시 동구 동명동',35.149000,126.923200,'GWANGJU','{}','PENDING','2026-08-05T12:00:00Z','2026-08-05T12:00:00Z','2026-08-05T12:00:00Z','2026-08-05T12:00:00Z'),
('qa-closed','GENERAL_RESTAURANT','qa-closed','QA 폐업국밥','한식','CLOSED','광주광역시 북구 용봉로 1 (용봉동)',35.176000,126.911000,'GWANGJU','{}','PENDING','2026-08-05T12:00:00Z','2026-08-05T12:00:00Z','2026-08-05T12:00:00Z','2026-08-05T12:00:00Z');
