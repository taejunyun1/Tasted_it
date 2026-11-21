import { createHash } from "node:crypto";

// Generated from the real 0049 and post-B17 D1 catalogue, not a caller-supplied
// completeness flag. The integration test reproduces both schema hashes.
export const B17_PRESERVATION_COLUMNS = {
  "account_tokens": [
    "id",
    "user_id",
    "token_hash",
    "purpose",
    "expires_at",
    "consumed_at",
    "created_at"
  ],
  "admin_audit_logs": [
    "id",
    "actor_user_id",
    "action",
    "target_type",
    "target_id",
    "before_state",
    "after_state",
    "created_at"
  ],
  "admin_operation_checks": [
    "operation_id",
    "check_name",
    "passed"
  ],
  "admin_operation_commits": [
    "operation_id",
    "actor_user_id",
    "session_id",
    "kind",
    "committed_at"
  ],
  "admin_operations": [
    "id",
    "kind",
    "actor_user_id",
    "session_id",
    "payload_json",
    "payload_hash",
    "summary_json",
    "requires_recent_auth",
    "status",
    "result_json",
    "created_at",
    "expires_at",
    "committed_at"
  ],
  "admin_reauth_challenges": [
    "id",
    "session_id",
    "actor_user_id",
    "method",
    "token_hash",
    "created_at",
    "expires_at",
    "consumed_at"
  ],
  "admin_reauth_rate_windows": [
    "bucket_hash",
    "window_started_at",
    "attempt_count"
  ],
  "admin_role_restorations": [
    "user_id",
    "previous_role"
  ],
  "admin_session_assurances": [
    "session_id",
    "actor_user_id",
    "method",
    "verified_at",
    "expires_at"
  ],
  "auth_identities": [
    "id",
    "user_id",
    "provider",
    "provider_subject",
    "provider_email",
    "created_at",
    "updated_at"
  ],
  "business_license_exclusions": [
    "business_license_id",
    "reason",
    "exclusion_category",
    "matched_rule",
    "chain_name",
    "matched_term",
    "matched_brand",
    "matched_alias",
    "chain_scope",
    "match_method",
    "match_confidence",
    "note",
    "excluded_by",
    "status",
    "excluded_at",
    "overridden_by",
    "overridden_at",
    "created_at",
    "updated_at"
  ],
  "business_licenses": [
    "id",
    "source_type",
    "source_management_no",
    "business_name",
    "business_subtype",
    "sales_status_code",
    "sales_status_name",
    "detail_status_code",
    "detail_status_name",
    "normalized_status",
    "lot_address",
    "road_address",
    "phone",
    "source_x",
    "source_y",
    "latitude",
    "longitude",
    "region_code",
    "source_updated_at",
    "raw_payload",
    "review_status",
    "review_reason",
    "reviewed_by",
    "reviewed_at",
    "first_seen_at",
    "last_seen_at",
    "created_at",
    "updated_at"
  ],
  "categories": [
    "id",
    "slug",
    "name",
    "emoji",
    "sort_order",
    "created_at",
    "updated_at",
    "parent_id",
    "description",
    "is_active"
  ],
  "current_votes": [
    "place_id",
    "user_id",
    "event_id",
    "value",
    "updated_at"
  ],
  "ev_charging_stations": [
    "id",
    "snapshot_id",
    "source_station_id",
    "name",
    "address",
    "latitude",
    "longitude",
    "fast_charger_count",
    "slow_charger_count",
    "connector_summary",
    "available_hours",
    "user_restriction",
    "parking_fee_free",
    "is_deleted",
    "reference_date",
    "raw_payload",
    "created_at",
    "updated_at"
  ],
  "flavor_ratings": [
    "id",
    "place_id",
    "reviewer_user_id",
    "template_id",
    "values_json",
    "confidence",
    "status",
    "created_at",
    "updated_at",
    "review_id",
    "review_version"
  ],
  "flavor_templates": [
    "id",
    "category_id",
    "version",
    "dimensions_json",
    "status",
    "approved_by",
    "approved_at",
    "created_at",
    "updated_at"
  ],
  "golden_pick_events": [
    "id",
    "reviewer_user_id",
    "place_id",
    "event_type",
    "previous_event_id",
    "reason",
    "effective_at",
    "expires_at",
    "created_at",
    "review_id",
    "review_version"
  ],
  "guest_saved_places": [
    "session_id",
    "place_id",
    "created_at"
  ],
  "guest_taste_badges": [
    "session_id",
    "badge_id",
    "selected_at"
  ],
  "guest_taste_sessions": [
    "id",
    "onboarding_version",
    "location_mode",
    "completed_steps_json",
    "completed_at",
    "skipped_at",
    "merged_user_id",
    "expires_at",
    "created_at",
    "updated_at",
    "selection_revision",
    "selection_epoch"
  ],
  "integrity_cases": [
    "id",
    "signal_type",
    "subject_type",
    "subject_id",
    "dedupe_key",
    "status",
    "evidence_json",
    "resolution_reason",
    "reviewed_by",
    "reviewed_at",
    "created_at",
    "updated_at"
  ],
  "invalidated_vote_events": [
    "vote_event_id",
    "integrity_case_id",
    "reason",
    "invalidated_by",
    "invalidated_at"
  ],
  "member_access_restrictions": [
    "user_id",
    "version",
    "reason",
    "starts_at",
    "expires_at",
    "lifted_at",
    "updated_by",
    "updated_at"
  ],
  "member_save_choices": [
    "user_id",
    "place_id",
    "saved",
    "updated_at"
  ],
  "naver_local_category_runs": [
    "id",
    "mode",
    "scope",
    "status",
    "after_business_license_id",
    "requested_limit",
    "scanned_count",
    "verified_count",
    "change_count",
    "conflict_count",
    "failed_count",
    "api_call_count",
    "started_at",
    "finished_at",
    "error_code",
    "created_by",
    "region_code"
  ],
  "naver_local_category_verifications": [
    "business_license_id",
    "status",
    "mapped_category_id",
    "match_score",
    "specificity_score",
    "confidence_score",
    "evidence_codes_json",
    "rule_version",
    "input_fingerprint",
    "queried_at",
    "expires_at",
    "failure_code",
    "created_at",
    "updated_at",
    "matched_category_path"
  ],
  "oauth_requests": [
    "id",
    "state_hash",
    "nonce",
    "return_to",
    "expires_at",
    "consumed_at",
    "created_at",
    "provider",
    "flow",
    "code_verifier",
    "user_id"
  ],
  "operational_alerts": [
    "id",
    "alert_type",
    "severity",
    "status",
    "source_id",
    "message",
    "details_json",
    "occurrence_count",
    "first_occurred_at",
    "last_occurred_at",
    "resolved_by",
    "resolved_at",
    "resolution_note"
  ],
  "parking_data_snapshots": [
    "id",
    "source",
    "status",
    "source_reference_date_min",
    "source_reference_date_max",
    "row_count",
    "activated_at",
    "created_at",
    "updated_at"
  ],
  "parking_ev_links": [
    "parking_facility_id",
    "ev_station_id",
    "relationship",
    "match_method",
    "confidence",
    "created_at"
  ],
  "parking_facilities": [
    "id",
    "snapshot_id",
    "source_management_no",
    "name",
    "ownership_type",
    "facility_type",
    "road_address",
    "lot_address",
    "region_code",
    "latitude",
    "longitude",
    "capacity",
    "disabled_spaces",
    "weekday_open",
    "weekday_close",
    "saturday_open",
    "saturday_close",
    "holiday_open",
    "holiday_close",
    "fee_status",
    "base_minutes",
    "base_fee",
    "additional_minutes",
    "additional_fee",
    "daily_max_fee",
    "payment_methods",
    "public_access_status",
    "reliability_grade",
    "reference_date",
    "raw_payload",
    "created_at",
    "updated_at"
  ],
  "parking_sync_runs": [
    "id",
    "source",
    "status",
    "snapshot_id",
    "next_page",
    "total_count",
    "fetched_count",
    "accepted_count",
    "skipped_count",
    "started_at",
    "finished_at",
    "error_summary",
    "created_at",
    "updated_at"
  ],
  "place_categories": [
    "place_id",
    "category_id",
    "is_primary"
  ],
  "place_category_v5_profiles": [
    "place_id",
    "primary_category_slug",
    "secondary_category_slugs_json",
    "traits_json",
    "food_place_score",
    "state",
    "decision",
    "evidence_codes_json",
    "reason_codes_json",
    "algorithm_version",
    "last_classified_at",
    "applied_at",
    "created_at",
    "updated_at"
  ],
  "place_category_v5_runs": [
    "id",
    "mode",
    "status",
    "requested_limit",
    "scanned_count",
    "stored_count",
    "verified_apply_count",
    "manual_count",
    "excluded_count",
    "error_code",
    "started_at",
    "finished_at",
    "created_by"
  ],
  "place_correction_requests": [
    "id",
    "place_id",
    "requester_user_id",
    "requester_email",
    "requester_relation",
    "request_type",
    "status",
    "requested_changes_json",
    "evidence_note",
    "verification_token_hash",
    "verification_expires_at",
    "verified_at",
    "admin_response",
    "reviewed_by",
    "reviewed_at",
    "created_at",
    "updated_at"
  ],
  "place_course_contexts": [
    "place_id",
    "traits_json",
    "source",
    "algorithm_version",
    "updated_by",
    "created_at",
    "updated_at"
  ],
  "place_daily_metrics": [
    "place_id",
    "metric_date",
    "detail_views",
    "direction_clicks",
    "save_actions"
  ],
  "place_duplicate_candidates": [
    "id",
    "suggestion_id",
    "left_place_id",
    "right_place_id",
    "confidence",
    "distance_meters",
    "reasons_json",
    "status",
    "resolved_by",
    "resolved_at",
    "created_at",
    "updated_at"
  ],
  "place_liveness_states": [
    "place_id",
    "status",
    "kakao_status",
    "matched_kakao_place_id",
    "match_score",
    "consecutive_not_found",
    "first_not_found_at",
    "last_matched_at",
    "last_checked_at",
    "next_check_at",
    "recommendation_excluded",
    "protected_until",
    "lease_token",
    "lease_expires_at",
    "evidence_json",
    "updated_at",
    "naver_status",
    "naver_match_score",
    "naver_evidence_codes_json",
    "naver_last_checked_at",
    "naver_category_path",
    "naver_subject_key",
    "naver_mapped_category_id"
  ],
  "place_operating_hours": [
    "id",
    "place_id",
    "weekday",
    "opens_at",
    "closes_at",
    "is_closed",
    "verified_by",
    "last_verified_at",
    "created_at",
    "updated_at"
  ],
  "place_revalidation_cases": [
    "id",
    "place_id",
    "reason_type",
    "status",
    "evidence_json",
    "resolution",
    "reviewed_by",
    "reviewed_at",
    "created_at",
    "updated_at"
  ],
  "place_review_duplicate_resolutions": [
    "id",
    "work_item_id",
    "candidate_place_id",
    "decision",
    "reason",
    "reviewed_by",
    "reviewed_at",
    "created_at",
    "updated_at"
  ],
  "place_review_work_items": [
    "id",
    "business_license_id",
    "place_id",
    "source_kind",
    "stage",
    "status",
    "selected_category_id",
    "category_override_reason",
    "manual_evidence_reason",
    "stage_version",
    "claim_token",
    "claimed_by",
    "claimed_at",
    "last_transition_by",
    "last_transition_at",
    "hold_code",
    "hold_note",
    "completed_at",
    "created_at",
    "updated_at",
    "local_dining_evidence_json"
  ],
  "place_revisions": [
    "id",
    "place_id",
    "actor_user_id",
    "action",
    "reason",
    "before_json",
    "after_json",
    "source_type",
    "source_id",
    "created_at"
  ],
  "place_slug_redirects": [
    "old_slug",
    "place_id",
    "created_at"
  ],
  "place_source_links": [
    "id",
    "place_id",
    "business_license_id",
    "is_primary",
    "created_at"
  ],
  "place_suggestions": [
    "id",
    "user_id",
    "status",
    "name",
    "normalized_name",
    "address",
    "normalized_address",
    "neighborhood",
    "latitude",
    "longitude",
    "phone",
    "category_id",
    "description",
    "duplicate_override_reason",
    "approved_place_id",
    "review_reason",
    "reviewed_by",
    "reviewed_at",
    "created_at",
    "updated_at"
  ],
  "places": [
    "id",
    "slug",
    "name",
    "status",
    "address",
    "neighborhood",
    "latitude",
    "longitude",
    "phone",
    "parking_summary",
    "hero_image_url",
    "kakao_place_id",
    "search_text",
    "created_at",
    "updated_at",
    "last_verified_at",
    "closed_at",
    "vote_revision"
  ],
  "product_events": [
    "id",
    "user_id",
    "guest_session_id",
    "event_name",
    "metadata_json",
    "occurred_at"
  ],
  "public_data_sync_runs": [
    "id",
    "source_type",
    "region_code",
    "address_field",
    "status",
    "next_page",
    "total_count",
    "fetched_count",
    "inserted_count",
    "updated_count",
    "skipped_count",
    "started_at",
    "finished_at",
    "error_summary",
    "created_at",
    "updated_at"
  ],
  "rate_limit_windows": [
    "bucket_hash",
    "window_started_at",
    "attempt_count"
  ],
  "rating_configs": [
    "id",
    "algorithm_version",
    "minimum_visible_samples",
    "alpha_prior",
    "beta_prior",
    "reviewer_max_share",
    "settings_json",
    "active_from",
    "active_until",
    "created_at",
    "updated_at"
  ],
  "rating_recompute_jobs": [
    "id",
    "place_id",
    "config_id",
    "scope",
    "status",
    "reason",
    "attempts",
    "error_summary",
    "started_at",
    "finished_at",
    "created_at",
    "updated_at"
  ],
  "rating_snapshots": [
    "id",
    "place_id",
    "config_id",
    "input_hash",
    "overall_score",
    "user_score",
    "reviewer_score",
    "overall_sample_count",
    "user_sample_count",
    "reviewer_sample_count",
    "reviewer_raw_weight",
    "reviewer_combined_weight",
    "reviewer_weight_share",
    "reasons_json",
    "is_stale",
    "computed_at",
    "created_at",
    "updated_at",
    "vote_revision",
    "moderation_epoch"
  ],
  "recommendation_feedback": [
    "user_id",
    "place_id",
    "value",
    "reason",
    "created_at",
    "updated_at"
  ],
  "reviewer_applications": [
    "id",
    "user_id",
    "status",
    "statement",
    "occupation",
    "taste_direction",
    "region_code",
    "specialty_slugs",
    "approved_suggestion_count",
    "override_reason",
    "admin_note",
    "reviewed_by",
    "reviewed_at",
    "created_at",
    "updated_at",
    "version"
  ],
  "reviewer_photo_cleanup_jobs": [
    "review_id",
    "object_keys_json",
    "next_attempt_at",
    "attempt_count",
    "created_at",
    "updated_at",
    "purpose"
  ],
  "reviewer_profiles": [
    "user_id",
    "slug",
    "status",
    "occupation",
    "taste_direction",
    "region_code",
    "specialty_slugs",
    "last_activity_at",
    "approved_at",
    "approved_by",
    "status_reason",
    "created_at",
    "updated_at",
    "version"
  ],
  "reviewer_publication_state": [
    "id",
    "epoch"
  ],
  "reviewer_reliability_snapshots": [
    "id",
    "reviewer_user_id",
    "config_id",
    "input_hash",
    "eligible_count",
    "correct_count",
    "posterior_accuracy",
    "reliability_weight",
    "calibration_status",
    "computed_at",
    "moderation_epoch"
  ],
  "reviewer_review_transitions": [
    "id",
    "review_id",
    "expected_version",
    "to_version",
    "operation",
    "actor_user_id",
    "reason",
    "before_state",
    "after_state",
    "rule_version",
    "created_at"
  ],
  "reviewer_similarity_edges": [
    "id",
    "config_id",
    "left_reviewer_user_id",
    "right_reviewer_user_id",
    "overlap_count",
    "agreement_rate",
    "cluster_id",
    "damping",
    "computed_at",
    "moderation_epoch"
  ],
  "reviewer_visit_photos": [
    "id",
    "review_id",
    "object_key",
    "content_type",
    "byte_size",
    "position",
    "created_at",
    "updated_at",
    "content_version",
    "taken_on",
    "rights_basis",
    "rights_note",
    "caption",
    "privacy_checked"
  ],
  "reviewer_visit_reviews": [
    "id",
    "place_id",
    "reviewer_user_id",
    "category_id",
    "evaluation",
    "badges_json",
    "photo_count",
    "golden_pick_event_id",
    "version",
    "published_at",
    "created_at",
    "updated_at",
    "status",
    "is_current",
    "content_version",
    "approved_content_version",
    "base_event_id",
    "submitted_at",
    "visited_on",
    "visit_note",
    "disclosure",
    "golden_requested",
    "golden_reason",
    "reviewed_by",
    "reviewed_at",
    "review_reason",
    "rule_version"
  ],
  "saved_places": [
    "user_id",
    "place_id",
    "created_at"
  ],
  "sessions": [
    "id",
    "user_id",
    "expires_at",
    "created_at"
  ],
  "student_invitations": [
    "id",
    "seat_code",
    "token_hash",
    "expires_at",
    "consumed_at",
    "consumed_by",
    "revoked_at",
    "created_by",
    "created_at"
  ],
  "student_seats": [
    "code",
    "label",
    "user_id",
    "is_active",
    "can_classify_places",
    "can_classify_reviews",
    "can_record_qa",
    "can_approve_registration",
    "expires_at",
    "created_at",
    "updated_at",
    "version"
  ],
  "student_task_revisions": [
    "id",
    "task_id",
    "version",
    "actor_user_id",
    "actor_seat",
    "event_type",
    "payload_json",
    "created_at"
  ],
  "student_tasks": [
    "id",
    "kind",
    "target_id",
    "title",
    "assigned_seat",
    "checker_seat",
    "is_active",
    "status",
    "version",
    "classification_json",
    "target_fingerprint",
    "submitted_by",
    "submitted_at",
    "checked_by",
    "checked_at",
    "review_note",
    "created_by",
    "created_at",
    "updated_at"
  ],
  "taste_badges": [
    "id",
    "category",
    "label",
    "headline_noun",
    "sort_order",
    "is_active",
    "created_at",
    "updated_at"
  ],
  "taste_learning_states": [
    "user_id",
    "version_token",
    "created_at",
    "updated_at"
  ],
  "temp_catalog_batches": [
    "id",
    "source_hash",
    "manifest_hash",
    "status",
    "version",
    "created_at",
    "updated_at"
  ],
  "temp_catalog_entries": [
    "id",
    "batch_id",
    "source_id",
    "place_id",
    "owns_place",
    "payload_json",
    "latitude",
    "longitude",
    "geo_status",
    "geo_code",
    "created_at",
    "updated_at"
  ],
  "temp_catalog_versions": [
    "id",
    "version"
  ],
  "temp_photo_supplement_batches": [
    "id",
    "target_batch_id",
    "manifest_hash",
    "manifest_json",
    "target_version",
    "canonical_version",
    "status",
    "version",
    "created_by",
    "updated_by",
    "created_at",
    "updated_at"
  ],
  "temp_photo_supplements": [
    "entry_id",
    "supplement_batch_id",
    "payload_json",
    "object_key",
    "created_at"
  ],
  "user_taste_badges": [
    "user_id",
    "badge_id",
    "source",
    "score",
    "evidence_json",
    "created_at",
    "updated_at"
  ],
  "users": [
    "id",
    "email",
    "display_name",
    "role",
    "created_at",
    "updated_at",
    "password_hash",
    "password_salt",
    "email_verified_at"
  ],
  "vote_events": [
    "id",
    "place_id",
    "user_id",
    "value",
    "event_type",
    "previous_event_id",
    "created_at",
    "source",
    "review_id",
    "review_version"
  ]
};
for (const columns of Object.values(B17_PRESERVATION_COLUMNS)) Object.freeze(columns);
Object.freeze(B17_PRESERVATION_COLUMNS);
const CATALOG_HASHES = {
  "before": "a228043440488179e82e9abc2f2d9b26075ad9e810ab692343bd2e80aab822fe",
  "after": "93a4c2af877e305dcee5d3ffdc33a00e753fdce6af839d66e28904b85540e17c"
};
const MIGRATION_HASHES = {
  "0000_week1.sql": "7fe2beb8d66635371e109d3020c8af9cc63601b28b0d17a1c8826125b900e821",
  "0001_public_data_candidates.sql": "6a4bb73ece1ddd5d739dd267462ed73d482d19becefe8327e788df49b47c8c73",
  "0002_category_taxonomy.sql": "a11534e71f54490b580dbbd72da017773d199aaf11362c387ee3d75c3e021e70",
  "0003_member_accounts.sql": "a72bcb18ba94087b5ad2531bad1502b47a0c062d0b6f6bda060a0bba81089cab",
  "0004_reviewer_management.sql": "2d29088c1bffb54bdd81249e12deef2597bf337ad8948e6731eaef3aa932f9b3",
  "0005_rating_foundation.sql": "b0ced12debc57a5c29fdee8870b05b47ab800e3ea28f231fee04b6eade4f80ab",
  "0006_place_operations.sql": "14cbd9be2989d894e1e95bb881ba7c9dd89511aa60c1f344c2bd05feb3578860",
  "0007_ai_operations.sql": "8f0b82ab36dbd79401771b2057eeeda276ed8b5808a723c1086fa0bac8850f22",
  "0008_ai_usage_quota.sql": "e5101d75ec50568044449dc1641ca89945560ad2cbd07594c86ee0a0bb381cfd",
  "0009_category_semantic_taxonomy.sql": "995d3cdf0218b07b7c8373751baf8756bce5a8e529014ff12816604cb37d542a",
  "0010_chain_store_exclusions.sql": "9c685ea6ceee7665e2de8372aada4fe3172057f8c5692b5e1b7e336639c455fc",
  "0011_backfill_chain_store_exclusions.sql": "e5fc1026b88f1add98d7c65743d4bcf2238a36299be418057f47ca2cd1e981a9",
  "0012_repair_category_slugs.sql": "acde7e3057b90ae4067de24ac30c85250157f1c8883d6d26eb77a7cb49240160",
  "0013_expand_candidate_exclusions.sql": "90d9753d383b326537e7f9a4ecf08ec97987e62f4fe603a660ce334738fedbb9",
  "0014_parking_foundation.sql": "5af7286cb69afbc393835e08bf39dac60c6eadb365648aa97d011bf0dea0e5c4",
  "0015_google_oauth.sql": "c5088e63983a324c8a7e8cdeb5a45cfa33921612670f35df2673154a15aff829",
  "0016_naver_oidc_auth.sql": "5a2c55c9015ef0ce3427df03cfe87a3ed42ba7cf2d7fb091e7fa04be77ec4a8e",
  "0017_profile_taste_badges.sql": "134e76bac6c0b8807a12d9cfc86aadfcd1b69ac27dfecb9285d1f791559c6d9a",
  "0018_app_first_taste_onboarding.sql": "ba9934be8f0ecba726f2898fc87c87b7329bcae7d81407ff5293ded42a220ba8",
  "0019_taste_learning_state.sql": "96b1500dad809714773d8b4b4b0a77ca510851d7ead4478f2953155730458532",
  "0020_product_event_lifecycle_uniqueness.sql": "3a20db34122b55a4c4919b5f453dc825c2abb92257d7da08d6815bdcdcd2a1ae",
  "0021_guest_onboarding_selection_revision.sql": "d160a2aad1b1e4657c5a6130e726315258199e952f05b4f8a2aa5712ca7ab9f9",
  "0022_guest_onboarding_selection_epoch.sql": "044d91ab7617d75f2bc27e08323f54df2124f585708fdf8a49af250fc6c91edb",
  "0023_onboarding_data_lifecycle.sql": "6be751a8c8285c883445698950f52b7c22c8811ab4d7e0e41cc8556355cf8559",
  "0024_reviewer_visit_reviews.sql": "bec409852fcf799b20efc71c8bc5a7f043d5e8130cbd28512c6fa99071e9a738",
  "0025_place_liveness_states.sql": "fb1dfeb4f3d2cb8fd3128a4a5957bdfab0ee46d61c40713caf859260738b2462",
  "0026_reviewer_visit_photos.sql": "4f2a4bd3fa2015027ca5cdf0e1b2df074434da5a180af9c063640076e432c4ae",
  "0027_reviewer_photo_cleanup_jobs.sql": "7fd4900ced5b5189ddf318ffc3b3ba85e0ffabd0f03121abf168d1da7c84c5ca",
  "0028_rate_limit_windows.sql": "4935bd25abb75f77ed081e598e4fe4280de4b51deeccf669002029c3071c7788",
  "0029_auto_not_restaurant_exclusion.sql": "f7f207de25d5cea2cf682fb2d0b6298c8797a2967b34b7bd55fa956cc571e5aa",
  "0030_naver_local_category_verification.sql": "e6ed30ea5ca0d1f10cf6713056e3e9bed80acbee696be5ada788fa961c4436e3",
  "0031_place_category_v5_profiles.sql": "c7435ddf77454f630182dd029803724411afb31061b73dd6c090a398b24be7db",
  "0031_remove_workers_ai.sql": "ae5156f8143e38a55ec418db11ba713054da013fc05561732a11290c1af53679",
  "0032_place_course_context.sql": "f351ed53102dc9a60ab723c141637b6b619a752fd2ba36f3a9c103376d15de6a",
  "0033_naver_place_liveness.sql": "914971126d87a7e52532ff5775eec42469236eb2339f96ddedad61d5adba2a52",
  "0034_place_review_pipeline.sql": "c30c454e5645385b7b77af93d34c7f13960451bc16d07e5621dda868eddd7572",
  "0035_naver_run_region_code.sql": "39f54c272d01e4c408ea1a957628e35dfc350ab63686fa1418efbe5dd9867808",
  "0036_local_dining_evidence.sql": "4ea67dbb352252f57f350293196b9bf865c764971abdd4265df37226a23f0c54",
  "0037_student_invitations.sql": "555ad27cafacdf3021694028f222c39c671815800a7a3a779923dcf41ec04ff7",
  "0038_student_tasks.sql": "7d9d38416deb7f0aeb8ece8a60588f4eec4b1a26d34d3ba3e385135b3d34e3df",
  "0039_student_invite_aliases.sql": "ac3f6f752390d87ee385d0b3c3a937b567ccf7fe699ad0ef12ee699683f64a8f",
  "0040_reviewer_moderation.sql": "035d0671b2a299be116739ef191e8341f828a6039a2f589d847f730067b66905",
  "0041_guest_saved_places.sql": "adb67a55155834046d3121b7064d1c82a556aa36b0437326cb77b22cdb74a655",
  "0042_admin_operation_contract.sql": "6a3d766ac4e606b4aef6eb56625ccac2e22cc40c1f62c7a9447b789ec699ace5",
  "0043_admin_session_assurance.sql": "d30a1f58583b323ce4a95c00a98c132d6e7e0d36eb121d55b24c4f0fab2bb882",
  "0044_temp_public_catalog.sql": "3bf1f42550f5a86e4df58944f55310dbff682805df46b6f9687add8ae1f44fd1",
  "0045_admin_activity_read_indexes.sql": "743390d1520ad3327d2c33b2efc84175897af9a551ba138c05eda5b1b2453804",
  "0046_temp_photo_supplements.sql": "729e59c1400e94e5f096001849537e1f72066b62e5f05f0415c6cd3c2b3c75a7",
  "0047_member_access.sql": "251055e49d88e7873e856215961bad068afe12c2bf7ca199e7e6c7b7109c938a",
  "0048_admin_people_contract.sql": "0f55167a49fd6d15290d72814f399fc710696aea3ad1eb47b03489558222bca8",
  "0049_admin_place_contract.sql": "3ccfc5247f9ee37a77a4d36a86ad53179faecea4a73642e2ea42d119d668d879",
  "0050_admin_rating_job_control.sql": "1040b11608b58469cb15ec962fc121dfbb9ff20b5874ff1f0771d4cd1af620b0",
  "0051_admin_public_sync.sql": "d38c755489c5596650ef02b99db81b190f60190a90b0166afdcae72695210524",
  "0052_admin_parking_job_control.sql": "e4c44dec46df44255c54fb3fec62e30749a4828fe8a3ad2a84dffaf40c290c7a",
  "0053_provider_usage.sql": "e42daaf0482e9d8bffbe8598630122e35d7944a810182765d6147247070bec28",
  "0054_admin_feature_stop.sql": "5e34fb63940ea081f399f679e4fafc331906df0203b9e2e5f72d3d846826cfa8",
  "0055_admin_privacy_operations.sql": "d34c91135a5e778c0e5ea1d8c462615edb75420d6c40720e8abc512b8e67ace1",
  "0056_admin_reliability.sql": "238a828cfab3ab85a414ab66d00343758ae7ab5b2c1c32f0219c15dbf19f4638",
  "0059_email_domain_control.sql": "89bf9926bd02a77814a0735af59e07df6df1161ef4e44c759d7cc8dd58e679dd",
  "0060_rating_config_eligibility.sql": "fd1a4035c86a9f5ac58396246e274b737c11986b7c27abf3d7f1b508f209309a"
};

