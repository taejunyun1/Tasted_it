-- Add-only moderation. Legacy contents and files are never approved or removed here.
ALTER TABLE places ADD COLUMN vote_revision INTEGER NOT NULL DEFAULT 0;
ALTER TABLE vote_events ADD COLUMN source TEXT NOT NULL DEFAULT 'GENERAL' CHECK(source IN ('GENERAL','REVIEWER','LEGACY_REVIEWER'));
ALTER TABLE vote_events ADD COLUMN review_id TEXT REFERENCES reviewer_visit_reviews(id) ON DELETE RESTRICT;
ALTER TABLE vote_events ADD COLUMN review_version INTEGER;
UPDATE vote_events SET source='LEGACY_REVIEWER' WHERE user_id IN (
 SELECT id FROM users WHERE role='REVIEWER'
 UNION SELECT user_id FROM reviewer_profiles
 UNION SELECT reviewer_user_id FROM reviewer_visit_reviews
);
CREATE TRIGGER vote_source_immutable BEFORE UPDATE OF source,review_id,review_version ON vote_events
BEGIN SELECT RAISE(ABORT,'VOTE_SOURCE_IMMUTABLE'); END;
CREATE TRIGGER vote_source_contract BEFORE INSERT ON vote_events
WHEN (NEW.source='REVIEWER' AND (NEW.review_id IS NULL OR NEW.review_version IS NULL))
 OR (NEW.source<>'REVIEWER' AND (NEW.review_id IS NOT NULL OR NEW.review_version IS NOT NULL))
