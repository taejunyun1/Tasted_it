-- 베타 운영 규모의 읽기 전용 스냅샷이다. 반환값은 고정 지표명과 정수 개수뿐이다.
-- PUBLISHED 원시 개수는 실제 공개 조회 적격성이나 베타 GO를 보장하지 않는다.
-- 최종 공개 판단에는 실제 공개 action의 도메인 게이트를 그대로 사용한다.
WITH
  published AS (SELECT id, last_verified_at, closed_at FROM places WHERE status = 'PUBLISHED'),
  active_items AS (SELECT * FROM place_review_work_items WHERE status = 'ACTIVE'),
  category_stage AS (
    SELECT * FROM active_items
    WHERE stage IN ('CATEGORY_CONFIRMATION', 'DUPLICATE_REVIEW', 'FINAL_APPROVAL')
  ),
  candidate_items AS (SELECT * FROM active_items WHERE business_license_id IS NOT NULL),
  place_items AS (SELECT * FROM active_items WHERE place_id IS NOT NULL)
SELECT 'places_total' AS metric, count(*) AS count FROM places
UNION ALL SELECT 'places_published', count(*) FROM published
UNION ALL SELECT 'places_hidden', count(*) FROM places WHERE status = 'HIDDEN'
UNION ALL SELECT 'places_draft', count(*) FROM places WHERE status = 'DRAFT'
UNION ALL SELECT 'published_without_verified_at', count(*) FROM published WHERE nullif(trim(last_verified_at), '') IS NULL
UNION ALL SELECT 'published_closed', count(*) FROM published WHERE closed_at IS NOT NULL
UNION ALL SELECT 'published_without_primary_category', count(*) FROM published p
  WHERE NOT EXISTS (SELECT 1 FROM place_categories pc WHERE pc.place_id = p.id AND pc.is_primary = 1)
UNION ALL SELECT 'published_multiple_primary_categories', count(*) FROM published p
  WHERE (SELECT count(*) FROM place_categories pc WHERE pc.place_id = p.id AND pc.is_primary = 1) >= 2
-- 출처 링크 없음은 추가 확인 대상이다. 사용자 제안 등 다른 출처의 위법·실패 판정이 아니다.
UNION ALL SELECT 'published_without_source_link', count(*) FROM published p
  WHERE NOT EXISTS (SELECT 1 FROM place_source_links l WHERE l.place_id = p.id)
UNION ALL SELECT 'published_active_primary_leaf_category_count', count(DISTINCT pc.category_id)
  FROM published p
  JOIN place_categories pc ON pc.place_id = p.id AND pc.is_primary = 1
  JOIN categories c ON c.id = pc.category_id AND c.is_active = 1
  WHERE NOT EXISTS (SELECT 1 FROM categories child WHERE child.parent_id = c.id AND child.is_active = 1)
UNION ALL SELECT 'review_active_total', count(*) FROM active_items
UNION ALL SELECT 'review_on_hold_total', count(*) FROM place_review_work_items WHERE status = 'ON_HOLD'
UNION ALL SELECT 'review_completed_total', count(*) FROM place_review_work_items WHERE status = 'COMPLETED'
UNION ALL SELECT 'review_excluded_total', count(*) FROM place_review_work_items WHERE status = 'EXCLUDED'
-- 단계별 행은 해당 단계가 비어 있어도 0으로 반환한다.
UNION ALL SELECT 'review_active_source_review', count(*) FROM active_items WHERE stage = 'SOURCE_REVIEW'
UNION ALL SELECT 'review_active_naver_verification', count(*) FROM active_items WHERE stage = 'NAVER_VERIFICATION'
UNION ALL SELECT 'review_active_category_confirmation', count(*) FROM active_items WHERE stage = 'CATEGORY_CONFIRMATION'
UNION ALL SELECT 'review_active_duplicate_review', count(*) FROM active_items WHERE stage = 'DUPLICATE_REVIEW'
UNION ALL SELECT 'review_active_final_approval', count(*) FROM active_items WHERE stage = 'FINAL_APPROVAL'
UNION ALL SELECT 'active_subject_missing', count(*) FROM active_items w
  LEFT JOIN business_licenses b ON b.id = w.business_license_id
  LEFT JOIN places p ON p.id = w.place_id
  WHERE (w.business_license_id IS NOT NULL AND b.id IS NULL)
     OR (w.place_id IS NOT NULL AND p.id IS NULL)
