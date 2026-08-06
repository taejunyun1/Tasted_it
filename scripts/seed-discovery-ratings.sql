PRAGMA foreign_keys = ON;

-- Re-running this file replaces only discovery QA votes and picks.
DELETE FROM current_votes WHERE user_id LIKE 'qa-discovery-%';
DELETE FROM vote_events WHERE user_id LIKE 'qa-discovery-%';
DELETE FROM golden_pick_events WHERE id LIKE 'qa-discovery-%';
DELETE FROM reviewer_profiles WHERE user_id = 'qa-discovery-reviewer';
DELETE FROM users WHERE id LIKE 'qa-discovery-%';

WITH RECURSIVE numbers(value) AS (
  SELECT 1
  UNION ALL
  SELECT value + 1 FROM numbers WHERE value < 50
)
INSERT INTO users (id, email, display_name, role, email_verified_at, created_at, updated_at)
SELECT
  'qa-discovery-user-' || printf('%02d', value),
  'qa-discovery-user-' || printf('%02d', value) || '@retaste.local',
  '발견 피드 평가자 ' || printf('%02d', value),
  'USER',
  '2026-08-06T00:00:00Z',
  '2026-08-06T00:00:00Z',
  '2026-08-06T00:00:00Z'
FROM numbers
WHERE 1
ON CONFLICT(id) DO UPDATE SET updated_at = excluded.updated_at;

INSERT INTO users (id, email, display_name, role, email_verified_at, created_at, updated_at)
VALUES ('qa-discovery-reviewer', 'qa-discovery-reviewer@retaste.local', '발견 피드 리뷰어', 'REVIEWER', '2026-08-06T00:00:00Z', '2026-08-06T00:00:00Z', '2026-08-06T00:00:00Z')
ON CONFLICT(id) DO UPDATE SET role = excluded.role, updated_at = excluded.updated_at;

INSERT INTO reviewer_profiles (user_id, slug, status, occupation, taste_direction, region_code, specialty_slugs, last_activity_at, approved_at, approved_by, status_reason, created_at, updated_at)
VALUES ('qa-discovery-reviewer', 'qa-discovery-reviewer', 'ACTIVE', 'QA 음식 기록자', '다양한 추천 표본과 Golden Pick 화면을 검증합니다.', 'GWANGJU', '["korean","japanese"]', '2026-08-06T00:00:00Z', '2026-08-06T00:00:00Z', NULL, NULL, '2026-08-06T00:00:00Z', '2026-08-06T00:00:00Z')
ON CONFLICT(user_id) DO UPDATE SET status = excluded.status, last_activity_at = excluded.last_activity_at, updated_at = excluded.updated_at;

WITH RECURSIVE
numbers(value) AS (
  SELECT 1
  UNION ALL
  SELECT value + 1 FROM numbers WHERE value < 50
),
ranked_places AS (
  SELECT id, ROW_NUMBER() OVER (ORDER BY id) AS place_rank
  FROM places
  WHERE status = 'PUBLISHED'
  ORDER BY id
  LIMIT 7
),
targets AS (
  SELECT id, place_rank,
    CASE place_rank
      WHEN 1 THEN 0
      WHEN 2 THEN 3
      WHEN 3 THEN 7
      WHEN 4 THEN 8
      WHEN 5 THEN 12
      WHEN 6 THEN 25
      WHEN 7 THEN 50
    END AS sample_count,
    CASE place_rank
      WHEN 2 THEN 2
      WHEN 3 THEN 5
      WHEN 4 THEN 6
      WHEN 5 THEN 10
      WHEN 6 THEN 20
      WHEN 7 THEN 45
      ELSE 0
    END AS positive_count
  FROM ranked_places
)
INSERT INTO vote_events (id, place_id, user_id, value, event_type, previous_event_id, created_at)
SELECT
  'qa-discovery-vote-' || targets.id || '-' || printf('%02d', numbers.value),
  targets.id,
  'qa-discovery-user-' || printf('%02d', numbers.value),
  CASE WHEN numbers.value <= targets.positive_count THEN 1 ELSE -1 END,
  'CREATE',
  NULL,
  '2026-08-06T00:00:00Z'
FROM targets
JOIN numbers ON numbers.value <= targets.sample_count
WHERE 1
ON CONFLICT(id) DO UPDATE SET value = excluded.value, created_at = excluded.created_at;

INSERT INTO current_votes (place_id, user_id, event_id, value, updated_at)
SELECT place_id, user_id, id, value, '2026-08-06T00:00:00Z'
FROM vote_events
WHERE id LIKE 'qa-discovery-vote-%'
  AND 1
ON CONFLICT(place_id, user_id) DO UPDATE SET event_id = excluded.event_id, value = excluded.value, updated_at = excluded.updated_at;

WITH golden_places AS (
  SELECT id, ROW_NUMBER() OVER (ORDER BY id DESC) AS pick_rank
  FROM places
  WHERE status = 'PUBLISHED'
  ORDER BY id DESC
  LIMIT 3
)
INSERT INTO golden_pick_events (id, reviewer_user_id, place_id, event_type, previous_event_id, reason, effective_at, expires_at, created_at)
SELECT
  'qa-discovery-golden-' || pick_rank,
  'qa-discovery-reviewer',
  id,
  'GRANT',
  NULL,
  'DISCOVERY_FEED_QA',
  printf('2026-08-%02dT00:00:00Z', 3 + pick_rank),
  '2027-08-06T00:00:00Z',
  printf('2026-08-%02dT00:00:00Z', 3 + pick_rank)
FROM golden_places
WHERE 1
ON CONFLICT(id) DO UPDATE SET place_id = excluded.place_id, effective_at = excluded.effective_at, expires_at = excluded.expires_at;

SELECT
  places.id,
  places.name,
  SUM(CASE WHEN current_votes.value = 1 THEN 1 ELSE 0 END) AS positive,
  SUM(CASE WHEN current_votes.value = -1 THEN 1 ELSE 0 END) AS negative,
  COUNT(current_votes.user_id) AS sample_count
FROM places
LEFT JOIN current_votes ON current_votes.place_id = places.id AND current_votes.user_id LIKE 'qa-discovery-%'
WHERE places.status = 'PUBLISHED'
GROUP BY places.id
ORDER BY sample_count, places.id;
