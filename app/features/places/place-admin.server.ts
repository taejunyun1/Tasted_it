import { getTableColumns, getTableName, type Table } from "drizzle-orm";
import { z } from "zod";
import { createDb } from "../../db/client.server";
import * as schema from "../../db/schema";
import { extractNeighborhood } from "../candidates/category-suggestion";
import { classifyChainStore } from "../candidates/chain-store-policy";
import { commitAdminOperation, getVerifiedAdminOperation, prepareAdminOperation } from "../operations/admin-operation.server";
import { regionFromAddress } from "../regions/region-pack";
import { reviewDiningContextFromRows } from "./local-dining-review.server";
import { buildPlaceMergeStatements, type PlaceMergeSnapshot } from "./place-merge.server";
import { normalizePlaceName } from "./place-name-groups";
import { slugifyPlaceNameForAddress } from "./place-slug";
import { newReviewWorkItemValues } from "./place-review-work-items.server";
import { placeAdminCommandSchema, placeAdminResultSchema, PLACE_ADMIN_CHANGE_LABELS, type PlaceAdminCommand, type PlaceAdminImpact, type PlaceAdminResult, type PlaceAdminView } from "./place-admin";
import { placeSnapshotDigest, placeSnapshotStatement, type PlaceSnapshot, type PlaceSnapshotScope } from "./place-admin-snapshot.server";
import { calculatePlaceAdminImpact } from "./place-admin-impact.server";