export const B17_PRESERVATION_LIMITS = Object.freeze({
  maxTableRows: 10000, maxBatchRows: 10000, maxTotalRows: 50000,
  maxCellBytes: 262144, maxBatchBytes: 4194304, maxSnapshotBytes: 67108864,
  maxSqlBytes: 92160, maxTablesPerQuery: 12, maxResponseBytes: 16777216,
});
const FORMAT = "b17-preservation-v1";
const fail = (reason) => { throw new Error(`B17_PRESERVATION_${reason}`); };
const bytes = (s) => Buffer.byteLength(s, "utf8");
const hash = (s) => createHash("sha256").update(s).digest("hex");
const canonical = (v) => JSON.stringify(v, (_, value) => value && !Array.isArray(value) && typeof value === "object"
  ? Object.fromEntries(Object.keys(value).sort().map((k) => [k, value[k]])) : value);
const exact = (v, keys) => v && typeof v === "object" && !Array.isArray(v) && Object.keys(v).sort().join(",") === [...keys].sort().join(",");
const identifier = (s) => {
  if (typeof s !== "string" || !/^[a-z][a-z0-9_]{0,63}$/.test(s)) fail("IDENTIFIER");
  return `"${s}"`;
};

export function buildB17PreservationCatalogQuery() {
  return {
    id: "catalog", sqlStatementCount: 1, d1CommandCount: 1, maxResponseBytes: 2097152,
    sql: `SELECT 'object' AS kind,s.name AS name,s.tbl_name AS table_name,s.type AS type,s.sql AS definition,NULL AS cid,NULL AS not_null,NULL AS pk,NULL AS hidden,NULL AS default_value FROM sqlite_master s WHERE substr(s.name,1,7)<>'sqlite_' AND substr(s.name,1,4)<>'_cf_' AND s.name<>'d1_migrations' UNION ALL SELECT 'column',p.name,s.name,p.type,NULL,p.cid,p.[notnull],p.pk,p.hidden,p.dflt_value FROM sqlite_master s JOIN pragma_table_xinfo(s.name) p WHERE s.type='table' AND substr(s.name,1,7)<>'sqlite_' AND substr(s.name,1,4)<>'_cf_' AND s.name<>'d1_migrations' ORDER BY kind,table_name,name`,
  };
}

