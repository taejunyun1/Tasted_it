-- 긴급 운영 정리: 초기 화면 검증용 샘플 맛집 6곳만 제거한다.
-- 공공데이터로 승인된 장소와 일반 사용자 데이터는 대상에 포함하지 않는다.

DELETE FROM current_votes
WHERE place_id IN (
  'sample-place-1', 'sample-place-2', 'sample-place-3',
  'sample-place-4', 'sample-place-5', 'sample-place-6'
);

DELETE FROM invalidated_vote_events
WHERE vote_event_id IN (
  SELECT id FROM vote_events
  WHERE place_id IN (
    'sample-place-1', 'sample-place-2', 'sample-place-3',
    'sample-place-4', 'sample-place-5', 'sample-place-6'
  )
);

DELETE FROM vote_events
WHERE place_id IN (
  'sample-place-1', 'sample-place-2', 'sample-place-3',
  'sample-place-4', 'sample-place-5', 'sample-place-6'
);

DELETE FROM golden_pick_events
WHERE place_id IN (
  'sample-place-1', 'sample-place-2', 'sample-place-3',
  'sample-place-4', 'sample-place-5', 'sample-place-6'
);

DELETE FROM integrity_cases
WHERE subject_type = 'PLACE'
  AND subject_id IN (
    'sample-place-1', 'sample-place-2', 'sample-place-3',
    'sample-place-4', 'sample-place-5', 'sample-place-6'
  );

-- 나머지 place 연관 테이블은 외래키 ON DELETE CASCADE/SET NULL 정책을 따른다.
DELETE FROM places
WHERE id IN (
  'sample-place-1', 'sample-place-2', 'sample-place-3',
  'sample-place-4', 'sample-place-5', 'sample-place-6'
);

-- 운영 실행 후 결과가 0이어야 한다.
SELECT COUNT(*) AS remaining_sample_places
FROM places
WHERE id IN (
  'sample-place-1', 'sample-place-2', 'sample-place-3',
  'sample-place-4', 'sample-place-5', 'sample-place-6'
);