type Caller = { actorUserId: string; sessionId: string; now: string };
type PublishCommand = Extract<PlaceAdminCommand, { change: "PUBLISH" }>;
const payloadSchema = z.object({ command: placeAdminCommandSchema, digest: z.string().regex(/^[a-f0-9]{64}$/),
  scope: z.object({ workItemId: z.string().optional(), sourcePlaceId: z.string().optional(), targetPlaceId: z.string().optional(), intakeUnitRevisionId: z.uuid().optional() }).strict(),
  targetId: z.string(), slug: z.string().optional(), newWorkItemId: z.string().optional(),
  correctionDigest: z.string().regex(/^[a-f0-9]{64}$/).optional(),
  impact: z.record(z.string(), z.number().int().min(-1)),
}).strict().refine(({ command, scope, targetId, correctionDigest }) => {
  const bindsCorrection = command.change === "RECALL" && Boolean(command.correction);
  if (bindsCorrection !== Boolean(correctionDigest) || (bindsCorrection
    && (command.placeId !== targetId || scope.targetPlaceId !== targetId || scope.sourcePlaceId || scope.workItemId))) return false;
  const revisionId = command.change === "PUBLISH" ? command.intakeUnitCorrection?.revisionId : undefined;
  return scope.intakeUnitRevisionId === revisionId && (revisionId === undefined
    || (command.change === "PUBLISH" && scope.workItemId === command.workItemId && !scope.sourcePlaceId && !scope.targetPlaceId));
});
const unitCorrectionBefore = z.object({ address: z.string() }).strict();
const unitCorrectionAfter = z.object({ address: z.string(), batchId: z.string(), position: z.number().int().positive(),
  unit: z.number().int().min(1).max(99_999), approvedPlanSha256: z.string().regex(/^[a-f0-9]{64}$/),
}).strict();
type Payload = z.infer<typeof payloadSchema>;
function fail(code = "PLACE_ADMIN_NOT_ELIGIBLE"): never { throw new Error(code); }
function first(rows: PlaceSnapshot, key: string, id?: string, field = "id") {
  return rows[key]?.find((row) => id === undefined || row[field] === id);
}
function mapped<T>(row: Record<string, unknown>, table: Table): T {
  const columns = getTableColumns(table);
  return Object.fromEntries(Object.entries(row).map(([key, value]) => [key, columns[key]?.dataType === "boolean" ? Boolean(value) : value])) as T;
}
async function authorize(db: D1Database, caller: Caller) {
  const row = await db.prepare(`SELECT u.id FROM users u JOIN sessions s ON s.user_id=u.id WHERE u.id=? AND s.id=? AND s.expires_at>?
    AND u.role='ADMIN' AND u.email NOT LIKE 'withdrawn.%@invalid.local' AND NOT EXISTS(SELECT 1 FROM member_access_restrictions r WHERE r.user_id=u.id AND r.lifted_at IS NULL AND r.starts_at<=? AND r.expires_at>?)`)
    .bind(caller.actorUserId, caller.sessionId, caller.now, caller.now, caller.now).first();
  if (!row) fail("ADMIN_REQUIRED");
}
async function impact(rows: PlaceSnapshot, command: PlaceAdminCommand, targetId: string, caller: Caller): Promise<PlaceAdminImpact> {
  const valid = command.change === "PUBLISH" ? await publication(rows, command, caller) : null;
  return calculatePlaceAdminImpact(rows, { change: command.change, targetId, sourceId: command.change === "MERGE" ? command.sourcePlaceId : undefined,
    now: caller.now, publishedCategoryId: valid ? String(valid.category.id) : undefined, publishedLicenseId: valid?.license ? String(valid.license.id) : undefined });
}
function duplicateOpen(rows: PlaceSnapshot, item: Record<string, unknown>, subject: { name: string; address: string; latitude: number; longitude: number }) {
  if (classifyChainStore(subject.name)) return false;
  const address = (value: string) => value.normalize("NFKC").toLocaleLowerCase("ko-KR").replace(/[^0-9a-z가-힣]/gu, "");
  return rows.catalog.some((candidate) => {
    if (candidate.id === item.placeId || classifyChainStore(String(candidate.name)) || normalizePlaceName(String(candidate.name)) !== normalizePlaceName(subject.name)) return false;
    const radians = Math.PI / 180, lat = (Number(candidate.latitude) - subject.latitude) * radians, lon = (Number(candidate.longitude) - subject.longitude) * radians;
    const a = Math.sin(lat / 2) ** 2 + Math.cos(subject.latitude * radians) * Math.cos(Number(candidate.latitude) * radians) * Math.sin(lon / 2) ** 2;
    const near = address(String(candidate.address)) === address(subject.address) || 6_371_000 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)) <= 100;
    return near && !rows.duplicates.some((resolution) => resolution.candidatePlaceId === candidate.id && resolution.decision === "DISTINCT");
  });
}
function originalAddressForUnitCorrection(rows: PlaceSnapshot, command: PublishCommand, caller: Caller,
  item: Record<string, unknown>, currentAddress: string) {
  const correction = command.intakeUnitCorrection;
  if (!correction) return undefined;
  const link = first(rows, "intakeLinks"), entry = first(rows, "intakeEntries");
  const revision = first(rows, "intakeUnitRevisions", correction.revisionId);
  if (link?.mode !== "CREATE" || !entry || item.businessLicenseId !== null
    || !revision || revision.placeId !== item.placeId || revision.actorUserId !== caller.actorUserId
    || revision.action !== "CORRECTION" || revision.sourceType !== "INTAKE_UNIT_CORRECTION" || revision.sourceId !== command.workItemId
    || typeof revision.beforeJson !== "string" || typeof revision.afterJson !== "string") fail();
  let before: z.infer<typeof unitCorrectionBefore>, after: z.infer<typeof unitCorrectionAfter>;
  try {
    before = unitCorrectionBefore.parse(JSON.parse(revision.beforeJson));
    after = unitCorrectionAfter.parse(JSON.parse(revision.afterJson));
  } catch { fail(); }
  const match = /^(.+[0-9])((?: \([^()]+\))?)$/u.exec(before.address);
  if (!match || after.address !== `${match[1]}, ${after.unit}호${match[2]}` || after.address !== currentAddress
    || after.batchId !== link.batchId || after.position !== link.position || after.approvedPlanSha256 !== correction.approvedPlanSha256
    || before.address !== link.subjectAddress || entry.address !== before.address || entry.name !== link.subjectName
    || entry.latitude !== link.subjectLatitude || entry.longitude !== link.subjectLongitude) fail();
  return before.address;
}
async function publication(rows: PlaceSnapshot, command: PublishCommand, caller: Caller) {
  const item = first(rows, "workItems", command.workItemId);
  if (!item || item.status !== "ACTIVE" || item.stage !== "FINAL_APPROVAL" || item.claimToken !== null
    || (command.expectedVersion !== undefined && item.stageVersion !== command.expectedVersion)) fail();
  const category = first(rows, "categories", String(item.selectedCategoryId));
  if (!category || !category.isActive || rows.categories.some((row) => row.parentId === category.id && row.isActive)) fail();
  const license = first(rows, "licenses", String(item.businessLicenseId)), place = first(rows, "places", String(item.placeId));
  if (!license && !place) fail();
  if (license && (license.normalizedStatus !== "OPEN" || license.reviewStatus !== "PENDING" || rows.exclusions.some((row) => row.businessLicenseId === license.id && row.status === "ACTIVE"))) fail();
  const context = await reviewDiningContextFromRows(item as never, license as never, place as never,
    first(rows, "candidateNaver", String(item.businessLicenseId), "businessLicenseId") as never,
    first(rows, "liveness", String(item.placeId), "placeId") as never, caller.now);
  if (context.decision.decision !== "ELIGIBLE") fail();
  const subject = license ? { name: String(license.businessName), address: String(license.roadAddress ?? license.lotAddress ?? ""), latitude: Number(license.latitude), longitude: Number(license.longitude) }
    : { name: String(place!.name), address: String(place!.address), latitude: Number(place!.latitude), longitude: Number(place!.longitude) };
  const intakeLink = first(rows, "intakeLinks");
  const intake = first(rows, "intakeEntries");
  const originalAddress = originalAddressForUnitCorrection(rows, command, caller, item, subject.address);
  if (intakeLink) {
    const region = /^(?:전북특별자치도|전라북도|전북)(?:\s|$)/u.test(subject.address.trim()) ? "JEONBUK" : regionFromAddress(subject.address);
    if (!intake || !region || intake.region !== region || intake.selection !== "CANDIDATE"
      || (intake.kind !== "DINING" && intake.kind !== "CAFE")
      || !(intakeLink.mode === "LINK" && item.sourceKind === "PUBLIC_DATA" && license
        || intakeLink.mode === "CREATE" && item.sourceKind === "PLACE_SUGGESTION" && place?.status === "DRAFT" && place.closedAt === null)
      || intakeLink.subjectName !== subject.name || intakeLink.subjectAddress !== (originalAddress ?? subject.address)
      || intakeLink.subjectLatitude !== subject.latitude || intakeLink.subjectLongitude !== subject.longitude) fail();
  }
  const neighborhood = extractNeighborhood(subject.address) ?? (typeof intake?.neighborhood === "string" ? intake.neighborhood : null);
  if (duplicateOpen(rows, item, subject) || (originalAddress && duplicateOpen(rows, item, { ...subject, address: originalAddress }))
    || !neighborhood || !Number.isFinite(subject.latitude) || subject.latitude < 33 || subject.latitude > 39 || !Number.isFinite(subject.longitude) || subject.longitude < 124 || subject.longitude > 132) fail();
  if (rows.tempEntries.some((entry) => entry.ownsPlace && rows.tempBatches.some((batch) => batch.id === entry.batchId && batch.status !== "PUBLISHED"))) fail();
  return { item, category, license, place, subject, neighborhood };
}
const recallProofFrom = `FROM admin_operations o JOIN admin_operation_commits c
  ON c.operation_id=o.id AND c.actor_user_id=o.actor_user_id AND c.kind=o.kind AND c.committed_at=o.committed_at
  WHERE o.id=? AND o.kind='PLACE_ADMIN_CHANGE' AND o.status='COMMITTED'
  AND (o.session_id IS NULL OR o.session_id=c.session_id)
  AND json_extract(o.result_json,'$.change')='RECALL'
  AND (SELECT count(*) FROM (SELECT 1 FROM admin_audit_logs a WHERE a.action='ADMIN_OPERATION_COMMITTED'
    AND a.target_type='ADMIN_OPERATION' AND a.target_id=o.id AND a.actor_user_id=o.actor_user_id LIMIT 2))=1`;