UNION ALL SELECT 'active_source_missing_address', count(*) FROM active_items w
  LEFT JOIN business_licenses b ON b.id = w.business_license_id
  LEFT JOIN places p ON p.id = w.place_id
  WHERE (w.business_license_id IS NOT NULL
           AND coalesce(nullif(trim(b.road_address), ''), nullif(trim(b.lot_address), ''), '') = '')
     OR (w.place_id IS NOT NULL AND coalesce(trim(p.address), '') = '')
-- 좌표 0은 NULL과 구분한다. 누락된 원본은 위의 별도 지표에도 잡힌다.
UNION ALL SELECT 'active_source_missing_coordinates', count(*) FROM active_items w
  LEFT JOIN business_licenses b ON b.id = w.business_license_id
  LEFT JOIN places p ON p.id = w.place_id
  WHERE (w.business_license_id IS NOT NULL AND (b.latitude IS NULL OR b.longitude IS NULL))
     OR (w.place_id IS NOT NULL AND (p.latitude IS NULL OR p.longitude IS NULL))
UNION ALL SELECT 'active_with_hold_code', count(*) FROM active_items
  WHERE nullif(trim(hold_code), '') IS NOT NULL
-- 선택 분류 지표의 분모는 3~5단계 ACTIVE 작업만이다.
UNION ALL SELECT 'active_selected_category_missing', count(*) FROM category_stage w
  LEFT JOIN categories c ON c.id = w.selected_category_id
  WHERE c.id IS NULL
UNION ALL SELECT 'active_selected_category_inactive_or_nonleaf', count(*) FROM category_stage w
  JOIN categories c ON c.id = w.selected_category_id
  WHERE c.is_active = 0
     OR EXISTS (SELECT 1 FROM categories child WHERE child.parent_id = c.id AND child.is_active = 1)
-- 수동 근거의 길이만 확인한다. 내용 검증이나 승인 증거는 아니다.
UNION ALL SELECT 'active_manual_evidence_present', count(*) FROM active_items
  WHERE length(trim(coalesce(manual_evidence_reason, ''))) >= 20
-- NAVER 상태는 현재성·원본 지문·지역 음식점 판정을 대신하지 않는다.
-- 미확인은 상태 행 부재 또는 SKIPPED를 뜻한다.
UNION ALL SELECT 'active_candidate_naver_unchecked', count(*) FROM candidate_items w
  LEFT JOIN naver_local_category_verifications n ON n.business_license_id = w.business_license_id
  WHERE n.business_license_id IS NULL OR n.status = 'SKIPPED'
UNION ALL SELECT 'active_candidate_naver_verified', count(*) FROM candidate_items w
  JOIN naver_local_category_verifications n ON n.business_license_id = w.business_license_id
  WHERE n.status = 'VERIFIED'
UNION ALL SELECT 'active_candidate_naver_needs_attention', count(*) FROM candidate_items w
  JOIN naver_local_category_verifications n ON n.business_license_id = w.business_license_id
  WHERE n.status IN ('NO_MATCH', 'LIKELY', 'AMBIGUOUS', 'FAILED', 'OUT_OF_SCOPE')
UNION ALL SELECT 'active_place_naver_unchecked', count(*) FROM place_items w
  LEFT JOIN place_liveness_states s ON s.place_id = w.place_id
  WHERE s.place_id IS NULL OR s.naver_status = 'SKIPPED'
UNION ALL SELECT 'active_place_naver_matched', count(*) FROM place_items w
  JOIN place_liveness_states s ON s.place_id = w.place_id
  WHERE s.naver_status = 'MATCHED'
UNION ALL SELECT 'active_place_naver_needs_attention', count(*) FROM place_items w
  JOIN place_liveness_states s ON s.place_id = w.place_id
  WHERE s.naver_status IN ('NOT_FOUND', 'AMBIGUOUS', 'ERROR');
