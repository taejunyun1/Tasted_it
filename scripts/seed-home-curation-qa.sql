PRAGMA foreign_keys = ON;

-- Local Playwright-only fixtures. Re-running replaces only e2e-home-* rows.
DELETE FROM golden_pick_events WHERE id LIKE 'e2e-home-%';
DELETE FROM rating_snapshots WHERE id LIKE 'e2e-home-%';
DELETE FROM place_categories WHERE place_id LIKE 'e2e-home-%';
DELETE FROM places WHERE id LIKE 'e2e-home-%';
DELETE FROM categories WHERE id LIKE 'e2e-home-%';
DELETE FROM users WHERE id LIKE 'e2e-home-%';

INSERT INTO users (id, email, display_name, role, email_verified_at, created_at, updated_at)
VALUES (
  'e2e-home-reviewer',
  'e2e-home-reviewer@retaste.local',
  '홈 큐레이션 QA 리뷰어',
  'REVIEWER',
  '2026-08-11T00:00:00Z',
  '2026-08-11T00:00:00Z',
  '2026-08-11T00:00:00Z'
);

INSERT INTO categories (id, slug, name, emoji, sort_order, is_active, created_at, updated_at) VALUES
  ('e2e-home-cat-1', 'e2e-home-gukbap', '국밥', '🍲', 901, 1, '2026-08-11T00:00:00Z', '2026-08-11T00:00:00Z'),
  ('e2e-home-cat-2', 'e2e-home-noodle', '면', '🍜', 902, 1, '2026-08-11T00:00:00Z', '2026-08-11T00:00:00Z'),
  ('e2e-home-cat-3', 'e2e-home-bakery', '베이커리', '🥐', 903, 1, '2026-08-11T00:00:00Z', '2026-08-11T00:00:00Z'),
  ('e2e-home-cat-4', 'e2e-home-meat', '고기', '🥩', 904, 1, '2026-08-11T00:00:00Z', '2026-08-11T00:00:00Z'),
  ('e2e-home-cat-5', 'e2e-home-seafood', '해산물', '🐟', 905, 1, '2026-08-11T00:00:00Z', '2026-08-11T00:00:00Z'),
  ('e2e-home-cat-6', 'e2e-home-cafe', '카페', '☕', 906, 1, '2026-08-11T00:00:00Z', '2026-08-11T00:00:00Z'),
  ('e2e-home-cat-7', 'e2e-home-low', '낮은 평가', '🍽️', 907, 1, '2026-08-11T00:00:00Z', '2026-08-11T00:00:00Z');

INSERT INTO places (
  id, slug, name, status, address, neighborhood, latitude, longitude,
  phone, parking_summary, hero_image_url, kakao_place_id, search_text,
  created_at, updated_at
) VALUES
  ('e2e-home-place-1', 'e2e-home-gukbap', 'QA 뜨끈한 국밥', 'PUBLISHED', '광주광역시 동구', '충장동', 35.1410, 126.8710, NULL, NULL, NULL, NULL, '국밥 점심 해장국', '2026-08-11T00:00:00Z', '2026-08-11T00:00:00Z'),
  ('e2e-home-place-2', 'e2e-home-noodle', 'QA 오늘의 면', 'PUBLISHED', '광주광역시 동구', '금남로', 35.1450, 126.8750, NULL, NULL, NULL, NULL, '면 점심 국수', '2026-08-11T00:00:00Z', '2026-08-11T00:00:00Z'),
  ('e2e-home-place-3', 'e2e-home-bakery', 'QA 동네 베이커리', 'PUBLISHED', '광주광역시 남구', '양림동', 35.1360, 126.8780, NULL, NULL, NULL, NULL, '베이커리 빵 커피', '2026-08-11T00:00:00Z', '2026-08-11T00:00:00Z'),
  ('e2e-home-place-4', 'e2e-home-meat', 'QA 리뷰어 고기집', 'PUBLISHED', '광주광역시 서구', '농성동', 35.1500, 126.8600, NULL, NULL, NULL, NULL, '고기 저녁 구이', '2026-08-11T00:00:00Z', '2026-08-11T00:00:00Z'),
  ('e2e-home-place-5', 'e2e-home-seafood', 'QA 새로운 해산물', 'PUBLISHED', '광주광역시 동구', '동명동', 35.1520, 126.8820, NULL, NULL, NULL, NULL, '해산물 회 새로운 메뉴', '2026-08-11T00:00:00Z', '2026-08-11T00:00:00Z'),
  ('e2e-home-place-6', 'e2e-home-cafe', 'QA 오후의 카페', 'PUBLISHED', '광주광역시 북구', '중흥동', 35.1570, 126.8680, NULL, NULL, NULL, NULL, '카페 커피 디저트', '2026-08-11T00:00:00Z', '2026-08-11T00:00:00Z'),
  ('e2e-home-place-low', 'e2e-home-low', 'QA 낮은 평가 제외', 'PUBLISHED', '광주광역시 동구', '서석동', 35.1430, 126.8660, NULL, NULL, NULL, NULL, '점심 낮은 평가', '2026-08-11T00:00:00Z', '2026-08-11T00:00:00Z');