async function originalRecall(db: D1Database, input: Caller, operationId: string) {
  await authorize(db, input);
  const row = await db.prepare(`SELECT o.result_json AS result ${recallProofFrom}`).bind(operationId).first<{ result: string }>();
  if (!row) fail();
  const result = placeAdminResultSchema.parse(JSON.parse(row.result));
  if (result.change !== "RECALL" || result.recallOperationId !== operationId || !result.afterDigest || !result.reviewWorkItemId) fail();
  return { ...result, receiptJson: row.result };
}
function recallEligible(rows: PlaceSnapshot, targetId: string) {
  const place = first(rows, "places", targetId);
  if (!place || place.status !== "PUBLISHED" || rows.workItems.some((item) => item.status === "ACTIVE" || item.status === "ON_HOLD")) fail();
}
function closureCorrectionSnapshot(db: D1Database, command: PlaceAdminCommand) {
  if (command.change !== "RECALL" || !command.correction) return null;
  const where = "id=? AND place_id=? AND updated_at=? AND request_type='CLOSED' AND verified_at IS NOT NULL AND verified_at<>'' AND status IN ('SUBMITTED','REVIEWING')";
  const sql = `SELECT json_object('status',status,'verifiedAt',verified_at,'requesterRelation',requester_relation,
    'requestedChanges',requested_changes_json,'evidence',evidence_note,'adminResponse',admin_response,'reviewedBy',reviewed_by,'reviewedAt',reviewed_at) AS snapshot
    FROM place_correction_requests WHERE ${where}`;
  const values = [command.correction.requestId, command.placeId, command.correction.expectedUpdatedAt];
  return {
    requestId: command.correction.requestId,
    read: () => db.prepare(sql).bind(...values).first<string>("snapshot"),
    guard: (operationId: string, snapshot: string) => db.prepare(`INSERT INTO admin_operation_checks(operation_id,check_name,passed)
      SELECT ?,'closure-correction-footprint',CASE WHEN (${sql})=? THEN 1 ELSE 0 END`).bind(operationId, ...values, snapshot),
    settle: (caller: Caller) => db.prepare(`UPDATE place_correction_requests SET status='APPLIED',admin_response=?,reviewed_by=?,reviewed_at=?,updated_at=? WHERE ${where}`)
      .bind(command.reason, caller.actorUserId, caller.now, caller.now, ...values),
  };
}
async function correctionFingerprint(snapshot: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(snapshot));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}
function checkChangedOne(db: D1Database, operationId: string, name: string) {
  return db.prepare(`INSERT INTO admin_operation_checks(operation_id,check_name,passed)
    SELECT ?,?,CASE WHEN changes()=1 THEN 1 ELSE 0 END`).bind(operationId, name);
}
function mergeEligible(rows: PlaceSnapshot, command: Extract<PlaceAdminCommand, { change: "MERGE" }>, now: string) {
  const source = first(rows, "places", command.sourcePlaceId), target = first(rows, "places", command.targetPlaceId);
  if (!source || !target || rows.redirects.some((row) => row.oldSlug === source.slug || row.oldSlug === target.slug)) fail();
  const insertingUsers = new Set(rows.saveChoices.filter((row) => row.placeId === source.id).map((row) => row.userId));
  for (const vote of rows.currentVotes.filter((row) => row.placeId === source.id)) {
    const event = first(rows, "voteEvents", String(vote.eventId));
    if (event?.source === "GENERAL" && event.eventType !== "WITHDRAW" && event.userId === vote.userId && event.value === vote.value
      && !rows.invalidations.some((row) => row.voteEventId === event.id)
      && !rows.currentVotes.some((row) => row.placeId === target.id && row.userId === vote.userId)) insertingUsers.add(vote.userId);
  }
  if (rows.access.some((row) => insertingUsers.has(row.userId) && row.liftedAt === null && String(row.startsAt) <= now && String(row.expiresAt) > now)) fail("PLACE_ADMIN_RESTRICTED_PARTICIPANT");
  // Preserve every relationship; oversized plans must never be silently truncated.
  if (rows.currentVotes.filter((row) => row.placeId === command.sourcePlaceId).length * 3 + rows.placeCategories.length + 30 > 1000) fail("PLACE_ADMIN_SNAPSHOT_TOO_LARGE");
}
export async function preparePlaceAdminOperation(db: D1Database, input: Caller & { command: PlaceAdminCommand }) {
  await authorize(db, input);
  const checked = placeAdminCommandSchema.safeParse(input.command);
  if (!checked.success) fail("PLACE_ADMIN_INPUT_INVALID");
  const command = checked.data;
  let scope: PlaceSnapshotScope;
  let targetId: string;
  let slug: string | undefined;
  if (command.change === "PUBLISH") {
    scope = { workItemId: command.workItemId, ...(command.intakeUnitCorrection ? { intakeUnitRevisionId: command.intakeUnitCorrection.revisionId } : {}) };
    targetId = "";
  }
  else if (command.change === "MERGE") { scope = { sourcePlaceId: command.sourcePlaceId, targetPlaceId: command.targetPlaceId }; targetId = command.targetPlaceId; }
  else if (command.change === "RECALL") { scope = { targetPlaceId: command.placeId }; targetId = command.placeId; }
  else { targetId = (await originalRecall(db, input, command.recallOperationId)).targetId; scope = { targetPlaceId: targetId }; }
  const snapshot = await placeSnapshotStatement(db, scope, command.change === "PUBLISH").read();
  const digest = await placeSnapshotDigest(snapshot.raw);
  if (command.change === "PUBLISH") {
    const valid = await publication(snapshot.rows, command, input);
    targetId = valid.place ? String(valid.place.id) : crypto.randomUUID();
    if (!valid.place) { const base = slugifyPlaceNameForAddress(valid.subject.name, valid.subject.address); slug = base;
      for (let suffix = 2; snapshot.rows.catalog.some((row) => row.slug === slug); suffix++) slug = `${base}-${suffix}`; }
  } else if (command.change === "MERGE") mergeEligible(snapshot.rows, command, input.now);
  else if (command.change === "RECALL") recallEligible(snapshot.rows, targetId);
  else if ((await originalRecall(db, input, command.recallOperationId)).afterDigest !== digest) fail("ADMIN_OPERATION_CONFLICT");
  const correction = closureCorrectionSnapshot(db, command);
  const correctionRaw = correction ? await correction.read() : null;
  if (correction && (!correctionRaw || !first(snapshot.rows, "corrections", correction.requestId))) fail("CORRECTION_NOT_APPLICABLE");
  const payload: Payload = { command, digest, scope, targetId, impact: await impact(snapshot.rows, command, targetId, input), ...(slug ? { slug } : {}),
    ...(command.change === "RECALL" ? { newWorkItemId: crypto.randomUUID() } : {}),
    ...(correctionRaw ? { correctionDigest: await correctionFingerprint(correctionRaw) } : {}) };
  return prepareAdminOperation(db, { ...input, kind: "PLACE_ADMIN_CHANGE", payload,
    summary: { title: PLACE_ADMIN_CHANGE_LABELS[command.change], count: 1 }, pruneExpired: scope.intakeUnitRevisionId === undefined });
}
function insert(db: D1Database, table: Table, values: Record<string, unknown>) {
  const columns = getTableColumns(table), entries = Object.entries(values);
  return db.prepare(`INSERT INTO "${getTableName(table)}" (${entries.map(([key]) => `"${columns[key].name}"`).join(",")}) VALUES(${entries.map(() => "?").join(",")})`)
    .bind(...entries.map(([, value]) => typeof value === "boolean" ? Number(value) : value));
}
function audit(db: D1Database, caller: Caller, action: string, targetId: string, before: string, after: string) {
  return insert(db, schema.adminAuditLogs, { id: crypto.randomUUID(), actorUserId: caller.actorUserId, action,
    targetType: "PLACE", targetId, beforeState: before, afterState: after, createdAt: caller.now });
}
function nextRecallItem(payload: Payload, now: string) {
  const defaults = { ...newReviewWorkItemValues({ placeId: payload.targetId, sourceKind: "CATEGORY_RECALL", now }), id: payload.newWorkItemId!, localDiningEvidenceJson: null };
  return Object.fromEntries(Object.keys(getTableColumns(schema.placeReviewWorkItems)).map((key) => [key, defaults[key as keyof typeof defaults] ?? null]));
}
function targets(rows: PlaceSnapshot, payload: Pick<Payload, "command" | "targetId">): PlaceAdminView["targets"] {
  const make = (id: string, role: "TARGET" | "SOURCE" | "PLACE", afterStatus?: string) => {
    const row = first(rows, "places", id);
    const source = first(rows, "licenses");
    return { id, role, name: String(row?.name ?? source?.businessName ?? "대상 확인 불가"), address: String(row?.address ?? source?.roadAddress ?? source?.lotAddress ?? ""),
      status: String(row?.status ?? "NEW"), afterStatus: afterStatus ?? String(row?.status ?? "NEW") };
  };
  return payload.command.change === "MERGE" ? [make(payload.targetId, "TARGET"), make(payload.command.sourcePlaceId, "SOURCE", "HIDDEN")]
    : [make(payload.targetId, "PLACE", payload.command.change === "RECALL" ? "HIDDEN" : "PUBLISHED")];
}
export async function getPlaceAdminOperation(db: D1Database, input: Caller & { operationId: string }): Promise<PlaceAdminView> {
  const operation = await getVerifiedAdminOperation(db, { ...input, kind: "PLACE_ADMIN_CHANGE" });
  if (operation.status === "PENDING") {
    const payload = payloadSchema.parse(operation.payload);
    const snapshot = await placeSnapshotStatement(db, payload.scope, payload.command.change === "PUBLISH").read();
    const correction = closureCorrectionSnapshot(db, payload.command);
    const correctionRaw = correction ? await correction.read() : null;
    const correctionStale = correction && (!correctionRaw || await correctionFingerprint(correctionRaw) !== payload.correctionDigest);
    return { operationId: operation.id, status: operation.status, expiresAt: operation.expiresAt, change: payload.command.change,
      targets: targets(snapshot.rows, payload), impact: payload.impact as PlaceAdminImpact,
      stale: Boolean(correctionStale) || await placeSnapshotDigest(snapshot.raw) !== payload.digest,
      correctionRequestId: correction?.requestId };
  }
  const result = placeAdminResultSchema.parse(operation.result);
  if (result.correctionRequestId) {
    const correctionAudit = await db.prepare(`SELECT count(*) AS n FROM (SELECT 1 FROM admin_audit_logs a
      JOIN admin_operation_commits c ON c.operation_id=? AND c.actor_user_id=a.actor_user_id AND c.committed_at=a.created_at
      WHERE a.action='APPLY_CLOSURE_CORRECTION' AND a.target_type='CORRECTION_REQUEST' AND a.target_id=?
      AND json_extract(a.after_state,'$.operationId')=c.operation_id AND json_extract(a.after_state,'$.status')='APPLIED'
      AND json_extract(a.after_state,'$.placeId')=? LIMIT 2)`)
      .bind(operation.id, result.correctionRequestId, result.targetId).first<number>("n");
    if (result.change !== "RECALL" || result.recallOperationId !== operation.id || correctionAudit !== 1) fail("ADMIN_OPERATION_RECEIPT_UNAVAILABLE");
  }
  const current = await db.prepare("SELECT id,name,address,status FROM places WHERE id IN (?,?) LIMIT 2").bind(result.targetId, result.sourceId ?? result.targetId).all<Record<string, unknown>>();
  const command = (result.change === "MERGE" ? { change: "MERGE", sourcePlaceId: result.sourceId, targetPlaceId: result.targetId, reason: "" }
    : { change: result.change, reason: "" }) as PlaceAdminCommand;
  return { operationId: operation.id, status: operation.status, expiresAt: operation.expiresAt, change: result.change,
    targets: targets({ places: current.results, licenses: [] }, { command, targetId: result.targetId }), impact: result.impact as PlaceAdminImpact,
    correctionRequestId: result.correctionRequestId, result };
}
export async function commitPlaceAdminOperation(db: D1Database, input: Caller & { operationId: string }) {
  await getVerifiedAdminOperation(db, { ...input, kind: "PLACE_ADMIN_CHANGE" });
  const response = await commitAdminOperation(db, { ...input, kind: "PLACE_ADMIN_CHANGE" }, async (operation) => {
    const payload = payloadSchema.parse(operation.payload), command = payload.command;
    const footprint = placeSnapshotStatement(db, payload.scope, command.change === "PUBLISH");
    const snapshot = await footprint.read(), rows = snapshot.rows;
    if (await placeSnapshotDigest(snapshot.raw) !== payload.digest) fail("ADMIN_OPERATION_CONFLICT");
    const currentImpact = await impact(rows, command, payload.targetId, input).catch(() => fail("ADMIN_OPERATION_CONFLICT"));
    const ordered = (value: Record<string, number>) => JSON.stringify(Object.keys(value).sort().map((key) => [key, value[key]]));
    if (ordered(currentImpact) !== ordered(payload.impact)) fail("ADMIN_OPERATION_CONFLICT");
    const statements: D1PreparedStatement[] = [], additionalChecks: D1PreparedStatement[] = [];
    const result: PlaceAdminResult = { change: command.change, requestedCount: 1, appliedCount: 1, skippedCount: 0, targetId: payload.targetId, impact: payload.impact };
    if (command.change === "PUBLISH") {
      const current = await publication(rows, command, input);
      if (command.intakeUnitCorrection && current.place?.id !== payload.targetId) fail("ADMIN_OPERATION_CONFLICT");
      if (current.license) {
        if (!payload.slug || rows.catalog.some((row) => row.slug === payload.slug)) fail("ADMIN_OPERATION_CONFLICT");
        const neighborhood = current.neighborhood;
        statements.push(insert(db, schema.places, { id: payload.targetId, slug: payload.slug, name: current.subject.name, status: "PUBLISHED", address: current.subject.address,
          neighborhood, latitude: current.subject.latitude, longitude: current.subject.longitude, phone: current.license.phone ?? null,
          searchText: `${current.subject.name} ${current.subject.address} ${neighborhood} ${String(current.category.name)}`.toLocaleLowerCase("ko-KR"), createdAt: input.now, updatedAt: input.now }),
        insert(db, schema.placeSourceLinks, { id: crypto.randomUUID(), placeId: payload.targetId, businessLicenseId: current.license.id, isPrimary: true, createdAt: input.now }),
        db.prepare("UPDATE business_licenses SET review_status='APPROVED',reviewed_by=?,reviewed_at=?,updated_at=? WHERE id=?").bind(input.actorUserId, input.now, input.now, current.license.id));
      } else statements.push(db.prepare("UPDATE places SET status='PUBLISHED',updated_at=? WHERE id=?").bind(input.now, payload.targetId),
        db.prepare("UPDATE place_categories SET is_primary=0 WHERE place_id=?").bind(payload.targetId));
      statements.push(db.prepare("INSERT INTO place_categories(place_id,category_id,is_primary) VALUES(?,?,1) ON CONFLICT(place_id,category_id) DO UPDATE SET is_primary=1").bind(payload.targetId, current.category.id),
        db.prepare("UPDATE place_review_work_items SET status='COMPLETED',completed_at=?,stage_version=stage_version+1,last_transition_by=?,last_transition_at=?,updated_at=? WHERE id=?")
          .bind(input.now, input.actorUserId, input.now, input.now, command.workItemId),
        audit(db, input, "PLACE_REVIEW_PUBLISH", payload.targetId, "REVIEWED", "PUBLISHED"));
    } else if (command.change === "MERGE") {
      mergeEligible(rows, command, input.now);
      const plan: PlaceMergeSnapshot = { target: mapped(first(rows, "places", command.targetPlaceId)!, schema.places),
        source: mapped(first(rows, "places", command.sourcePlaceId)!, schema.places),
        sourceVotes: rows.currentVotes.filter((row) => row.placeId === command.sourcePlaceId).map((row) => mapped(row, schema.currentVotes)),
        sourceCategories: rows.placeCategories.filter((row) => row.placeId === command.sourcePlaceId).map((row) => mapped(row, schema.placeCategories)) };
      for (const query of buildPlaceMergeStatements(createDb(db), { ...command, actorUserId: input.actorUserId, now: input.now }, plan)) {
        const compiled = (query as unknown as { toSQL(): { sql: string; params: unknown[] } }).toSQL();
        statements.push(db.prepare(compiled.sql).bind(...compiled.params));
      }
      result.sourceId = command.sourcePlaceId;
    } else if (command.change === "RECALL") {
      recallEligible(rows, payload.targetId);
      const workItem = nextRecallItem(payload, input.now);
      statements.push(db.prepare("UPDATE places SET status='HIDDEN',updated_at=? WHERE id=?").bind(input.now, payload.targetId));
      const correction = closureCorrectionSnapshot(db, command);
      if (correction) statements.push(checkChangedOne(db, operation.id, "closure-place-recalled"));
      statements.push(insert(db, schema.placeReviewWorkItems, workItem));
      if (correction) statements.push(checkChangedOne(db, operation.id, "closure-review-item-created"));
      statements.push(audit(db, input, "PLACE_ADMIN_RECALL", payload.targetId, "PUBLISHED", "HIDDEN"));
      if (correction) statements.push(checkChangedOne(db, operation.id, "closure-place-recall-audited"));
      const after = structuredClone(rows), changed = first(after, "places", payload.targetId)!;
      changed.status = "HIDDEN"; changed.updatedAt = input.now;
      after.workItems.push(workItem); after.workItems.sort((a, b) => String(a.id).localeCompare(String(b.id)));
      if (correction) {
        const current = first(after, "corrections", correction.requestId);
        const correctionRaw = await correction.read();
        if (!current || !correctionRaw || await correctionFingerprint(correctionRaw) !== payload.correctionDigest) fail("ADMIN_OPERATION_CONFLICT");
        const { adminResponse } = JSON.parse(correctionRaw) as { adminResponse: string | null };
        const beforePlace = first(rows, "places", payload.targetId)!;
        const state = { closedAt: beforePlace.closedAt, updatedAt: beforePlace.updatedAt };
        additionalChecks.push(correction.guard(operation.id, correctionRaw));
        statements.push(correction.settle(input), checkChangedOne(db, operation.id, "closure-correction-applied"),
          insert(db, schema.placeRevisions, { id: crypto.randomUUID(), placeId: payload.targetId, actorUserId: input.actorUserId,
            action: "STATUS_CHANGE", reason: command.reason,
            beforeJson: JSON.stringify({ status: beforePlace.status, ...state }),
            afterJson: JSON.stringify({ status: changed.status, ...state, updatedAt: input.now, operationId: operation.id }),
            sourceType: "CORRECTION_REQUEST", sourceId: correction.requestId, createdAt: input.now }),
          checkChangedOne(db, operation.id, "closure-place-revision-recorded"),
          insert(db, schema.adminAuditLogs, { id: crypto.randomUUID(), actorUserId: input.actorUserId,
            action: "APPLY_CLOSURE_CORRECTION", targetType: "CORRECTION_REQUEST", targetId: correction.requestId,
            beforeState: JSON.stringify({ status: current.status, adminResponse }),
            afterState: JSON.stringify({ status: "APPLIED", adminResponse: command.reason, operationId: operation.id, placeId: payload.targetId }),
            createdAt: input.now }),
          checkChangedOne(db, operation.id, "closure-correction-audited"));
        current.status = "APPLIED";
        current.updatedAt = input.now;
        result.correctionRequestId = correction.requestId;
      }
      result.afterDigest = await placeSnapshotDigest(JSON.stringify(after)); result.reviewWorkItemId = payload.newWorkItemId;
      result.recallOperationId = operation.id;
    } else {
      const original = await originalRecall(db, input, command.recallOperationId);
      if (original.targetId !== payload.targetId || original.afterDigest !== payload.digest) fail("ADMIN_OPERATION_CONFLICT");
      if (first(rows, "places", payload.targetId)?.status !== "HIDDEN") fail();
      additionalChecks.push(db.prepare(`INSERT INTO admin_operation_checks(operation_id,check_name,passed)
        SELECT ?,'recall-proof',CASE WHEN EXISTS(SELECT 1 ${recallProofFrom}
          AND json_extract(o.result_json,'$.afterDigest')=? AND json_extract(o.result_json,'$.targetId')=?
          AND o.result_json=?) THEN 1 ELSE 0 END`)
        .bind(operation.id, command.recallOperationId, payload.digest, payload.targetId, original.receiptJson));
      statements.push(db.prepare("UPDATE places SET status='PUBLISHED',updated_at=? WHERE id=?").bind(input.now, payload.targetId),
        db.prepare("UPDATE place_review_work_items SET status='COMPLETED',stage_version=stage_version+1,completed_at=?,last_transition_by=?,last_transition_at=?,updated_at=? WHERE id=?")
          .bind(input.now, input.actorUserId, input.now, input.now, original.reviewWorkItemId), audit(db, input, "PLACE_ADMIN_RESTORE_RECALL", payload.targetId, "HIDDEN", "PUBLISHED"));
      result.recallOperationId = command.recallOperationId;
    }
    return { checks: [footprint.guard(operation.id, snapshot.raw), ...additionalChecks], statements, result };
  });
  const verified = await getVerifiedAdminOperation(db, { ...input, kind: "PLACE_ADMIN_CHANGE" });
  if (verified.status !== "COMMITTED") fail("ADMIN_OPERATION_RESULT_UNKNOWN");
  return { ...response, result: placeAdminResultSchema.parse(verified.result) };
}
