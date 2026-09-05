-- Additive evidence only; never backfill unknown venues as eligible.
ALTER TABLE place_review_work_items ADD COLUMN local_dining_evidence_json TEXT;
ALTER TABLE naver_local_category_verifications ADD COLUMN matched_category_path TEXT;
ALTER TABLE place_liveness_states ADD COLUMN naver_category_path TEXT;
ALTER TABLE place_liveness_states ADD COLUMN naver_subject_key TEXT;
ALTER TABLE place_liveness_states ADD COLUMN naver_mapped_category_id TEXT;
