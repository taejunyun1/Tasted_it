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

-- vote_events.previous_event_id가 같은 테이블의 과거 이벤트를 RESTRICT로 참조한다.
-- 따라서 최신(leaf) 이벤트부터 제거한다. 샘플 이벤트 최대 15건을 모두 처리하도록 반복한다.
DELETE FROM vote_events WHERE place_id IN ('sample-place-1','sample-place-2','sample-place-3','sample-place-4','sample-place-5','sample-place-6') AND NOT EXISTS (SELECT 1 FROM vote_events child WHERE child.previous_event_id = vote_events.id);
DELETE FROM vote_events WHERE place_id IN ('sample-place-1','sample-place-2','sample-place-3','sample-place-4','sample-place-5','sample-place-6') AND NOT EXISTS (SELECT 1 FROM vote_events child WHERE child.previous_event_id = vote_events.id);
DELETE FROM vote_events WHERE place_id IN ('sample-place-1','sample-place-2','sample-place-3','sample-place-4','sample-place-5','sample-place-6') AND NOT EXISTS (SELECT 1 FROM vote_events child WHERE child.previous_event_id = vote_events.id);
DELETE FROM vote_events WHERE place_id IN ('sample-place-1','sample-place-2','sample-place-3','sample-place-4','sample-place-5','sample-place-6') AND NOT EXISTS (SELECT 1 FROM vote_events child WHERE child.previous_event_id = vote_events.id);
DELETE FROM vote_events WHERE place_id IN ('sample-place-1','sample-place-2','sample-place-3','sample-place-4','sample-place-5','sample-place-6') AND NOT EXISTS (SELECT 1 FROM vote_events child WHERE child.previous_event_id = vote_events.id);
DELETE FROM vote_events WHERE place_id IN ('sample-place-1','sample-place-2','sample-place-3','sample-place-4','sample-place-5','sample-place-6') AND NOT EXISTS (SELECT 1 FROM vote_events child WHERE child.previous_event_id = vote_events.id);
DELETE FROM vote_events WHERE place_id IN ('sample-place-1','sample-place-2','sample-place-3','sample-place-4','sample-place-5','sample-place-6') AND NOT EXISTS (SELECT 1 FROM vote_events child WHERE child.previous_event_id = vote_events.id);
DELETE FROM vote_events WHERE place_id IN ('sample-place-1','sample-place-2','sample-place-3','sample-place-4','sample-place-5','sample-place-6') AND NOT EXISTS (SELECT 1 FROM vote_events child WHERE child.previous_event_id = vote_events.id);
DELETE FROM vote_events WHERE place_id IN ('sample-place-1','sample-place-2','sample-place-3','sample-place-4','sample-place-5','sample-place-6') AND NOT EXISTS (SELECT 1 FROM vote_events child WHERE child.previous_event_id = vote_events.id);
DELETE FROM vote_events WHERE place_id IN ('sample-place-1','sample-place-2','sample-place-3','sample-place-4','sample-place-5','sample-place-6') AND NOT EXISTS (SELECT 1 FROM vote_events child WHERE child.previous_event_id = vote_events.id);
DELETE FROM vote_events WHERE place_id IN ('sample-place-1','sample-place-2','sample-place-3','sample-place-4','sample-place-5','sample-place-6') AND NOT EXISTS (SELECT 1 FROM vote_events child WHERE child.previous_event_id = vote_events.id);
DELETE FROM vote_events WHERE place_id IN ('sample-place-1','sample-place-2','sample-place-3','sample-place-4','sample-place-5','sample-place-6') AND NOT EXISTS (SELECT 1 FROM vote_events child WHERE child.previous_event_id = vote_events.id);
DELETE FROM vote_events WHERE place_id IN ('sample-place-1','sample-place-2','sample-place-3','sample-place-4','sample-place-5','sample-place-6') AND NOT EXISTS (SELECT 1 FROM vote_events child WHERE child.previous_event_id = vote_events.id);
DELETE FROM vote_events WHERE place_id IN ('sample-place-1','sample-place-2','sample-place-3','sample-place-4','sample-place-5','sample-place-6') AND NOT EXISTS (SELECT 1 FROM vote_events child WHERE child.previous_event_id = vote_events.id);
DELETE FROM vote_events WHERE place_id IN ('sample-place-1','sample-place-2','sample-place-3','sample-place-4','sample-place-5','sample-place-6') AND NOT EXISTS (SELECT 1 FROM vote_events child WHERE child.previous_event_id = vote_events.id);

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