BEGIN SELECT RAISE(ABORT,'VOTE_SOURCE_INVALID'); END;
ALTER TABLE reviewer_visit_reviews ADD COLUMN status TEXT NOT NULL DEFAULT 'LEGACY_UNREVIEWED' CHECK(status IN ('LEGACY_UNREVIEWED','PENDING','APPROVED','CHANGES_REQUESTED','REJECTED','WITHDRAWN'));
ALTER TABLE reviewer_visit_reviews ADD COLUMN is_current INTEGER NOT NULL DEFAULT 0 CHECK(is_current IN(0,1));
ALTER TABLE reviewer_visit_reviews ADD COLUMN content_version INTEGER NOT NULL DEFAULT 1;
ALTER TABLE reviewer_visit_reviews ADD COLUMN approved_content_version INTEGER;
ALTER TABLE reviewer_visit_reviews ADD COLUMN base_event_id TEXT;
ALTER TABLE reviewer_visit_reviews ADD COLUMN submitted_at TEXT;
ALTER TABLE reviewer_visit_reviews ADD COLUMN visited_on TEXT;
ALTER TABLE reviewer_visit_reviews ADD COLUMN visit_note TEXT;
ALTER TABLE reviewer_visit_reviews ADD COLUMN disclosure TEXT NOT NULL DEFAULT 'UNKNOWN' CHECK(disclosure IN('NONE','DECLARED','UNKNOWN'));
ALTER TABLE reviewer_visit_reviews ADD COLUMN golden_requested INTEGER NOT NULL DEFAULT 0;
ALTER TABLE reviewer_visit_reviews ADD COLUMN golden_reason TEXT;
ALTER TABLE reviewer_visit_reviews ADD COLUMN reviewed_by TEXT;
ALTER TABLE reviewer_visit_reviews ADD COLUMN reviewed_at TEXT;
ALTER TABLE reviewer_visit_reviews ADD COLUMN review_reason TEXT;
ALTER TABLE reviewer_visit_reviews ADD COLUMN rule_version TEXT;
CREATE UNIQUE INDEX reviewer_current_place_author_uidx ON reviewer_visit_reviews(reviewer_user_id,place_id) WHERE is_current=1;
CREATE INDEX reviewer_moderation_queue_idx ON reviewer_visit_reviews(status,updated_at);
ALTER TABLE reviewer_visit_photos ADD COLUMN content_version INTEGER NOT NULL DEFAULT 1;
ALTER TABLE reviewer_visit_photos ADD COLUMN taken_on TEXT;
ALTER TABLE reviewer_visit_photos ADD COLUMN rights_basis TEXT CHECK(rights_basis IN('OWN_WORK','PERMISSION'));
ALTER TABLE reviewer_visit_photos ADD COLUMN rights_note TEXT;
ALTER TABLE reviewer_visit_photos ADD COLUMN caption TEXT;
ALTER TABLE reviewer_visit_photos ADD COLUMN privacy_checked INTEGER NOT NULL DEFAULT 0;
ALTER TABLE golden_pick_events ADD COLUMN review_id TEXT REFERENCES reviewer_visit_reviews(id) ON DELETE RESTRICT;
ALTER TABLE golden_pick_events ADD COLUMN review_version INTEGER;
ALTER TABLE flavor_ratings ADD COLUMN review_id TEXT REFERENCES reviewer_visit_reviews(id) ON DELETE RESTRICT;
ALTER TABLE flavor_ratings ADD COLUMN review_version INTEGER;
CREATE TABLE reviewer_publication_state(id TEXT PRIMARY KEY CHECK(id='global'),epoch INTEGER NOT NULL DEFAULT 0);
INSERT INTO reviewer_publication_state(id,epoch) VALUES('global',0);
ALTER TABLE rating_snapshots ADD COLUMN vote_revision INTEGER NOT NULL DEFAULT -1;
ALTER TABLE rating_snapshots ADD COLUMN moderation_epoch INTEGER NOT NULL DEFAULT -1;
ALTER TABLE reviewer_reliability_snapshots ADD COLUMN moderation_epoch INTEGER NOT NULL DEFAULT -1;
ALTER TABLE reviewer_similarity_edges ADD COLUMN moderation_epoch INTEGER NOT NULL DEFAULT -1;
CREATE TRIGGER current_vote_insert_revision AFTER INSERT ON current_votes BEGIN UPDATE places SET vote_revision=vote_revision+1 WHERE id=NEW.place_id; END;
CREATE TRIGGER current_vote_update_revision AFTER UPDATE ON current_votes BEGIN UPDATE places SET vote_revision=vote_revision+1 WHERE id IN(OLD.place_id,NEW.place_id); END;
CREATE TRIGGER current_vote_delete_revision AFTER DELETE ON current_votes BEGIN UPDATE places SET vote_revision=vote_revision+1 WHERE id=OLD.place_id; END;
CREATE TRIGGER reviewer_state_epoch AFTER UPDATE OF status,content_version,approved_content_version ON reviewer_visit_reviews
WHEN OLD.status='APPROVED' OR NEW.status='APPROVED'
BEGIN UPDATE reviewer_publication_state SET epoch=epoch+1 WHERE id='global'; END;
CREATE TRIGGER reviewer_profile_epoch AFTER UPDATE OF status ON reviewer_profiles WHEN OLD.status<>NEW.status
BEGIN UPDATE reviewer_publication_state SET epoch=epoch+1 WHERE id='global'; END;
CREATE TRIGGER reviewer_role_epoch AFTER UPDATE OF role ON users WHEN OLD.role<>NEW.role
BEGIN UPDATE reviewer_publication_state SET epoch=epoch+1 WHERE id='global'; END;
CREATE TRIGGER public_place_epoch AFTER UPDATE OF status,closed_at ON places WHEN OLD.status<>NEW.status OR OLD.closed_at IS NOT NEW.closed_at
BEGIN UPDATE reviewer_publication_state SET epoch=epoch+1 WHERE id='global'; END;
CREATE TABLE reviewer_review_transitions(
 id TEXT PRIMARY KEY,review_id TEXT NOT NULL REFERENCES reviewer_visit_reviews(id) ON DELETE RESTRICT,
 expected_version INTEGER NOT NULL,to_version INTEGER NOT NULL,operation TEXT NOT NULL CHECK(operation IN('SUBMIT','EDIT','MODERATE','WITHDRAW')),
 actor_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,reason TEXT NOT NULL CHECK(length(trim(reason)) BETWEEN 1 AND 1000),
 before_state TEXT,after_state TEXT NOT NULL,rule_version TEXT NOT NULL,created_at TEXT NOT NULL,
 UNIQUE(review_id,to_version)
);
CREATE TRIGGER reviewer_transition_guard BEFORE INSERT ON reviewer_review_transitions BEGIN
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM reviewer_visit_reviews r WHERE r.id=NEW.review_id AND r.version=NEW.expected_version)
  THEN RAISE(ABORT,'REVIEW_VERSION_CONFLICT') END;
 SELECT CASE WHEN NEW.operation='MODERATE' AND NOT EXISTS(SELECT 1 FROM users WHERE id=NEW.actor_user_id AND role='ADMIN')
  THEN RAISE(ABORT,'ADMIN_REQUIRED') END;
 SELECT CASE WHEN NEW.operation<>'MODERATE' AND NOT EXISTS(SELECT 1 FROM reviewer_visit_reviews WHERE id=NEW.review_id AND reviewer_user_id=NEW.actor_user_id)
  THEN RAISE(ABORT,'REVIEW_OWNER_REQUIRED') END;