function catalogHash(catalog) {
  if (!Array.isArray(catalog) || catalog.length < 1 || catalog.length > 10000) fail("CATALOG");
  const rows = catalog.map((r) => {
    if (!exact(r, ["kind", "name", "table_name", "type", "definition", "cid", "not_null", "pk", "hidden", "default_value"])) fail("CATALOG");
    identifier(r.name); identifier(r.table_name);
    return canonical(r);
  }).sort();
  const value = `[${rows.join(",")}]`;
  if (bytes(value) > 2097152) fail("CATALOG_LIMIT");
  return hash(value);
}

function batchQuery(tables, index) {
  const l = B17_PRESERVATION_LIMITS;
  const ctes = [], selects = [];
  tables.forEach((table, i) => {
    const cols = B17_PRESERVATION_COLUMNS[table].map(identifier), t = identifier(table);
    const cellSize = `max(0,${cols.map((c) => `coalesce(length(CAST(${c} AS BLOB)),0)`).join(",")})`;
    const values = cols.map((c) => `json_array(typeof(${c}),CASE WHEN coalesce(length(CAST(${c} AS BLOB)),0)>${l.maxCellBytes} THEN NULL WHEN typeof(${c})='blob' THEN hex(${c}) WHEN typeof(${c})='integer' THEN CAST(${c} AS TEXT) WHEN typeof(${c})='real' THEN printf('%!.17g',${c}) ELSE ${c} END)`);
    ctes.push(`r${i} AS MATERIALIZED (SELECT CAST(rowid AS TEXT) AS rid,json_array(${values.join(",")}) AS payload,${cellSize} AS cell_bytes FROM ${t} ORDER BY rowid LIMIT ${l.maxTableRows + 1})`);
    ctes.push(`s${i} AS MATERIALIZED (SELECT (SELECT count(*) FROM ${t}) AS n,coalesce(sum(length(CAST(payload AS BLOB))),0) AS b,coalesce(max(cell_bytes),0) AS c FROM r${i})`);
    selects.push(`json((SELECT json_object('table_name','${table}','row_count',s.n,'payload_bytes',s.b,'max_cell_bytes',s.c,'rows',json(CASE WHEN s.n<=${l.maxTableRows} AND s.c<=${l.maxCellBytes} AND budget.n<=${l.maxBatchRows} AND budget.b<=${l.maxBatchBytes} THEN (SELECT json_group_array(json_object('row_id',rid,'values_json',payload)) FROM r${i}) ELSE '[]' END)) FROM s${i} s CROSS JOIN budget))`);
  });
  ctes.push(`budget AS MATERIALIZED (SELECT ${tables.map((_, i) => `(SELECT n FROM s${i})`).join("+")} AS n,${tables.map((_, i) => `(SELECT b FROM s${i})`).join("+")} AS b)`);
  return { id: `capture-${index}`, tables: [...tables], sql: `WITH ${ctes.join(",")} SELECT json_extract(t.value,'$.table_name') AS table_name,json_extract(t.value,'$.row_count') AS row_count,json_extract(t.value,'$.payload_bytes') AS payload_bytes,json_extract(t.value,'$.max_cell_bytes') AS max_cell_bytes,json_extract(r.value,'$.row_id') AS row_id,json_extract(r.value,'$.values_json') AS values_json FROM json_each(json_array(${selects.join(",")})) t LEFT JOIN json_each(json_extract(t.value,'$.rows')) r ON 1`,
    sqlStatementCount: 1, d1CommandCount: 1, maxRows: l.maxBatchRows + tables.length, maxResponseBytes: l.maxResponseBytes };
}

