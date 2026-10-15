-- Synthetic fixtures for student-workspace.spec.ts, local D1 only.
-- The test invokes Wrangler with --local and an isolated e2e-state directory.
DELETE FROM student_task_revisions;
DELETE FROM student_tasks;
DELETE FROM student_invitations;
UPDATE student_seats SET user_id = NULL, is_active = 1, expires_at = '2099-01-01T00:00:00.000Z';
DELETE FROM admin_audit_logs WHERE target_type = 'STUDENT_WORKSPACE';
DELETE FROM rate_limit_windows;

INSERT OR IGNORE INTO users(id,email,display_name,role,email_verified_at,created_at,updated_at) VALUES
('qa-student-a','qa-student-a@retaste.local','시험 학생 A','USER','2026-10-15T00:00:00.000Z','2026-10-15T00:00:00.000Z','2026-10-15T00:00:00.000Z'),
('qa-student-b','qa-student-b@retaste.local','시험 학생 B','USER','2026-10-15T00:00:00.000Z','2026-10-15T00:00:00.000Z','2026-10-15T00:00:00.000Z'),
('qa-student-c','qa-student-c@retaste.local','시험 학생 C','USER','2026-10-15T00:00:00.000Z','2026-10-15T00:00:00.000Z','2026-10-15T00:00:00.000Z'),
('qa-student-d','qa-student-d@retaste.local','시험 학생 D','USER','2026-10-15T00:00:00.000Z','2026-10-15T00:00:00.000Z','2026-10-15T00:00:00.000Z');
INSERT OR REPLACE INTO sessions(id,user_id,expires_at,created_at) VALUES
('qa-student-a-session','qa-student-a','2099-01-01T00:00:00.000Z','2026-10-15T00:00:00.000Z'),
('qa-student-b-session','qa-student-b','2099-01-01T00:00:00.000Z','2026-10-15T00:00:00.000Z'),
('qa-student-c-session','qa-student-c','2099-01-01T00:00:00.000Z','2026-10-15T00:00:00.000Z'),
('qa-student-d-session','qa-student-d','2099-01-01T00:00:00.000Z','2026-10-15T00:00:00.000Z');

INSERT OR IGNORE INTO business_licenses
(id,source_type,source_management_no,business_name,business_subtype,normalized_status,road_address,latitude,longitude,region_code,raw_payload,review_status,first_seen_at,last_seen_at,created_at,updated_at)
VALUES('qa-student-license','GENERAL_RESTAURANT','qa-student-license','학생 검수용 독립 백반집','한식','OPEN','광주광역시 동구 시험로 1234',35.15,126.92,'GWANGJU','{}','PENDING','2026-10-15T00:00:00.000Z','2026-10-15T00:00:00.000Z','2026-10-15T00:00:00.000Z','2026-10-15T00:00:00.000Z');
INSERT OR IGNORE INTO place_review_work_items
(id,business_license_id,source_kind,stage,status,selected_category_id,stage_version,created_at,updated_at)
VALUES('qa-student-new-store','qa-student-license','PUBLIC_DATA','FINAL_APPROVAL','ACTIVE','cat-ramen',0,'2026-10-15T00:00:00.000Z','2026-10-15T00:00:00.000Z');

INSERT OR IGNORE INTO places
(id,slug,name,status,address,neighborhood,latitude,longitude,search_text,created_at,updated_at)
VALUES('qa-student-review-place','qa-student-review-place','학생 리뷰 분류용 식당','PUBLISHED','광주광역시 동구 시험로 5678','동명동',35.15,126.92,'학생 리뷰 분류용 식당','2026-10-15T00:00:00.000Z','2026-10-15T00:00:00.000Z');
INSERT OR IGNORE INTO place_categories(place_id,category_id,is_primary) VALUES('qa-student-review-place','cat-ramen',1);
INSERT OR IGNORE INTO reviewer_visit_reviews
(id,place_id,reviewer_user_id,category_id,evaluation,badges_json,photo_count,version,published_at,created_at,updated_at)
VALUES('qa-student-negative-review','qa-student-review-place','qa-active-reviewer','cat-ramen','NOT_RECOMMEND','[]',0,1,'2026-10-15T00:00:00.000Z','2026-10-15T00:00:00.000Z','2026-10-15T00:00:00.000Z');