END;
CREATE TRIGGER reviewer_transition_immutable_update BEFORE UPDATE ON reviewer_review_transitions BEGIN SELECT RAISE(ABORT,'REVIEW_HISTORY_IMMUTABLE'); END;
CREATE TRIGGER reviewer_transition_immutable_delete BEFORE DELETE ON reviewer_review_transitions BEGIN SELECT RAISE(ABORT,'REVIEW_HISTORY_IMMUTABLE'); END;
CREATE TRIGGER golden_review_quota BEFORE INSERT ON golden_pick_events WHEN NEW.event_type='GRANT' AND NEW.review_id IS NOT NULL
BEGIN
 SELECT CASE WHEN (SELECT count(*) FROM golden_pick_events WHERE reviewer_user_id=NEW.reviewer_user_id AND event_type='GRANT' AND substr(effective_at,1,7)=substr(NEW.effective_at,1,7))>=3
 THEN RAISE(ABORT,'GOLDEN_PICK_MONTHLY_LIMIT') END;
END;

ALTER TABLE reviewer_photo_cleanup_jobs ADD COLUMN purpose TEXT NOT NULL DEFAULT 'ORPHAN' CHECK(purpose IN('ORPHAN','DELETE'));
CREATE TRIGGER invalidated_vote_epoch AFTER INSERT ON invalidated_vote_events BEGIN UPDATE reviewer_publication_state SET epoch=epoch+1 WHERE id='global'; END;
CREATE TRIGGER removed_invalidation_epoch AFTER DELETE ON invalidated_vote_events BEGIN UPDATE reviewer_publication_state SET epoch=epoch+1 WHERE id='global'; END;
CREATE TRIGGER place_delete_epoch BEFORE DELETE ON places BEGIN UPDATE reviewer_publication_state SET epoch=epoch+1 WHERE id='global'; END;
CREATE TRIGGER reviewer_photo_delete_epoch AFTER DELETE ON reviewer_visit_photos BEGIN UPDATE reviewer_publication_state SET epoch=epoch+1 WHERE id='global'; END;

