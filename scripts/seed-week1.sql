INSERT OR IGNORE INTO categories (id, slug, name, emoji, sort_order, created_at, updated_at) VALUES
  ('cat-ramen', 'ramen-detail', '라멘', '🍜', 10, '2026-08-05T00:00:00Z', '2026-08-05T00:00:00Z'),
  ('cat-donkatsu', 'donkatsu-detail', '돈가스', '🍛', 20, '2026-08-05T00:00:00Z', '2026-08-05T00:00:00Z'),
  ('cat-gukbap', 'gukbap-detail', '국밥·해장국', '🍲', 30, '2026-08-05T00:00:00Z', '2026-08-05T00:00:00Z'),
  ('cat-bakery', 'bakery-detail', '베이커리', '🥐', 40, '2026-08-05T00:00:00Z', '2026-08-05T00:00:00Z');

INSERT OR IGNORE INTO places (
  id, slug, name, status, address, neighborhood, latitude, longitude,
  phone, parking_summary, hero_image_url, kakao_place_id, search_text,
  created_at, updated_at
) VALUES
  ('sample-place-1', 'sample-dongmyeong-ramen', 'Re:Taste 샘플 라멘 동명', 'PUBLISHED', '광주광역시 동구 동명동', '동명동', 35.1490, 126.9232, NULL, '주차 정보 확인 중', NULL, NULL, 'retaste 샘플 라멘 동명 동명동', '2026-08-05T00:00:00Z', '2026-08-05T00:00:00Z'),
  ('sample-place-2', 'sample-chungjang-donkatsu', 'Re:Taste 샘플 돈까스 충장', 'PUBLISHED', '광주광역시 동구 충장로', '충장로', 35.1478, 126.9148, NULL, '주차 정보 확인 중', NULL, NULL, 'retaste 샘플 돈까스 충장 충장로', '2026-08-05T00:00:00Z', '2026-08-05T00:00:00Z'),
  ('sample-place-3', 'sample-yangnim-gukbap', 'Re:Taste 샘플 국밥 양림', 'PUBLISHED', '광주광역시 남구 양림동', '양림동', 35.1406, 126.9174, NULL, '주차 정보 확인 중', NULL, NULL, 'retaste 샘플 국밥 양림 양림동', '2026-08-05T00:00:00Z', '2026-08-05T00:00:00Z'),
  ('sample-place-4', 'sample-sangmu-bakery', 'Re:Taste 샘플 베이커리 상무', 'PUBLISHED', '광주광역시 서구 상무지구', '상무지구', 35.1536, 126.8485, NULL, '주차 정보 확인 중', NULL, NULL, 'retaste 샘플 베이커리 상무 상무지구', '2026-08-05T00:00:00Z', '2026-08-05T00:00:00Z'),
  ('sample-place-5', 'sample-chonnam-ramen', 'Re:Taste 샘플 라멘 전대', 'PUBLISHED', '광주광역시 북구 용봉동', '용봉동', 35.1762, 126.9119, NULL, '주차 정보 확인 중', NULL, NULL, 'retaste 샘플 라멘 전대 용봉동', '2026-08-05T00:00:00Z', '2026-08-05T00:00:00Z'),
  ('sample-place-6', 'sample-suwan-donkatsu', 'Re:Taste 샘플 돈까스 수완', 'PUBLISHED', '광주광역시 광산구 수완동', '수완동', 35.1904, 126.8243, NULL, '주차 정보 확인 중', NULL, NULL, 'retaste 샘플 돈까스 수완 수완동', '2026-08-05T00:00:00Z', '2026-08-05T00:00:00Z');

INSERT OR IGNORE INTO place_categories (place_id, category_id, is_primary) VALUES
  ('sample-place-1', 'cat-ramen', 1),
  ('sample-place-2', 'cat-donkatsu', 1),
  ('sample-place-3', 'cat-gukbap', 1),
  ('sample-place-4', 'cat-bakery', 1),
  ('sample-place-5', 'cat-ramen', 1),
  ('sample-place-6', 'cat-donkatsu', 1);
