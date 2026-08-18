PRAGMA foreign_keys = ON;

-- Isolated synthetic-beta fixture. Do not copy live shop names. Discard persist-to after the run.

INSERT OR IGNORE INTO categories (id, slug, name, emoji, sort_order, parent_id, is_active, created_at, updated_at) VALUES
  ('cat-korean', 'korean', '한식', '🍚', 100, NULL, 1, '2026-08-18T00:00:00Z', '2026-08-18T00:00:00Z'),
  ('cat-japanese', 'japanese', '일식', '🍣', 200, NULL, 1, '2026-08-18T00:00:00Z', '2026-08-18T00:00:00Z'),
  ('cat-gukbap', 'gukbap-detail', '국밥·해장국', '🥣', 102, 'cat-korean', 1, '2026-08-18T00:00:00Z', '2026-08-18T00:00:00Z'),
  ('cat-ramen', 'ramen-detail', '라멘', '🍜', 203, 'cat-japanese', 1, '2026-08-18T00:00:00Z', '2026-08-18T00:00:00Z');

INSERT OR IGNORE INTO places (
  id, slug, name, status, address, neighborhood, latitude, longitude, search_text, created_at, updated_at
) VALUES
  (
    'synth-place-gukbap',
    'synth-beta-gukbap-a',
    '합성 베타 국밥 A',
    'PUBLISHED',
    '광주광역시 북구 용봉로 1 (용봉동)',
    '용봉동',
    35.1760,
    126.9110,
    '합성 베타 국밥',
    '2026-08-18T00:00:00Z',
    '2026-08-18T00:00:00Z'
  ),
  (
    'synth-place-ramen',
    'synth-beta-ramen-b',
    '합성 베타 라멘 B',
    'PUBLISHED',
    '광주광역시 동구 동명로 2 (동명동)',
    '동명동',
    35.1490,
    126.9230,
    '합성 베타 라멘',
    '2026-08-18T00:00:00Z',
    '2026-08-18T00:00:00Z'
  );

INSERT OR IGNORE INTO place_categories (place_id, category_id, is_primary) VALUES
  ('synth-place-gukbap', 'cat-gukbap', 1),
  ('synth-place-ramen', 'cat-ramen', 1);

INSERT OR IGNORE INTO users (id, email, display_name, role, email_verified_at, created_at, updated_at) VALUES
  ('synth-admin-1', 'synth-admin@example.test', '합성 관리자', 'ADMIN', '2026-08-18T00:00:00Z', '2026-08-18T00:00:00Z', '2026-08-18T00:00:00Z'),
  ('synth-reviewer-1', 'synth-reviewer-1@example.test', '합성 리뷰어 1', 'REVIEWER', '2026-08-18T00:00:00Z', '2026-08-18T00:00:00Z', '2026-08-18T00:00:00Z'),
  ('synth-reviewer-2', 'synth-reviewer-2@example.test', '합성 리뷰어 2', 'REVIEWER', '2026-08-18T00:00:00Z', '2026-08-18T00:00:00Z', '2026-08-18T00:00:00Z'),
  ('synth-reviewer-3', 'synth-reviewer-3@example.test', '합성 리뷰어 3', 'REVIEWER', '2026-08-18T00:00:00Z', '2026-08-18T00:00:00Z', '2026-08-18T00:00:00Z');

INSERT OR IGNORE INTO sessions (id, user_id, expires_at, created_at) VALUES
  ('synth-admin-session', 'synth-admin-1', '2027-08-18T00:00:00Z', '2026-08-18T00:00:00Z'),
  ('synth-reviewer-1-session', 'synth-reviewer-1', '2027-08-18T00:00:00Z', '2026-08-18T00:00:00Z'),
  ('synth-reviewer-2-session', 'synth-reviewer-2', '2027-08-18T00:00:00Z', '2026-08-18T00:00:00Z'),
  ('synth-reviewer-3-session', 'synth-reviewer-3', '2027-08-18T00:00:00Z', '2026-08-18T00:00:00Z');

INSERT OR IGNORE INTO reviewer_profiles
(user_id, slug, status, occupation, taste_direction, region_code, specialty_slugs, last_activity_at, approved_at, approved_by, created_at, updated_at)
VALUES
  ('synth-reviewer-1', 'synth-reviewer-gukmul', 'ACTIVE', '합성 기록', '국물', 'GWANGJU', '["korean"]', '2026-08-18T00:00:00Z', '2026-08-18T00:00:00Z', 'synth-admin-1', '2026-08-18T00:00:00Z', '2026-08-18T00:00:00Z'),
  ('synth-reviewer-2', 'synth-reviewer-myun', 'ACTIVE', '합성 기록', '면', 'GWANGJU', '["japanese"]', '2026-08-18T00:00:00Z', '2026-08-18T00:00:00Z', 'synth-admin-1', '2026-08-18T00:00:00Z', '2026-08-18T00:00:00Z'),
  ('synth-reviewer-3', 'synth-reviewer-yang', 'ACTIVE', '합성 기록', '양', 'GWANGJU', '["korean"]', '2026-08-18T00:00:00Z', '2026-08-18T00:00:00Z', 'synth-admin-1', '2026-08-18T00:00:00Z', '2026-08-18T00:00:00Z');