-- Source events are append-only; revocations use invalidated_vote_events.
CREATE TRIGGER vote_event_fields_immutable BEFORE UPDATE ON vote_events BEGIN SELECT RAISE(ABORT,'VOTE_EVENT_IMMUTABLE'); END;
CREATE TRIGGER vote_event_delete_epoch AFTER DELETE ON vote_events BEGIN UPDATE reviewer_publication_state SET epoch=epoch+1 WHERE id='global'; END;
CREATE TRIGGER changed_invalidation_epoch AFTER UPDATE ON invalidated_vote_events BEGIN UPDATE reviewer_publication_state SET epoch=epoch+1 WHERE id='global'; END;
CREATE TRIGGER liveness_insert_epoch AFTER INSERT ON place_liveness_states BEGIN UPDATE reviewer_publication_state SET epoch=epoch+1 WHERE id='global'; END;
CREATE TRIGGER liveness_update_epoch AFTER UPDATE OF recommendation_excluded ON place_liveness_states WHEN OLD.recommendation_excluded<>NEW.recommendation_excluded BEGIN UPDATE reviewer_publication_state SET epoch=epoch+1 WHERE id='global'; END;
CREATE TRIGGER liveness_delete_epoch AFTER DELETE ON place_liveness_states BEGIN UPDATE reviewer_publication_state SET epoch=epoch+1 WHERE id='global'; END;
CREATE TRIGGER venue_name_epoch AFTER UPDATE OF name ON places WHEN OLD.name<>NEW.name BEGIN UPDATE reviewer_publication_state SET epoch=epoch+1 WHERE id='global'; END;
CREATE TRIGGER photo_metadata_epoch AFTER UPDATE ON reviewer_visit_photos BEGIN UPDATE reviewer_publication_state SET epoch=epoch+1 WHERE id='global'; END;
CREATE TRIGGER place_source_links_insert_epoch AFTER INSERT ON place_source_links BEGIN UPDATE reviewer_publication_state SET epoch=epoch+1 WHERE id='global'; END;
CREATE TRIGGER place_source_links_update_epoch AFTER UPDATE ON place_source_links BEGIN UPDATE reviewer_publication_state SET epoch=epoch+1 WHERE id='global'; END;
CREATE TRIGGER place_source_links_delete_epoch AFTER DELETE ON place_source_links BEGIN UPDATE reviewer_publication_state SET epoch=epoch+1 WHERE id='global'; END;
CREATE TRIGGER business_licenses_insert_epoch AFTER INSERT ON business_licenses BEGIN UPDATE reviewer_publication_state SET epoch=epoch+1 WHERE id='global'; END;
CREATE TRIGGER business_licenses_update_epoch AFTER UPDATE ON business_licenses BEGIN UPDATE reviewer_publication_state SET epoch=epoch+1 WHERE id='global'; END;
CREATE TRIGGER business_licenses_delete_epoch AFTER DELETE ON business_licenses BEGIN UPDATE reviewer_publication_state SET epoch=epoch+1 WHERE id='global'; END;
CREATE TRIGGER business_license_exclusions_insert_epoch AFTER INSERT ON business_license_exclusions BEGIN UPDATE reviewer_publication_state SET epoch=epoch+1 WHERE id='global'; END;
CREATE TRIGGER business_license_exclusions_update_epoch AFTER UPDATE ON business_license_exclusions BEGIN UPDATE reviewer_publication_state SET epoch=epoch+1 WHERE id='global'; END;
CREATE TRIGGER business_license_exclusions_delete_epoch AFTER DELETE ON business_license_exclusions BEGIN UPDATE reviewer_publication_state SET epoch=epoch+1 WHERE id='global'; END;
CREATE TRIGGER categories_insert_epoch AFTER INSERT ON categories BEGIN UPDATE reviewer_publication_state SET epoch=epoch+1 WHERE id='global'; END;
CREATE TRIGGER categories_update_epoch AFTER UPDATE ON categories BEGIN UPDATE reviewer_publication_state SET epoch=epoch+1 WHERE id='global'; END;
CREATE TRIGGER categories_delete_epoch AFTER DELETE ON categories BEGIN UPDATE reviewer_publication_state SET epoch=epoch+1 WHERE id='global'; END;
CREATE TRIGGER place_categories_insert_epoch AFTER INSERT ON place_categories BEGIN UPDATE reviewer_publication_state SET epoch=epoch+1 WHERE id='global'; END;
CREATE TRIGGER place_categories_update_epoch AFTER UPDATE ON place_categories BEGIN UPDATE reviewer_publication_state SET epoch=epoch+1 WHERE id='global'; END;
CREATE TRIGGER place_categories_delete_epoch AFTER DELETE ON place_categories BEGIN UPDATE reviewer_publication_state SET epoch=epoch+1 WHERE id='global'; END;
CREATE VIEW reviewer_public_place_ids AS
WITH public_place_names AS MATERIALIZED (
 SELECT id,status,closed_at,lower(replace(replace(replace(replace(replace(replace(coalesce(name,''),char(9),''),char(10),''),char(13),''),char(32),''),char(160),''),char(12288),'')) AS normalized_name FROM places WHERE id IN(SELECT place_id FROM reviewer_visit_reviews WHERE is_current=1)
), public_source_names AS MATERIALIZED (
 SELECT id,lower(replace(replace(replace(replace(replace(replace(coalesce(business_name,''),char(9),''),char(10),''),char(13),''),char(32),''),char(160),''),char(12288),'')) AS normalized_name,lower(replace(replace(replace(replace(replace(replace(coalesce(business_subtype,''),char(9),''),char(10),''),char(13),''),char(32),''),char(160),''),char(12288),'')) AS normalized_subtype FROM business_licenses WHERE id IN(SELECT business_license_id FROM place_source_links WHERE place_id IN(SELECT id FROM public_place_names))
)
SELECT p.id FROM public_place_names p WHERE
 (p.status='PUBLISHED' AND p.closed_at IS NULL)
 AND ((NOT (EXISTS(SELECT 1 FROM json_each('["룸살롱","룸싸롱","라이브바","라이브bar","라이브클럽","카바레","캬바레","콜라텍","가라오케","노래방","노래타운","뮤직타운","나이트클럽","성인나이트","관광나이트","단란주점","라이브카페","pc방","피씨방","피시방","도자기공방","가죽공방","목공방","향수공방","캔들공방","비누공방","꽃공방","플라워공방","미술공방","원데이클래스","공예방","라이브ＢＡＲ","라이브ｂａｒ"]') WHERE instr(p.normalized_name,value)>0) OR EXISTS(SELECT 1 FROM json_each('["gs25","세븐일레븐","seveneleven","이마트24","emart24","미니스톱","ministop"]') WHERE p.normalized_name LIKE value||'%') OR (p.normalized_name='cu' OR (substr(p.normalized_name,1,2)='cu' AND ((substr(p.normalized_name,3,1)>='가' AND substr(p.normalized_name,3,1)<='힣') OR (substr(p.normalized_name,3,1)>='0' AND substr(p.normalized_name,3,1)<='9')))))) OR EXISTS(SELECT 1 FROM place_source_links l INNER JOIN business_license_exclusions e ON e.business_license_id=l.business_license_id WHERE l.place_id=p.id AND e.status='OVERRIDDEN'))
 AND NOT EXISTS(SELECT 1 FROM place_source_links l INNER JOIN public_source_names b ON b.id=l.business_license_id LEFT JOIN business_license_exclusions e ON e.business_license_id=b.id WHERE l.place_id=p.id AND (e.status IS NULL OR e.status<>'OVERRIDDEN') AND ((EXISTS(SELECT 1 FROM json_each('["룸살롱","룸싸롱","라이브바","라이브bar","라이브클럽","카바레","캬바레","콜라텍","가라오케","노래방","노래타운","뮤직타운","나이트클럽","성인나이트","관광나이트","단란주점","라이브카페","pc방","피씨방","피시방","도자기공방","가죽공방","목공방","향수공방","캔들공방","비누공방","꽃공방","플라워공방","미술공방","원데이클래스","공예방","라이브ＢＡＲ","라이브ｂａｒ"]') WHERE instr(b.normalized_name,value)>0) OR EXISTS(SELECT 1 FROM json_each('["gs25","세븐일레븐","seveneleven","이마트24","emart24","미니스톱","ministop"]') WHERE b.normalized_name LIKE value||'%') OR (b.normalized_name='cu' OR (substr(b.normalized_name,1,2)='cu' AND ((substr(b.normalized_name,3,1)>='가' AND substr(b.normalized_name,3,1)<='힣') OR (substr(b.normalized_name,3,1)>='0' AND substr(b.normalized_name,3,1)<='9'))))) OR EXISTS(SELECT 1 FROM json_each('["유흥주점영업","단란주점영업","무도유흥주점업","무도장운영업","고고(디스코)클럽","카바레","캬바레","노래연습장업"]') WHERE instr(b.normalized_subtype,value)>0)))
 AND NOT EXISTS(SELECT 1 FROM place_liveness_states pls WHERE pls.place_id=p.id AND pls.recommendation_excluded=1);