function makePlan(phase) {
  if (phase !== "before" && phase !== "after") fail("PHASE");
  const queries = [], tables = Object.keys(B17_PRESERVATION_COLUMNS).sort();
  let current = [];
  for (const table of tables) {
    const candidate = batchQuery([...current, table], queries.length);
    if (current.length && (current.length >= B17_PRESERVATION_LIMITS.maxTablesPerQuery || bytes(candidate.sql) > B17_PRESERVATION_LIMITS.maxSqlBytes)) {
      queries.push(batchQuery(current, queries.length)); current = [];
    }
    current.push(table);
    if (bytes(batchQuery(current, queries.length).sql) > B17_PRESERVATION_LIMITS.maxSqlBytes) fail("SQL_LIMIT");
  }
  if (current.length) queries.push(batchQuery(current, queries.length));
  return { format: FORMAT, phase, schemaHash: CATALOG_HASHES[phase], queries, limits: B17_PRESERVATION_LIMITS,
    sqlStatementCount: queries.length, d1CommandCount: queries.length };
}

// Offline budgeting only. It deliberately returns no executable SQL and does
// not establish runtime schema validity or authorize capture.
export function describeB17PreservationCapture() {
  const plan = makePlan("before");
  return {
    requiresRuntimeCatalog: true,
    tableCount: Object.keys(B17_PRESERVATION_COLUMNS).length,
    columnCount: Object.values(B17_PRESERVATION_COLUMNS).reduce((n, columns) => n + columns.length, 0),
    perPhase: { catalogD1Commands: 1, catalogSqlStatements: 1,
      captureD1Commands: plan.d1CommandCount, captureSqlStatements: plan.sqlStatementCount,
      maxResponseBytes: plan.limits.maxResponseBytes,
      queries: plan.queries.map(({ tables, sql }) => ({ tableCount: tables.length, sqlBytes: bytes(sql) })) },
    limits: plan.limits,
  };
}

