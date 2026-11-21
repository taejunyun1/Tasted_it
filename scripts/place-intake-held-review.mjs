import { createHash } from "node:crypto";
import { z } from "zod";

const digest = z.string().regex(/^[a-f0-9]{64}$/);
const id = z.string().regex(/^[A-Za-z0-9:._-]{1,180}$/);
const reviewPlan = z.strictObject({
  batchId: digest,
  position: z.number().int().min(1).max(1000),
  workItemId: id,
  stageVersion: z.number().int().nonnegative().max(2 ** 31 - 2),
  categoryId: id.nullable(),
  targetCategorySlug: z.string().max(80).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  actorUserId: id,
  auditId: id,
  reason: z.string().trim().min(20).max(300).refine(value => !value.includes("\0")),
});
const planSchema = z.union([
  reviewPlan.extend({ licenseId: id, stage: z.enum(["CATEGORY_CONFIRMATION", "FINAL_APPROVAL"]) }),
  reviewPlan.extend({ mode: z.literal("CREATE"), placeId: id, stage: z.literal("NAVER_VERIFICATION") }),
]);

const ACTION = "PLACE_INTAKE_REVIEW_REOPEN";
const TARGET_TYPE = "PLACE_REVIEW_WORK_ITEM";
const AUTHORIZED_OPERATOR = `SELECT 1 FROM users u
  JOIN sessions s ON s.user_id = u.id
  JOIN admin_session_assurances a ON a.session_id = s.id AND a.actor_user_id = u.id
  WHERE u.id = ? AND u.role = 'ADMIN' AND u.email_verified_at IS NOT NULL
    AND u.email NOT LIKE 'withdrawn.%@invalid.local'
    AND a.method = 'PASSWORD' AND julianday(s.expires_at) > julianday('now')
    AND julianday(a.verified_at) <= julianday('now') AND julianday(a.expires_at) > julianday('now')
    AND EXISTS (SELECT 1 FROM admin_audit_logs d WHERE d.target_id = u.id
      AND d.target_type = 'USER' AND d.action = 'OPERATOR_ADMIN_PROVISIONED')
    AND NOT EXISTS (SELECT 1 FROM member_access_restrictions r WHERE r.user_id = u.id
      AND r.lifted_at IS NULL AND julianday(r.starts_at) <= julianday('now') AND julianday(r.expires_at) > julianday('now'))`;

const READY_INTAKE = `JOIN place_intake_entries e ON e.batch_id = l.batch_id AND e.position = l.position
  JOIN place_intake_batches b ON b.id = l.batch_id AND b.state = 'READY'`;
const HELD_CANDIDATE = `w.status = 'ON_HOLD' AND w.hold_code = 'ADMIN_REVIEW_HOLD'
    AND w.stage = ? AND w.stage_version = ? AND w.selected_category_id IS ? AND w.completed_at IS NULL
    AND w.claim_token IS NULL AND w.claimed_by IS NULL AND w.claimed_at IS NULL
    AND e.selection = 'CANDIDATE' AND e.region_code IN ('GWANGJU','JEONNAM','JEONBUK')
    AND e.kind IN ('DINING','CAFE')`;
const ACTIVE_LEAF_AND_OPERATOR = `EXISTS (SELECT 1 FROM categories c WHERE c.slug = ? AND c.is_active = 1
      AND NOT EXISTS (SELECT 1 FROM categories child WHERE child.parent_id = c.id AND child.is_active = 1))
    AND EXISTS (${AUTHORIZED_OPERATOR})`;

const ELIGIBLE_LINK = `SELECT w.* FROM place_review_work_items w
  JOIN place_intake_review_links l ON l.work_item_id = w.id AND l.mode = 'LINK'
  ${READY_INTAKE}
  JOIN business_licenses p ON p.id = w.business_license_id AND p.region_code = e.region_code
  WHERE l.batch_id = ? AND l.position = ? AND w.id = ? AND p.id = ? AND ${HELD_CANDIDATE}
    AND w.source_kind = 'PUBLIC_DATA' AND w.place_id IS NULL
    AND p.source_type IN ('GENERAL_RESTAURANT','REST_CAFE','BAKERY')
    AND p.normalized_status = 'OPEN' AND p.review_status = 'PENDING'
    AND p.business_name = l.subject_name AND COALESCE(p.road_address,p.lot_address) = l.subject_address
    AND p.latitude = l.subject_latitude AND p.longitude = l.subject_longitude
    AND NOT EXISTS (SELECT 1 FROM place_source_links s WHERE s.business_license_id = p.id)
    AND NOT EXISTS (SELECT 1 FROM business_license_exclusions x WHERE x.business_license_id = p.id AND x.status = 'ACTIVE')
    AND ${ACTIVE_LEAF_AND_OPERATOR}`;

