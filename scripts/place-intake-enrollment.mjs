import { createHash } from "node:crypto";
import { z } from "zod";
import { parsePlaceIntake, planPrivatePlaceDrafts, stagePrivatePlaceIntake } from "./place-intake.mjs";

const hash = text => createHash("sha256").update(text).digest("hex");
const sha = z.string().regex(/^[a-f0-9]{64}$/);
const id = z.string().regex(/^[a-zA-Z0-9:._-]{1,180}$/);
const position = z.number().int().min(1).max(1000);
const subjectSchema = z.strictObject({
  name: z.string().min(1).max(300),
  address: z.string().min(1).max(800),
  latitude: z.number().min(33).max(39),
  longitude: z.number().min(124).max(132),
});
const planSchema = z.strictObject({
  format: z.literal("retaste-intake-enrollment-v1"),
  intakeSha256: sha,
  entries: z.array(z.discriminatedUnion("mode", [
    z.strictObject({ mode: z.literal("CREATE"), position }),
    z.strictObject({ mode: z.literal("LINK"), position, workItemId: id, licenseId: id, stageVersion: z.number().int().min(0), subject: subjectSchema }),
  ])).min(1).max(100),
});

function planEnrollment(intakeText, planText, approvedPlanSha256) {
  if (typeof planText !== "string" || Buffer.byteLength(planText) > 96_000 || hash(planText) !== approvedPlanSha256) {
    throw Error("PLACE_INTAKE_PLAN_NOT_APPROVED");
  }
  let plan;
  try {
    plan = planSchema.parse(JSON.parse(planText));
  } catch {
    throw Error("PLACE_INTAKE_PLAN_INVALID");
  }
  const intake = parsePlaceIntake(intakeText);
  if (plan.intakeSha256 !== hash(intakeText)) throw Error("PLACE_INTAKE_PLAN_INPUT_CHANGED");
  const candidates = intake.rows.filter(row => row.selection === "CANDIDATE");
  const drafts = planPrivatePlaceDrafts(intakeText);
  const byPosition = new Map(candidates.map((row, index) => [row.position, drafts[index]]));
  if (plan.entries.length !== byPosition.size || new Set(plan.entries.map(row => row.position)).size !== byPosition.size) {
    throw Error("PLACE_INTAKE_PLAN_COVERAGE");
  }

  const workIds = new Set();
  const licenseIds = new Set();
  const entries = plan.entries.map(entry => {
    const draft = byPosition.get(entry.position);
    if (!draft) throw Error("PLACE_INTAKE_PLAN_COVERAGE");
    if (entry.mode === "LINK") {
      if (workIds.has(entry.workItemId) || licenseIds.has(entry.licenseId)) throw Error("PLACE_INTAKE_PLAN_DUPLICATE");
      workIds.add(entry.workItemId);
      licenseIds.add(entry.licenseId);
      return entry;
    }
    return {
      ...entry,
      workItemId: `intake:${intake.id}:${entry.position}`,
      placeId: draft.slug,
      slug: draft.slug,
      subject: { name: draft.name, address: draft.address, latitude: draft.latitude, longitude: draft.longitude },
    };
  });
  return { batchId: intake.id, entries };
}

const ACTIVE_ADMIN = `SELECT 1 FROM users u WHERE u.id=? AND u.role='ADMIN'
  AND u.email_verified_at IS NOT NULL AND u.email NOT LIKE 'withdrawn.%@invalid.local'
  AND NOT EXISTS (SELECT 1 FROM member_access_restrictions r WHERE r.user_id=u.id AND r.lifted_at IS NULL
    AND julianday(r.starts_at)<=julianday('now') AND julianday(r.expires_at)>julianday('now'))`;

async function checkEnrollment(db, prepared) {
  const stored = await db.prepare(`SELECT position,mode,work_item_id,subject_name,subject_address,subject_latitude,subject_longitude
    FROM place_intake_review_links WHERE batch_id=? ORDER BY position`).bind(prepared.batchId).all();
  if (!stored.success || !Array.isArray(stored.results)) throw Error("PLACE_INTAKE_ENROLLMENT_READ_FAILED");
  if (!stored.results.length) return false;
  const match = new Map(stored.results.map(row => [row.position, row]));
  if (match.size !== prepared.entries.length || prepared.entries.some(entry => {
    const row = match.get(entry.position);
    return !row || row.mode !== entry.mode || row.work_item_id !== entry.workItemId
      || row.subject_name !== entry.subject.name || row.subject_address !== entry.subject.address
      || row.subject_latitude !== entry.subject.latitude || row.subject_longitude !== entry.subject.longitude;
  })) throw Error("PLACE_INTAKE_ENROLLMENT_MISMATCH");
  return true;
}