export function planB17PreservationCapture({ phase, catalog } = {}) {
  const plan = makePlan(phase);
  if (catalogHash(catalog) !== plan.schemaHash) fail("CATALOG_MISMATCH");
  return plan;
}

function integer(v) {
  if (typeof v !== "string" || v.length > 20 || !/^(0|-?[1-9][0-9]*)$/.test(v)) fail("INTEGER");
  const n = BigInt(v);
  if (n < -9223372036854775808n || n > 9223372036854775807n) fail("INTEGER");
}
function values(payload, table) {
  if (!Array.isArray(payload) || payload.length !== B17_PRESERVATION_COLUMNS[table].length) fail("COLUMNS");
  for (const value of payload) {
    if (!Array.isArray(value) || value.length !== 2) fail("VALUE");
    const [type, v] = value;
    if (type === "null") { if (v !== null) fail("VALUE"); }
    else if (type === "integer") integer(v);
    else if (type === "real") { if (typeof v !== "string" || !/^-?(?:[0-9]+\.?[0-9]*|\.[0-9]+)(?:[eE][+-]?[0-9]+)?$/.test(v) || !Number.isFinite(Number(v))) fail("VALUE"); }
    else if (type === "blob") { if (typeof v !== "string" || !/^(?:[0-9A-F]{2})*$/.test(v) || v.length / 2 > B17_PRESERVATION_LIMITS.maxCellBytes) fail("VALUE"); }
    else if (type === "text") { if (typeof v !== "string" || bytes(v) > B17_PRESERVATION_LIMITS.maxCellBytes) fail("VALUE"); }
    else fail("VALUE");
  }
  return payload;
}
const count = (v) => { if (!Number.isSafeInteger(v) || v < 0) fail("COUNT"); return v; };

