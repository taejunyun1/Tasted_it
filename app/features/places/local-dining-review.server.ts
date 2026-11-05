import { and, eq, isNull } from "drizzle-orm";
import type { AppDb } from "../../db/client.server";
import { adminAuditLogs, businessLicenses, naverLocalCategoryVerifications, placeLivenessStates, placeReviewWorkItems, places } from "../../db/schema";
import { NAVER_CATEGORY_RULE_VERSION } from "../candidates/naver-local-category";
import { pendingVerificationFingerprint } from "../candidates/naver-pending-candidate-verification.server";
import { classifyLocalDining, diningReasonLabels, diningSubjectKey, hasDiningConfirmation, LOCAL_DINING_POLICY_VERSION, type DiningSubject } from "./local-dining-policy";

type WorkItem = typeof placeReviewWorkItems.$inferSelect;
export async function getReviewDiningContext(db: AppDb, item: WorkItem, now: string) {
  const [license, place, candidateNaver, placeNaver] = await Promise.all([
    item.businessLicenseId ? db.query.businessLicenses.findFirst({ where: eq(businessLicenses.id, item.businessLicenseId) }) : undefined,
    item.placeId ? db.query.places.findFirst({ where: eq(places.id, item.placeId) }) : undefined,
    item.businessLicenseId ? db.query.naverLocalCategoryVerifications.findFirst({ where: eq(naverLocalCategoryVerifications.businessLicenseId, item.businessLicenseId) }) : undefined,
    item.placeId ? db.query.placeLivenessStates.findFirst({ where: eq(placeLivenessStates.placeId, item.placeId) }) : undefined,
  ]);
  return reviewDiningContextFromRows(item, license, place, candidateNaver, placeNaver, now);
}

export async function reviewDiningContextFromRows(item: Pick<WorkItem, "localDiningEvidenceJson">,
  license: Pick<typeof businessLicenses.$inferSelect, "businessName" | "roadAddress" | "lotAddress" | "sourceType" | "businessSubtype" | "latitude" | "longitude"> | null | undefined,
  place: Pick<typeof places.$inferSelect, "name" | "address" | "latitude" | "longitude"> | null | undefined,
  candidateNaver: Pick<typeof naverLocalCategoryVerifications.$inferSelect, "status" | "ruleVersion" | "expiresAt" | "queriedAt" | "inputFingerprint" | "matchedCategoryPath"> | null | undefined,
  placeNaver: Pick<typeof placeLivenessStates.$inferSelect, "naverStatus" | "naverLastCheckedAt" | "naverSubjectKey" | "naverCategoryPath" | "naverMappedCategoryId"> | null | undefined, now: string) {
  const subject: DiningSubject = license
    ? { businessName: license.businessName, address: license.roadAddress ?? license.lotAddress ?? "", sourceType: license.sourceType, businessSubtype: license.businessSubtype, latitude: license.latitude, longitude: license.longitude }
    : { businessName: place?.name ?? "", address: place?.address ?? "", sourceType: "PLACE", latitude: place?.latitude, longitude: place?.longitude };
  const candidateFresh = Boolean(candidateNaver && candidateNaver.status === "VERIFIED"
    && candidateNaver.ruleVersion === NAVER_CATEGORY_RULE_VERSION && candidateNaver.expiresAt && candidateNaver.expiresAt > now
    && candidateNaver.queriedAt <= now && candidateNaver.inputFingerprint === await pendingVerificationFingerprint(subject));
  const placeAge = Date.parse(now) - Date.parse(placeNaver?.naverLastCheckedAt ?? "");
  const placeFresh = Boolean(placeNaver && placeNaver.naverStatus === "MATCHED" && placeNaver.naverSubjectKey === diningSubjectKey(subject)
    && placeAge >= 0 && placeAge <= 90 * 86400_000);
  const naverCategory = candidateFresh ? candidateNaver?.matchedCategoryPath : placeFresh ? placeNaver?.naverCategoryPath : null;
  const decision = classifyLocalDining({ ...subject, naverCategory,
    localDineInConfirmed: Boolean((license || place) && hasDiningConfirmation(item.localDiningEvidenceJson, subject, now)) });
  return { subject, decision, naverCategory: naverCategory ?? null, candidateFresh, subjectExists: Boolean(license || place) };
}