INSERT INTO place_categories (place_id, category_id, is_primary) VALUES
  ('e2e-home-place-1', 'e2e-home-cat-1', 1),
  ('e2e-home-place-2', 'e2e-home-cat-2', 1),
  ('e2e-home-place-3', 'e2e-home-cat-3', 1),
  ('e2e-home-place-4', 'e2e-home-cat-4', 1),
  ('e2e-home-place-5', 'e2e-home-cat-5', 1),
  ('e2e-home-place-6', 'e2e-home-cat-6', 1),
  ('e2e-home-place-low', 'e2e-home-cat-7', 1);

INSERT INTO rating_snapshots (
  id, place_id, config_id, input_hash, overall_score, user_score, reviewer_score,
  overall_sample_count, user_sample_count, reviewer_sample_count, reviewer_raw_weight,
  reviewer_combined_weight, reviewer_weight_share, reasons_json, is_stale,
  computed_at, created_at, updated_at
) VALUES
  ('e2e-home-snapshot-1', 'e2e-home-place-1', 'rating-config-v2', 'e2e-home-1', 94, 93, 96, 30, 24, 6, 6, 6, 0.20, '{}', 0, '2026-08-11T00:00:00Z', '2026-08-11T00:00:00Z', '2026-08-11T00:00:00Z'),
  ('e2e-home-snapshot-2', 'e2e-home-place-2', 'rating-config-v2', 'e2e-home-2', 90, 89, 93, 26, 21, 5, 5, 5, 0.19, '{}', 0, '2026-08-11T00:00:00Z', '2026-08-11T00:00:00Z', '2026-08-11T00:00:00Z'),
  ('e2e-home-snapshot-3', 'e2e-home-place-3', 'rating-config-v2', 'e2e-home-3', 86, 85, 89, 22, 18, 4, 4, 4, 0.18, '{}', 0, '2026-08-11T00:00:00Z', '2026-08-11T00:00:00Z', '2026-08-11T00:00:00Z'),
  ('e2e-home-snapshot-4', 'e2e-home-place-4', 'rating-config-v2', 'e2e-home-4', 88, 86, 94, 24, 19, 5, 5, 5, 0.21, '{}', 0, '2026-08-11T00:00:00Z', '2026-08-11T00:00:00Z', '2026-08-11T00:00:00Z'),
  ('e2e-home-snapshot-5', 'e2e-home-place-5', 'rating-config-v2', 'e2e-home-5', 82, 81, 85, 18, 15, 3, 3, 3, 0.17, '{}', 0, '2026-08-11T00:00:00Z', '2026-08-11T00:00:00Z', '2026-08-11T00:00:00Z'),
  ('e2e-home-snapshot-6', 'e2e-home-place-6', 'rating-config-v2', 'e2e-home-6', 79, 78, 82, 16, 13, 3, 3, 3, 0.19, '{}', 0, '2026-08-11T00:00:00Z', '2026-08-11T00:00:00Z', '2026-08-11T00:00:00Z'),
  ('e2e-home-snapshot-low', 'e2e-home-place-low', 'rating-config-v2', 'e2e-home-low', 40, 39, 42, 20, 16, 4, 4, 4, 0.20, '{}', 0, '2026-08-11T00:00:00Z', '2026-08-11T00:00:00Z', '2026-08-11T00:00:00Z');

INSERT INTO golden_pick_events (
  id, reviewer_user_id, place_id, event_type, previous_event_id, reason,
  effective_at, expires_at, created_at
) VALUES (
  'e2e-home-golden-1',
  'e2e-home-reviewer',
  'e2e-home-place-4',
  'GRANT',
  NULL,
  'HOME_CURATION_QA',
  '2026-08-11T00:00:00Z',
  '2027-08-11T00:00:00Z',
  '2026-08-11T00:00:00Z'
);