export function collectB17PreservationSnapshot(plan, resultsByQuery) {
  if (!plan || canonical(plan) !== canonical(makePlan(plan.phase))) fail("PLAN");
  if (!exact(resultsByQuery, plan.queries.map((q) => q.id))) fail("QUERIES");
  const tables = {};
  let totalRows = 0, totalBytes = 0;
  for (const q of plan.queries) {
    const result = resultsByQuery[q.id];
    if (!Array.isArray(result) || result.length > q.maxRows || bytes(JSON.stringify(result)) > q.maxResponseBytes) fail("RESPONSE_LIMIT");
    const grouped = Object.fromEntries(q.tables.map((t) => [t, []]));
    for (const row of result) {
      if (!exact(row, ["table_name", "row_count", "payload_bytes", "max_cell_bytes", "row_id", "values_json"]) || !Object.hasOwn(grouped, row.table_name)) fail("RESULT");
      grouped[row.table_name].push(row);
    }
    let batchRows = 0, batchBytes = 0;
    for (const table of q.tables) {
      const rows = grouped[table];
      if (!rows.length) fail("OMISSION");
      const first = rows[0], n = count(first.row_count), b = count(first.payload_bytes), c = count(first.max_cell_bytes);
      if (n > plan.limits.maxTableRows || c > plan.limits.maxCellBytes) fail("LIMIT");
      batchRows += n; batchBytes += b;
      const seen = new Set(), collected = [];
      let actualBytes = 0;
      for (const row of rows) {
        if (row.row_count !== n || row.payload_bytes !== b || row.max_cell_bytes !== c) fail("COUNT");
        if (n === 0) { if (rows.length !== 1 || row.row_id !== null || row.values_json !== null || b !== 0 || c !== 0) fail("EMPTY"); continue; }
        integer(row.row_id);
        if (seen.has(row.row_id) || typeof row.values_json !== "string") fail("ROW");
        seen.add(row.row_id); actualBytes += bytes(row.values_json);
        let parsed; try { parsed = JSON.parse(row.values_json); } catch { fail("JSON"); }
        collected.push({ rowid: row.row_id, values: values(parsed, table) });
      }
      if (collected.length !== n || actualBytes !== b) fail("TRUNCATED");
      collected.sort((a, b) => BigInt(a.rowid) < BigInt(b.rowid) ? -1 : 1);
      tables[table] = { columns: [...B17_PRESERVATION_COLUMNS[table]], rows: collected };
    }
    if (batchRows > plan.limits.maxBatchRows || batchBytes > plan.limits.maxBatchBytes) fail("LIMIT");
    totalRows += batchRows; totalBytes += batchBytes;
  }
  if (totalRows > plan.limits.maxTotalRows || totalBytes > plan.limits.maxSnapshotBytes) fail("LIMIT");
  const snapshot = { format: FORMAT, phase: plan.phase, schemaHash: plan.schemaHash, tables };
  if (bytes(JSON.stringify(snapshot)) > plan.limits.maxSnapshotBytes) fail("LIMIT");
  return snapshot;
}

