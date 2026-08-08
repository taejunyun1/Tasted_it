SELECT json_object(
  'foreign_key_violations', (SELECT count(*) FROM pragma_foreign_key_check),
  'duplicate_source_keys', (SELECT count(*) FROM (
    SELECT source_type, source_management_no
    FROM business_licenses
    GROUP BY source_type, source_management_no
    HAVING count(*) > 1
  )),
  'open_pending_total', (SELECT count(*) FROM business_licenses
    WHERE normalized_status = 'OPEN' AND review_status = 'PENDING'),
  'open_pending_missing_address', (SELECT count(*) FROM business_licenses
    WHERE normalized_status = 'OPEN' AND review_status = 'PENDING'
      AND coalesce(trim(road_address), trim(lot_address), '') = ''),
  'open_pending_missing_coordinates', (SELECT count(*) FROM business_licenses
    WHERE normalized_status = 'OPEN' AND review_status = 'PENDING'
      AND (latitude IS NULL OR longitude IS NULL)),
  'candidate_coordinates_outside_korea', (SELECT count(*) FROM business_licenses
    WHERE latitude IS NOT NULL AND longitude IS NOT NULL
      AND (latitude < 33 OR latitude > 39 OR longitude < 124 OR longitude > 132)),
  'approved_candidates_total', (SELECT count(*) FROM business_licenses
    WHERE review_status = 'APPROVED'),
  'approved_without_place_link', (SELECT count(*)
    FROM business_licenses b
    LEFT JOIN place_source_links l ON l.business_license_id = b.id
    WHERE b.review_status = 'APPROVED' AND l.id IS NULL),
  'nonapproved_with_place_link', (SELECT count(*)
    FROM business_licenses b
    JOIN place_source_links l ON l.business_license_id = b.id
    WHERE b.review_status <> 'APPROVED'),
  'published_places_total', (SELECT count(*) FROM places WHERE status = 'PUBLISHED'),
  'published_without_primary_category', (SELECT count(*)
    FROM places p
    LEFT JOIN place_categories pc ON pc.place_id = p.id AND pc.is_primary = 1
    WHERE p.status = 'PUBLISHED' AND pc.place_id IS NULL),
  'places_with_multiple_primary_categories', (SELECT count(*) FROM (
    SELECT place_id FROM place_categories WHERE is_primary = 1
    GROUP BY place_id HAVING count(*) > 1
  )),
  'place_categories_inactive', (SELECT count(*)
    FROM place_categories pc
    JOIN categories c ON c.id = pc.category_id
    WHERE c.is_active = 0),
  'place_categories_nonterminal', (SELECT count(*)
    FROM place_categories pc
    WHERE EXISTS (
      SELECT 1 FROM categories child
      WHERE child.parent_id = pc.category_id AND child.is_active = 1
    )),
  'active_exclusion_approved_conflicts', (SELECT count(*)
    FROM business_license_exclusions e
    JOIN business_licenses b ON b.id = e.business_license_id
    WHERE e.status = 'ACTIVE' AND b.review_status = 'APPROVED'),
  'active_chain_exclusions', (SELECT count(*) FROM business_license_exclusions
    WHERE status = 'ACTIVE' AND reason = 'CHAIN_STORE'),
  'active_adult_exclusions', (SELECT count(*) FROM business_license_exclusions
    WHERE status = 'ACTIVE' AND reason = 'ADULT_ENTERTAINMENT'),
  'active_admin_exceptions', (SELECT count(*) FROM business_license_exclusions
    WHERE status = 'ACTIVE' AND reason = 'ADMIN_EXCEPTION'),
  'successful_ai_without_category', (SELECT count(*) FROM ai_classification_runs
    WHERE status = 'SUCCESS' AND category_slug IS NULL),
  'successful_ai_with_unknown_category', (SELECT count(*)
    FROM ai_classification_runs r
    LEFT JOIN categories c ON c.slug = r.category_slug AND c.is_active = 1
    WHERE r.status = 'SUCCESS' AND r.category_slug IS NOT NULL AND c.id IS NULL),
  'failed_ai_runs', (SELECT count(*) FROM ai_classification_runs WHERE status = 'FAILED')
) AS audit_json;