CREATE TRIGGER reviewer_current_metadata_epoch AFTER UPDATE OF is_current,rule_version,reviewed_by,reviewed_at,visited_on,visit_note,disclosure,reviewer_user_id,place_id,photo_count ON reviewer_visit_reviews WHEN OLD.status='APPROVED' OR NEW.status='APPROVED' BEGIN UPDATE reviewer_publication_state SET epoch=epoch+1 WHERE id='global'; END;
CREATE TRIGGER reviewer_profile_insert_epoch AFTER INSERT ON reviewer_profiles BEGIN UPDATE reviewer_publication_state SET epoch=epoch+1 WHERE id='global'; END;
CREATE TRIGGER reviewer_profile_delete_epoch AFTER DELETE ON reviewer_profiles BEGIN UPDATE reviewer_publication_state SET epoch=epoch+1 WHERE id='global'; END;
CREATE TRIGGER reviewer_author_email_epoch AFTER UPDATE OF email ON users WHEN OLD.email<>NEW.email BEGIN UPDATE reviewer_publication_state SET epoch=epoch+1 WHERE id='global'; END;
CREATE TRIGGER reviewer_photo_insert_epoch AFTER INSERT ON reviewer_visit_photos WHEN EXISTS(SELECT 1 FROM reviewer_visit_reviews WHERE id=NEW.review_id AND status='APPROVED') BEGIN UPDATE reviewer_publication_state SET epoch=epoch+1 WHERE id='global'; END;
CREATE TRIGGER reviewer_publication_recompute AFTER UPDATE OF status,content_version ON reviewer_visit_reviews WHEN OLD.status='APPROVED' OR NEW.status='APPROVED' BEGIN
 UPDATE rating_snapshots SET is_stale=1,updated_at=NEW.updated_at WHERE place_id=NEW.place_id;
 INSERT INTO rating_recompute_jobs(id,place_id,config_id,scope,status,reason,attempts,created_at,updated_at)
 SELECT lower(hex(randomblob(16))),NEW.place_id,c.id,'PLACE','PENDING','REVIEW_MODERATION',0,NEW.updated_at,NEW.updated_at FROM rating_configs c
 WHERE c.active_until IS NULL AND NOT EXISTS(SELECT 1 FROM rating_recompute_jobs j WHERE j.place_id=NEW.place_id AND j.config_id=c.id AND j.status='PENDING') ORDER BY c.active_from DESC LIMIT 1;