function validateSnapshot(snapshot, phase) {
  if (!exact(snapshot, ["format", "phase", "schemaHash", "tables"]) || snapshot.format !== FORMAT || snapshot.phase !== phase || snapshot.schemaHash !== CATALOG_HASHES[phase] || !exact(snapshot.tables, Object.keys(B17_PRESERVATION_COLUMNS))) fail("SNAPSHOT");
  if (bytes(JSON.stringify(snapshot)) > B17_PRESERVATION_LIMITS.maxSnapshotBytes) fail("LIMIT");
  let total = 0;
  for (const [table, data] of Object.entries(snapshot.tables)) {
    if (!exact(data, ["columns", "rows"]) || canonical(data.columns) !== canonical(B17_PRESERVATION_COLUMNS[table]) || !Array.isArray(data.rows) || data.rows.length > B17_PRESERVATION_LIMITS.maxTableRows) fail("SNAPSHOT");
    total += data.rows.length;
    const seen = new Set();
    for (const row of data.rows) {
      if (!exact(row, ["rowid", "values"])) fail("ROW");
      integer(row.rowid); values(row.values, table);
      if (seen.has(row.rowid)) fail("ROW"); seen.add(row.rowid);
    }
  }
  if (total > B17_PRESERVATION_LIMITS.maxTotalRows) fail("LIMIT");
}

