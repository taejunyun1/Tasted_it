import { eq } from "drizzle-orm";
import type { AppDb } from "../../db/client.server";
import { businessLicenses, categories, placeReviewWorkItems, places, placeSourceLinks, reviewerVisitPhotos, reviewerVisitReviews } from "../../db/schema";
import { getTerminalCategoryIds } from "../candidates/category-selection";
import { getReviewDiningContext } from "../places/local-dining-review.server";
import { listReviewDuplicateCandidates } from "../places/place-review-duplicates.server";
import { isCoordinateInActiveMarket, isSupportedRegionAddress } from "../regions/region-pack";
import { safeQaPath, type TaskKind } from "./policy";

export type StudentSubject = { kind: TaskKind; title: string; address: string; details: string[]; photos: string[]; categoryId: string | null; registrationReady: boolean; fingerprint: string };
export async function subjectFingerprint(value: unknown) {
  return [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(value))))].map((v) => v.toString(16).padStart(2, "0")).join("");
}
export async function studentCategoryChoices(db: AppDb) {
  const all = await db.select({ id: categories.id, name: categories.name, parentId: categories.parentId }).from(categories).where(eq(categories.isActive, true));
  const terminal = getTerminalCategoryIds(all);
  return all.filter((c) => terminal.has(c.id)).sort((a, b) => a.name.localeCompare(b.name, "ko"));
}

export async function getStudentSubject(db: AppDb, kind: TaskKind, targetId: string, now: string): Promise<StudentSubject> {
  if (kind === "QA") {
    if (!safeQaPath(targetId)) throw new Error("STUDENT_TARGET_UNAVAILABLE");
    return { kind, title: "배정된 화면 시험", address: targetId, details: ["지정 기기에서 재현 순서와 기대·실제 결과를 기록하세요."], photos: [], categoryId: null, registrationReady: false, fingerprint: await subjectFingerprint([kind, targetId]) };
  }
  if (kind === "REVIEW") {
    const review = await db.query.reviewerVisitReviews.findFirst({ where: eq(reviewerVisitReviews.id, targetId) });
    if (!review) throw new Error("STUDENT_TARGET_UNAVAILABLE");
    const [place, category, photos] = await Promise.all([
      db.query.places.findFirst({ where: eq(places.id, review.placeId) }),
      db.query.categories.findFirst({ where: eq(categories.id, review.categoryId) }),
      db.select({ id: reviewerVisitPhotos.id, position: reviewerVisitPhotos.position }).from(reviewerVisitPhotos).where(eq(reviewerVisitPhotos.reviewId, review.id)).limit(5),
    ]);
    if (!place || place.status !== "PUBLISHED") throw new Error("STUDENT_TARGET_UNAVAILABLE");
    const evaluation = { RECOMMEND: "추천", HOLD: "판단보류", NOT_RECOMMEND: "비추천" }[review.evaluation];
    return { kind, title: place.name, address: place.address, details: [`작성자 평가 ${evaluation}`, `음식 종류 ${category?.name ?? "미확인"}`, `사진 ${review.photoCount}장`], photos: photos.sort((a, b) => a.position - b.position).map((p) => p.id), categoryId: review.categoryId, registrationReady: false, fingerprint: await subjectFingerprint([review.id, review.version, review.categoryId, review.evaluation, review.badgesJson, review.updatedAt, place.updatedAt, photos]) };
  }
  const item = await db.query.placeReviewWorkItems.findFirst({ where: eq(placeReviewWorkItems.id, targetId) });
  if (!item) throw new Error("STUDENT_TARGET_UNAVAILABLE");
  const [context, categoryChoices, duplicates, place, license, link] = await Promise.all([
    getReviewDiningContext(db, item, now), studentCategoryChoices(db), listReviewDuplicateCandidates(db, [item.id]),
    item.placeId ? db.query.places.findFirst({ where: eq(places.id, item.placeId) }) : null,
    item.businessLicenseId ? db.query.businessLicenses.findFirst({ where: eq(businessLicenses.id, item.businessLicenseId) }) : null,
    item.businessLicenseId ? db.query.placeSourceLinks.findFirst({ where: eq(placeSourceLinks.businessLicenseId, item.businessLicenseId) }) : null,
  ]);
  if (!context.subjectExists) throw new Error("STUDENT_TARGET_UNAVAILABLE");
  const subject = context.subject;
  const locationReady = subject.latitude != null && subject.longitude != null && isCoordinateInActiveMarket(subject.latitude, subject.longitude) && isSupportedRegionAddress(subject.address);
  const newSubject = (item.sourceKind === "PUBLIC_DATA" && Boolean(license) && !link && license?.normalizedStatus === "OPEN")
    || (item.sourceKind === "PLACE_SUGGESTION" && place?.status === "DRAFT");
  const registrationReady = Boolean(newSubject && locationReady && item.status === "ACTIVE" && item.stage === "FINAL_APPROVAL" && context.decision.decision === "ELIGIBLE" && categoryChoices.some((c) => c.id === item.selectedCategoryId) && duplicates.every((c) => c.decision === "DISTINCT"));
  const stage = { SOURCE_REVIEW: "원천 확인", NAVER_VERIFICATION: "외부 정보 대조", CATEGORY_CONFIRMATION: "세부 업종 확인", DUPLICATE_REVIEW: "중복 검토", FINAL_APPROVAL: "등록 인가 검토" }[item.stage];
  return { kind, title: subject.businessName, address: subject.address, details: [`검수 단계 ${stage}`, `원천 업종 ${subject.businessSubtype ?? "추가 확인 필요"}`, `중복 확인 대상 ${duplicates.length}건`, `방문 식당 확인 ${context.decision.decision === "ELIGIBLE" ? "근거 있음" : "추가 검토 필요"}`], photos: [], categoryId: item.selectedCategoryId, registrationReady, fingerprint: await subjectFingerprint([item.stage, item.status, item.stageVersion, item.selectedCategoryId, subject, context.decision, context.naverCategory, duplicates.map((d) => [d.candidatePlaceId, d.decision]).sort(), place?.status, license?.normalizedStatus, Boolean(link), registrationReady]) };
}