END;
CREATE TRIGGER reviewer_approval_guard BEFORE UPDATE OF status ON reviewer_visit_reviews WHEN NEW.status='APPROVED' BEGIN
 SELECT CASE WHEN EXISTS(SELECT 1 FROM reviewer_photo_cleanup_jobs WHERE review_id=NEW.id AND purpose='DELETE') THEN RAISE(ABORT,'REVIEW_PHOTO_DELETE_PENDING') END;
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM reviewer_profiles p INNER JOIN users u ON u.id=p.user_id WHERE p.user_id=NEW.reviewer_user_id AND p.status='ACTIVE' AND u.role='REVIEWER' AND u.email NOT LIKE 'withdrawn.%@invalid.local') THEN RAISE(ABORT,'ACTIVE_REVIEWER_REQUIRED') END;
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM places p WHERE p.id=NEW.place_id AND p.status='PUBLISHED' AND p.closed_at IS NULL) THEN RAISE(ABORT,'PUBLISHED_PLACE_REQUIRED') END;
END;
CREATE TRIGGER golden_event_insert_epoch AFTER INSERT ON golden_pick_events BEGIN UPDATE reviewer_publication_state SET epoch=epoch+1 WHERE id='global'; END;
CREATE TRIGGER golden_event_update_epoch AFTER UPDATE ON golden_pick_events BEGIN UPDATE reviewer_publication_state SET epoch=epoch+1 WHERE id='global'; END;
CREATE TRIGGER golden_event_delete_epoch AFTER DELETE ON golden_pick_events BEGIN UPDATE reviewer_publication_state SET epoch=epoch+1 WHERE id='global'; END;
CREATE TRIGGER reviewer_golden_binding_epoch AFTER UPDATE OF golden_requested,golden_pick_event_id ON reviewer_visit_reviews WHEN OLD.status='APPROVED' OR NEW.status='APPROVED' BEGIN UPDATE reviewer_publication_state SET epoch=epoch+1 WHERE id='global'; END;
-- Reviewer projection changes revoke cross-place calibration immediately. Ordinary
-- GENERAL-only reactions retain the existing maintenance calibration cadence.
CREATE TRIGGER reviewer_vote_insert_epoch AFTER INSERT ON current_votes
WHEN EXISTS(SELECT 1 FROM vote_events WHERE id=NEW.event_id AND source='REVIEWER')
BEGIN UPDATE reviewer_publication_state SET epoch=epoch+1 WHERE id='global'; END;
CREATE TRIGGER reviewer_vote_update_epoch AFTER UPDATE ON current_votes
WHEN EXISTS(SELECT 1 FROM vote_events WHERE id IN(OLD.event_id,NEW.event_id) AND source='REVIEWER')
BEGIN UPDATE reviewer_publication_state SET epoch=epoch+1 WHERE id='global'; END;
CREATE TRIGGER reviewer_vote_delete_epoch AFTER DELETE ON current_votes
WHEN EXISTS(SELECT 1 FROM vote_events WHERE id=OLD.event_id AND source='REVIEWER')
BEGIN UPDATE reviewer_publication_state SET epoch=epoch+1 WHERE id='global'; END;
CREATE TRIGGER reviewer_current_insert_guard BEFORE INSERT ON reviewer_visit_reviews WHEN NEW.is_current=1 AND EXISTS(SELECT 1 FROM reviewer_visit_reviews WHERE reviewer_user_id=NEW.reviewer_user_id AND place_id=NEW.place_id AND is_current=1 AND id<>NEW.id) BEGIN SELECT RAISE(ABORT,'REVIEW_CURRENT_EXISTS'); END;
CREATE TRIGGER reviewer_current_update_guard BEFORE UPDATE OF is_current ON reviewer_visit_reviews WHEN NEW.is_current=1 AND EXISTS(SELECT 1 FROM reviewer_visit_reviews WHERE reviewer_user_id=NEW.reviewer_user_id AND place_id=NEW.place_id AND is_current=1 AND id<>NEW.id) BEGIN SELECT RAISE(ABORT,'REVIEW_CURRENT_EXISTS'); END;