export function compareB17PreservationSnapshots(before, after) {
  validateSnapshot(before, "before"); validateSnapshot(after, "after");
  let mismatchCount = 0, rowCount = 0;
  const mismatches = [], tables = [];
  const record = (table, rowid, column) => { mismatchCount++; if (mismatches.length < 100) mismatches.push({ table, rowid, column }); };
  for (const table of Object.keys(B17_PRESERVATION_COLUMNS).sort()) {
    const normalize = (s) => [...s.tables[table].rows].sort((a, b) => BigInt(a.rowid) < BigInt(b.rowid) ? -1 : 1);
    const a = normalize(before), b = normalize(after), target = new Map(b.map((r) => [r.rowid, r]));
    rowCount += a.length;
    for (const row of a) {
      const other = target.get(row.rowid); target.delete(row.rowid);
      if (!other) record(table, row.rowid, "rowid");
      else row.values.forEach((v, i) => { if (canonical(v) !== canonical(other.values[i])) record(table, row.rowid, B17_PRESERVATION_COLUMNS[table][i]); });
    }
    for (const rowid of target.keys()) record(table, rowid, "rowid");
    tables.push({ table, beforeRows: a.length, afterRows: b.length, beforeHash: hash(canonical(a)), afterHash: hash(canonical(b)) });
  }
  return { ok: mismatchCount === 0, tableCount: tables.length, rowCount, mismatchCount, mismatches, tables };
}

export async function verifyB17PreservationSources(repositoryRoot) {
  const { readFile, readdir } = await import("node:fs/promises");
  const { join } = await import("node:path");
  const names = (await readdir(join(repositoryRoot, "drizzle"))).filter((n) => n.endsWith(".sql")).sort();
  if (canonical(names) !== canonical(Object.keys(MIGRATION_HASHES).sort())) fail("SOURCE_FILES");
  for (const name of names) if (hash(await readFile(join(repositoryRoot, "drizzle", name))) !== MIGRATION_HASHES[name]) fail("SOURCE_HASH");
  return { ok: true, migrationCount: names.length, sourceHash: hash(canonical(MIGRATION_HASHES)) };
}