INSERT OR IGNORE INTO flavor_templates
(id, category_id, version, dimensions_json, status, approved_by, approved_at, created_at, updated_at)
VALUES
  ('synth-flavor-gukbap-v1', 'cat-gukbap', 'v1', '["국물 농도","감칠맛","면 식감","향신료","양"]', 'ACTIVE', 'synth-admin-1', '2026-08-18T00:00:00Z', '2026-08-18T00:00:00Z', '2026-08-18T00:00:00Z'),
  ('synth-flavor-ramen-v1', 'cat-ramen', 'v1', '["국물 농도","감칠맛","면 식감","향신료","양"]', 'ACTIVE', 'synth-admin-1', '2026-08-18T00:00:00Z', '2026-08-18T00:00:00Z', '2026-08-18T00:00:00Z');

INSERT OR IGNORE INTO flavor_ratings
(id, place_id, reviewer_user_id, template_id, values_json, confidence, status, created_at, updated_at)
VALUES
  ('synth-fr-g1', 'synth-place-gukbap', 'synth-reviewer-1', 'synth-flavor-gukbap-v1', '{"국물 농도":4,"감칠맛":5,"면 식감":3,"향신료":2,"양":4}', 'HIGH', 'ACTIVE', '2026-08-18T00:00:00Z', '2026-08-18T00:00:00Z'),
  ('synth-fr-g2', 'synth-place-gukbap', 'synth-reviewer-2', 'synth-flavor-gukbap-v1', '{"국물 농도":3,"감칠맛":4,"면 식감":4,"향신료":3,"양":3}', 'MEDIUM', 'ACTIVE', '2026-08-18T00:00:00Z', '2026-08-18T00:00:00Z'),
  ('synth-fr-g3', 'synth-place-gukbap', 'synth-reviewer-3', 'synth-flavor-gukbap-v1', '{"국물 농도":5,"감칠맛":4,"면 식감":3,"향신료":2,"양":5}', 'HIGH', 'ACTIVE', '2026-08-18T00:00:00Z', '2026-08-18T00:00:00Z'),
  ('synth-fr-r1', 'synth-place-ramen', 'synth-reviewer-1', 'synth-flavor-ramen-v1', '{"국물 농도":3,"감칠맛":4,"면 식감":5,"향신료":4,"양":3}', 'HIGH', 'ACTIVE', '2026-08-18T00:00:00Z', '2026-08-18T00:00:00Z'),
  ('synth-fr-r2', 'synth-place-ramen', 'synth-reviewer-2', 'synth-flavor-ramen-v1', '{"국물 농도":4,"감칠맛":3,"면 식감":4,"향신료":3,"양":4}', 'MEDIUM', 'ACTIVE', '2026-08-18T00:00:00Z', '2026-08-18T00:00:00Z'),
  ('synth-fr-r3', 'synth-place-ramen', 'synth-reviewer-3', 'synth-flavor-ramen-v1', '{"국물 농도":2,"감칠맛":4,"면 식감":4,"향신료":5,"양":3}', 'HIGH', 'ACTIVE', '2026-08-18T00:00:00Z', '2026-08-18T00:00:00Z');

WITH RECURSIVE seq(n) AS (
  SELECT 1
  UNION ALL
  SELECT n + 1 FROM seq WHERE n < 80
)
INSERT OR IGNORE INTO users (id, email, display_name, role, email_verified_at, created_at, updated_at)
SELECT
  printf('synth-%03d', n),
  printf('synth+%03d@example.test', n),
  printf('합성테스터 %03d', n),
  'USER',
  '2026-08-18T00:00:00Z',
  '2026-08-18T00:00:00Z',
  '2026-08-18T00:00:00Z'
FROM seq;

WITH RECURSIVE seq(n) AS (
  SELECT 1
  UNION ALL
  SELECT n + 1 FROM seq WHERE n < 80
)
INSERT OR IGNORE INTO sessions (id, user_id, expires_at, created_at)
SELECT
  printf('synth-session-%03d', n),
  printf('synth-%03d', n),
  '2027-08-18T00:00:00Z',
  '2026-08-18T00:00:00Z'
FROM seq;