const DATA = `WITH input AS (SELECT value AS item FROM json_each(?))`;
const field = key => `json_extract(item,'$.${key}')`;
const WRITE_DRAFTS = `${DATA}
  INSERT INTO places(id,slug,name,status,address,neighborhood,latitude,longitude,search_text,created_at,updated_at)
  SELECT ${field("placeId")},${field("slug")},
    CASE WHEN EXISTS (SELECT 1 FROM places older
      WHERE replace(lower(older.name),' ','')=replace(lower(e.name),' ','')
        AND trim(CASE WHEN instr(older.address,'(')>0 THEN substr(older.address,1,instr(older.address,'(')-1) ELSE older.address END)
          =trim(CASE WHEN instr(e.address,'(')>0 THEN substr(e.address,1,instr(e.address,'(')-1) ELSE e.address END))
      THEN NULL ELSE e.name END,
    'DRAFT',e.address,e.neighborhood,e.latitude,e.longitude,
    lower(e.name||' '||e.address||' '||e.neighborhood),?,?
  FROM input LEFT JOIN place_intake_entries e ON e.batch_id=? AND e.position=${field("position")}`;
const WRITE_PRIMARY_CATEGORIES = `${DATA}
  INSERT INTO place_categories(place_id,category_id,is_primary)
  SELECT ${field("placeId")},c.id,1 FROM input
  LEFT JOIN place_intake_entries e ON e.batch_id=? AND e.position=${field("position")}
  LEFT JOIN categories c ON c.slug=e.category_slug AND c.is_active=1
    AND NOT EXISTS (SELECT 1 FROM categories child WHERE child.parent_id=c.id AND child.is_active=1)`;
const WRITE_WORK_ITEMS = `${DATA}
  INSERT INTO place_review_work_items(id,place_id,source_kind,stage,status,stage_version,created_at,updated_at)
  SELECT ${field("workItemId")},${field("placeId")},'PLACE_SUGGESTION','SOURCE_REVIEW','ACTIVE',0,?,? FROM input`;
const WRITE_LINKS = `${DATA}
  INSERT INTO place_intake_review_links
    (batch_id,position,work_item_id,mode,actor_user_id,enrolled_at,subject_name,subject_address,subject_latitude,subject_longitude)
  SELECT ?,${field("position")},
    CASE WHEN ${field("mode")}='CREATE' OR (
      w.stage_version=${field("stageVersion")} AND w.business_license_id=${field("licenseId")} AND w.claim_token IS NULL
    ) THEN ${field("workItemId")} ELSE NULL END,
    ${field("mode")},?,?,${field("subject.name")},${field("subject.address")},${field("subject.latitude")},${field("subject.longitude")}
  FROM input LEFT JOIN place_review_work_items w ON w.id=${field("workItemId")}`;

function chunks(entries) {
  const encoded = [];
  for (let i = 0; i < entries.length; i += 20) encoded.push(JSON.stringify(entries.slice(i, i + 20)));
  return encoded;
}

/** Trusted D1 operator only. Archive and queue enrollment have separate, replay-safe commits. */
export async function enrollPrivatePlaceIntake(db, intakeText, planText, { actorUserId, approvedPlanSha256 }) {
  const prepared = planEnrollment(intakeText, planText, approvedPlanSha256);
  if (!id.safeParse(actorUserId).success || !(await db.prepare(ACTIVE_ADMIN).bind(actorUserId).first())) {
    throw Error("PLACE_INTAKE_ADMIN_REQUIRED");
  }
  const archive = await stagePrivatePlaceIntake(db, intakeText);
  const drafts = prepared.entries.filter(entry => entry.mode === "CREATE");
  const totals = { batchId: prepared.batchId, total: archive.total, linked: prepared.entries.length - drafts.length, created: drafts.length };
  if (await checkEnrollment(db, prepared)) return { ...totals, state: "EXISTING" };

  const now = new Date().toISOString();
  const statements = [];
  for (const chunk of chunks(drafts)) {
    statements.push(db.prepare(WRITE_DRAFTS).bind(chunk, now, now, prepared.batchId));
    statements.push(db.prepare(WRITE_PRIMARY_CATEGORIES).bind(chunk, prepared.batchId));
    statements.push(db.prepare(WRITE_WORK_ITEMS).bind(chunk, now, now));
  }
  for (const chunk of chunks(prepared.entries)) {
    statements.push(db.prepare(WRITE_LINKS).bind(chunk, prepared.batchId, actorUserId, now));
  }
  statements.push(db.prepare(`INSERT INTO admin_audit_logs(id,actor_user_id,action,target_type,target_id,after_state,created_at)
      VALUES(?,?,'PLACE_INTAKE_REVIEW_ENROLL','PLACE_INTAKE_BATCH',?,?,?)`)
    .bind(`intake-review:${prepared.batchId}`, actorUserId, prepared.batchId, JSON.stringify(totals), now));
  try {
    const results = await db.batch(statements);
    if (results.length !== statements.length || results.some(result => !result.success)) throw Error("PLACE_INTAKE_ENROLLMENT_WRITE");
  } catch {
    if (!(await checkEnrollment(db, prepared))) throw Error("PLACE_INTAKE_ENROLLMENT_REJECTED");
    return { ...totals, state: "EXISTING" };
  }
  if (!(await checkEnrollment(db, prepared))) throw Error("PLACE_INTAKE_ENROLLMENT_READBACK_FAILED");
  return { ...totals, state: "ENROLLED" };
}
