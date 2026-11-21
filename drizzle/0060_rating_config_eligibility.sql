-- 공개 철회는 설정 부재로 중단하지 않고, 이전 점수를 즉시 stale 처리한다.
DROP TRIGGER reviewer_publication_recompute;

CREATE TRIGGER reviewer_publication_recompute
AFTER UPDATE OF status,content_version ON reviewer_visit_reviews
WHEN OLD.status='APPROVED' OR NEW.status='APPROVED'
BEGIN
 UPDATE rating_snapshots SET is_stale=1,updated_at=NEW.updated_at WHERE place_id=NEW.place_id;

 -- 적격 설정을 먼저 고른 뒤 그 설정의 대기/실행 작업만 중복 검사한다.
 INSERT INTO rating_recompute_jobs(id,place_id,config_id,scope,status,reason,attempts,created_at,updated_at)
 SELECT lower(hex(randomblob(16))),NEW.place_id,c.id,'PLACE','PENDING','REVIEW_MODERATION',0,NEW.updated_at,NEW.updated_at
 FROM rating_configs c
 WHERE c.id=(
  SELECT eligible.id FROM rating_configs eligible
  WHERE eligible.active_until IS NULL AND eligible.algorithm_version='rating-v2.0'
   AND julianday(eligible.active_from)<=julianday(NEW.updated_at)
  ORDER BY julianday(eligible.active_from) DESC,eligible.id ASC LIMIT 1
 )
 AND NOT EXISTS(
  SELECT 1 FROM rating_recompute_jobs j
  WHERE j.place_id=NEW.place_id AND j.config_id=c.id AND j.status IN('PENDING','RUNNING')
 );

 -- 설정 부재는 전역 OPEN 경고 한 건에 모으며, 운영 데이터는 기록하지 않는다.
 UPDATE operational_alerts
 SET severity='ERROR',message='ACTIVE_RATING_CONFIG_NOT_FOUND',
  details_json='{"code":"ACTIVE_RATING_CONFIG_NOT_FOUND"}',
  occurrence_count=occurrence_count+1,last_occurred_at=NEW.updated_at
 WHERE id=(
  SELECT id FROM operational_alerts
  WHERE alert_type='RATING_RECOMPUTE' AND status='OPEN' AND source_id='ACTIVE_RATING_CONFIG_NOT_FOUND'
  ORDER BY first_occurred_at ASC,id ASC LIMIT 1
 ) AND NOT EXISTS(
  SELECT 1 FROM rating_configs c
  WHERE c.active_until IS NULL AND c.algorithm_version='rating-v2.0'
   AND julianday(c.active_from)<=julianday(NEW.updated_at)
 );

 INSERT INTO operational_alerts(id,alert_type,severity,status,source_id,message,details_json,occurrence_count,first_occurred_at,last_occurred_at)
 SELECT lower(hex(randomblob(16))),'RATING_RECOMPUTE','ERROR','OPEN',
  'ACTIVE_RATING_CONFIG_NOT_FOUND','ACTIVE_RATING_CONFIG_NOT_FOUND',
  '{"code":"ACTIVE_RATING_CONFIG_NOT_FOUND"}',1,NEW.updated_at,NEW.updated_at
 WHERE NOT EXISTS(
  SELECT 1 FROM rating_configs c
  WHERE c.active_until IS NULL AND c.algorithm_version='rating-v2.0'
   AND julianday(c.active_from)<=julianday(NEW.updated_at)
 ) AND NOT EXISTS(
  SELECT 1 FROM operational_alerts
  WHERE alert_type='RATING_RECOMPUTE' AND status='OPEN' AND source_id='ACTIVE_RATING_CONFIG_NOT_FOUND'
 );
END;