const ELIGIBLE_CREATE = `SELECT w.* FROM place_review_work_items w
  JOIN place_intake_review_links l ON l.work_item_id = w.id AND l.mode = 'CREATE'
  ${READY_INTAKE}
  JOIN places p ON p.id = w.place_id
  WHERE l.batch_id = ? AND l.position = ? AND w.id = ? AND p.id = ? AND ${HELD_CANDIDATE}
    AND w.source_kind = 'PLACE_SUGGESTION' AND w.business_license_id IS NULL
    AND p.status = 'DRAFT' AND p.closed_at IS NULL
    AND p.name = l.subject_name AND e.name = l.subject_name
    AND p.address = l.subject_address AND e.address = l.subject_address
    AND p.latitude = l.subject_latitude AND e.latitude = l.subject_latitude
    AND p.longitude = l.subject_longitude AND e.longitude = l.subject_longitude
    AND ${ACTIVE_LEAF_AND_OPERATOR}`;

const AUDIT_REOPEN = `INSERT INTO admin_audit_logs (id,actor_user_id,action,target_type,target_id,before_state,after_state,created_at)
  SELECT ?,?,?,?,id,json_object('status',status,'stage',stage,'stageVersion',stage_version,
    'categoryId',selected_category_id,'categoryReason',category_override_reason,'holdCode',hold_code,'holdNote',hold_note),?,?
  FROM eligible`;

// The malformed JSON aborts the D1 transaction when either write misses its CAS.
const REQUIRE_ONE_CHANGED = "SELECT json(CASE WHEN changes()=1 THEN 'true' ELSE 'PLACE_INTAKE_REOPEN_CAS_CONFLICT' END)";

/** Reopen one approved, private intake review while preserving its provenance and visibility. */
export async function reopenHeldPlaceIntakeReview(db, planText, { approvedPlanSha256, now = new Date().toISOString() }) {
  if (typeof planText !== "string" || Buffer.byteLength(planText) > 4096
    || !digest.safeParse(approvedPlanSha256).success
    || createHash("sha256").update(planText).digest("hex") !== approvedPlanSha256) {
    throw Error("PLACE_INTAKE_REOPEN_PLAN_NOT_APPROVED");
  }

  let plan;
  try {
    plan = planSchema.parse(JSON.parse(planText));
    z.iso.datetime({ precision: 3 }).parse(now);
  } catch {
    throw Error("PLACE_INTAKE_REOPEN_PLAN_INVALID");
  }

  const {
    batchId, position, workItemId, stageVersion, stage, categoryId, targetCategorySlug,
    actorUserId, auditId, reason,
  } = plan;
  const isDraft = plan.mode === "CREATE";
  const subjectId = isDraft ? plan.placeId : plan.licenseId;
  const nextStage = isDraft ? stage : "CATEGORY_CONFIRMATION";
  const after = JSON.stringify({ status: "ACTIVE", stage: nextStage, stageVersion: stageVersion + 1,
    categoryId: isDraft ? categoryId : null, targetCategorySlug, reason, approvedPlanSha256 });
  const receipt = [auditId, actorUserId, ACTION, TARGET_TYPE];
  const eligibility = [batchId, position, workItemId, subjectId, stage, stageVersion, categoryId, targetCategorySlug, actorUserId];
  const eligible = `WITH eligible AS (${isDraft ? ELIGIBLE_CREATE : ELIGIBLE_LINK})`;
  const categoryReset = isDraft ? "" : "selected_category_id = NULL, category_override_reason = NULL,";
  let result;
  try {
    result = await db.batch([
      db.prepare(`${eligible} ${AUDIT_REOPEN}`).bind(...eligibility, ...receipt, after, now),
      db.prepare(REQUIRE_ONE_CHANGED),
      db.prepare(`${eligible} UPDATE place_review_work_items SET status = 'ACTIVE', stage = ?,
        stage_version = stage_version + 1, ${categoryReset}
        hold_code = NULL, hold_note = NULL, last_transition_by = ?, last_transition_at = ?, updated_at = ?
        WHERE changes() = 1 AND id IN (SELECT id FROM eligible)`)
        .bind(...eligibility, nextStage, actorUserId, now, now),
      db.prepare(REQUIRE_ONE_CHANGED),
    ]);
  } catch (error) {
    const subjectMatch = isDraft ? "w.place_id = ? AND w.business_license_id IS NULL" : "w.business_license_id = ?";
    const existing = await db.prepare(`SELECT 1 FROM admin_audit_logs r
      JOIN place_review_work_items w ON w.id = r.target_id AND ${subjectMatch} AND w.stage_version >= ?
      WHERE r.id = ? AND r.actor_user_id = ? AND r.action = ? AND r.target_type = ? AND r.target_id = ?
        AND r.after_state = ? AND EXISTS (${AUTHORIZED_OPERATOR})`)
      .bind(subjectId, stageVersion + 1, ...receipt, workItemId, after, actorUserId).first();
    if (existing) return { applied: 0, state: "EXISTING" };
    let cause = error;
    for (let depth = 0; depth < 4 && cause instanceof Error; depth++) {
      if (cause.message.includes("malformed JSON")) throw Error("PLACE_INTAKE_REOPEN_REJECTED", { cause: error });
      cause = cause.cause;
    }
    throw error;
  }

  if (result.length !== 4 || result.some(entry => !entry.success)
    || result[0].meta.changes !== 1 || result[2].meta.changes !== 1) throw Error("PLACE_INTAKE_REOPEN_WRITE_FAILED");
  return { applied: 1, state: "REOPENED" };
}