/** Never publishes or changes the underlying source/place. Exclusion is recoverable review state. */
export async function enforceReviewDiningExclusion(db: AppDb, item: WorkItem, actorUserId: string | null, now: string) {
  const context = await getReviewDiningContext(db, item, now);
  if (context.decision.decision !== "EXCLUDE") return { ...context, excluded: false };
  const note = [...context.decision.reasons.map((reason) => diningReasonLabels[reason]), ...context.decision.matchedRules].join(" · ");
  const changed = await db.update(placeReviewWorkItems).set({ status: "EXCLUDED", holdCode: "AUTO_LOCAL_DINING_EXCLUSION", holdNote: note,
    stageVersion: item.stageVersion + 1, lastTransitionBy: actorUserId, lastTransitionAt: now, updatedAt: now,
  }).where(and(eq(placeReviewWorkItems.id, item.id), eq(placeReviewWorkItems.status, "ACTIVE"), eq(placeReviewWorkItems.stageVersion, item.stageVersion), isNull(placeReviewWorkItems.claimToken))).returning({ id: placeReviewWorkItems.id });
  if (changed.length) await db.insert(adminAuditLogs).values({ id: crypto.randomUUID(), actorUserId, action: "PLACE_REVIEW_AUTO_EXCLUDE_LOCAL_DINING",
    targetType: "PLACE_REVIEW_WORK_ITEM", targetId: item.id, beforeState: JSON.stringify({ stage: item.stage, status: item.status }),
    afterState: JSON.stringify({ status: "EXCLUDED", ...context.decision }), createdAt: now });
  return { ...context, excluded: Boolean(changed.length) };
}

export async function confirmLocalDiningReview(db: AppDb, input: { workItemIds: string[]; expectedVersions: Record<string, number>; actorUserId: string; reason: string; confirmed: boolean; now: string }) {
  if (!input.confirmed || input.reason.trim().length < 20 || input.reason.length > 300) throw new Error("LOCAL_DINING_CONFIRMATION_REQUIRED");
  const ids = [...new Set(input.workItemIds)];
  if (ids.length !== 1) throw new Error("LOCAL_DINING_SINGLE_REQUIRED");
  const item = await db.query.placeReviewWorkItems.findFirst({ where: eq(placeReviewWorkItems.id, ids[0]!) });
  if (!item || item.status !== "ACTIVE") throw new Error("NOT_ACTIVE");
  if (item.stageVersion !== input.expectedVersions[item.id]) throw new Error("STALE_WORK_ITEM");
  const context = await enforceReviewDiningExclusion(db, item, input.actorUserId, input.now);
  if (!context.subjectExists) throw new Error("REVIEW_SUBJECT_MISSING");
  if (context.decision.decision === "EXCLUDE") throw new Error("ACTIVE_EXCLUSION");
  const confirmation = { policyVersion: LOCAL_DINING_POLICY_VERSION, subjectKey: diningSubjectKey(context.subject), actorUserId: input.actorUserId, confirmedAt: input.now, reason: input.reason.trim() };
  const changed = await db.update(placeReviewWorkItems).set({ localDiningEvidenceJson: JSON.stringify(confirmation), stageVersion: item.stageVersion + 1, updatedAt: input.now })
    .where(and(eq(placeReviewWorkItems.id, item.id), eq(placeReviewWorkItems.status, "ACTIVE"), eq(placeReviewWorkItems.stageVersion, item.stageVersion), isNull(placeReviewWorkItems.claimToken))).returning({ id: placeReviewWorkItems.id });
  if (!changed.length) throw new Error("STALE_WORK_ITEM");
  await db.insert(adminAuditLogs).values({ id: crypto.randomUUID(), actorUserId: input.actorUserId, action: "PLACE_REVIEW_CONFIRM_LOCAL_DINING", targetType: "PLACE_REVIEW_WORK_ITEM", targetId: item.id,
    beforeState: item.localDiningEvidenceJson, afterState: JSON.stringify(confirmation), createdAt: input.now });
  return { confirmed: [item.id] };
}
