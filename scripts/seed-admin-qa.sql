INSERT OR IGNORE INTO users (id,email,display_name,role,email_verified_at,created_at,updated_at)
VALUES ('qa-admin','qa-admin@retaste.local','QA 관리자','ADMIN','2026-08-05T12:00:00Z','2026-08-05T12:00:00Z','2026-08-05T12:00:00Z');
INSERT OR REPLACE INTO sessions (id,user_id,expires_at,created_at)
VALUES ('qa-admin-session','qa-admin','2027-08-05T12:00:00Z','2026-08-05T12:00:00Z');
INSERT OR REPLACE INTO sessions (id,user_id,expires_at,created_at) VALUES
('qa-login-flow-desktop','qa-admin','2027-08-05T12:00:00Z','2026-08-05T12:00:00Z'),
('qa-login-flow-mobile','qa-admin','2027-08-05T12:00:00Z','2026-08-05T12:00:00Z');

DELETE FROM reviewer_profiles WHERE user_id = 'qa-reviewer-member';
DELETE FROM reviewer_applications WHERE user_id = 'qa-reviewer-member';

INSERT OR REPLACE INTO users (id,email,display_name,role,email_verified_at,created_at,updated_at) VALUES
('qa-reviewer-member','qa-reviewer-member@retaste.local','QA 리뷰어 신청자','USER','2026-08-05T12:00:00Z','2026-08-05T12:00:00Z','2026-08-05T12:00:00Z'),
('qa-active-reviewer','qa-active-reviewer@retaste.local','QA 국물 기록자','REVIEWER','2026-08-05T12:00:00Z','2026-08-05T12:00:00Z','2026-08-05T12:00:00Z'),
('qa-suspended-reviewer','qa-suspended-reviewer@retaste.local','QA 정지 리뷰어','USER','2026-08-05T12:00:00Z','2026-08-05T12:00:00Z','2026-08-05T12:00:00Z'),
('qa-reviewer-applicant','qa-reviewer-applicant@retaste.local','QA 심사 대기자','USER','2026-08-05T12:00:00Z','2026-08-05T12:00:00Z','2026-08-05T12:00:00Z');

INSERT OR REPLACE INTO sessions (id,user_id,expires_at,created_at)
VALUES ('qa-reviewer-member-session','qa-reviewer-member','2027-08-05T12:00:00Z','2026-08-05T12:00:00Z');
INSERT OR REPLACE INTO sessions (id,user_id,expires_at,created_at)
VALUES ('qa-active-reviewer-session','qa-active-reviewer','2027-08-05T12:00:00Z','2026-08-05T12:00:00Z');

INSERT OR REPLACE INTO reviewer_applications
(id,user_id,status,statement,occupation,taste_direction,region_code,specialty_slugs,approved_suggestion_count,created_at,updated_at)
VALUES
('qa-reviewer-application','qa-reviewer-applicant','APPLIED','광주 골목 식당을 직접 방문하고 음식의 간과 재료, 가격 대비 만족도, 재방문 의사를 함께 기록합니다. 광고보다 일관된 기준과 솔직한 근거를 중요하게 생각하며 같은 기준으로 여러 번 방문하겠습니다.','지역 콘텐츠 기획자','국물 요리와 오래된 동네 식당','GWANGJU','["korean"]',0,'2026-08-05T12:00:00Z','2026-08-05T12:00:00Z');

INSERT OR REPLACE INTO reviewer_profiles
(user_id,slug,status,occupation,taste_direction,region_code,specialty_slugs,last_activity_at,approved_at,approved_by,status_reason,created_at,updated_at)
VALUES
('qa-active-reviewer','qa-gukmul-reviewer','ACTIVE','지역 음식 기록자','국물 요리와 노포를 오래 관찰합니다.','GWANGJU','["korean"]','2026-08-05T12:00:00Z','2026-08-05T12:00:00Z','qa-admin',NULL,'2026-08-05T12:00:00Z','2026-08-05T12:00:00Z'),
('qa-suspended-reviewer','qa-suspended','SUSPENDED','기록자','정지 테스트 프로필','GWANGJU','["korean"]','2026-08-05T12:00:00Z','2026-08-05T12:00:00Z','qa-admin','운영 정책 위반','2026-08-05T12:00:00Z','2026-08-05T12:00:00Z');

INSERT OR IGNORE INTO flavor_templates
(id,category_id,version,dimensions_json,status,approved_by,approved_at,created_at,updated_at)
VALUES
('qa-ramen-flavor-v1','cat-ramen','v1','["국물 농도","감칠맛","면 식감","향신료","양"]','ACTIVE','qa-admin','2026-08-05T12:00:00Z','2026-08-05T12:00:00Z','2026-08-05T12:00:00Z');

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
