import { and, asc, desc, eq, inArray } from "drizzle-orm";

import type { AppDb } from "../../db/client.server";
import { aiClassificationRuns, categories, places } from "../../db/schema";
import { approveCandidate, listPendingCandidates } from "./candidate.server";
import type { CandidateFilters } from "./candidate.server";
import { classifyCandidate } from "./category-suggestion";
import { classifyReviewState } from "./review-classification";
import { reconcileAiClassification, validateAiClassification } from "./ai-classification-policy";
import { AI_CLASSIFICATION_PROMPT } from "./ai-classification.server";
import { getTerminalCategoryIds } from "./category-selection";

const BULK_LIMIT = 25;
const D1_IN_QUERY_CHUNK = 80;

function duplicateKey(name: string, address: string) {
  const normalize = (value: string) => value.normalize("NFKC").toLocaleLowerCase("ko-KR").replace(/[\s(),.-]+/g, "");
  return `${normalize(name)}::${normalize(address)}`;
}

export async function listBulkReviewGroups(db: AppDb, filters: CandidateFilters = {}) {
  const [candidateRows, categoryRows, placeRows] = await Promise.all([
    listPendingCandidates(db, { ...filters, sort: filters.sort ?? "source" }),
    db.select().from(categories).where(eq(categories.isActive, true)).orderBy(asc(categories.sortOrder)),
    db.select({ name: places.name, address: places.address }).from(places),
  ]);
  const aiRows: Array<typeof aiClassificationRuns.$inferSelect> = [];
  const candidateIds = candidateRows.map((candidate) => candidate.id);
  for (let offset = 0; offset < candidateIds.length; offset += D1_IN_QUERY_CHUNK) {
    aiRows.push(...await db.select().from(aiClassificationRuns)
      .where(and(
        inArray(aiClassificationRuns.candidateId, candidateIds.slice(offset, offset + D1_IN_QUERY_CHUNK)),
        eq(aiClassificationRuns.promptVersion, AI_CLASSIFICATION_PROMPT),
      ))
      .orderBy(desc(aiClassificationRuns.createdAt))
      .limit(1_000));
  }
  aiRows.sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  const latestAi = new Map<string, (typeof aiRows)[number]>(); for (const row of aiRows) if (!latestAi.has(row.candidateId)) latestAi.set(row.candidateId, row);
  const categoryBySlug = new Map(categoryRows.map((category) => [category.slug, category]));
  const categoryById = new Map(categoryRows.map((category) => [category.id, category]));
  const terminalCategoryIds = getTerminalCategoryIds(categoryRows);
  const duplicateKeys = new Set(placeRows.map((place) => duplicateKey(place.name, place.address)));
  const groups = new Map<string, {
    categoryId: string;
    categorySlug: string;
    categoryName: string;
    categoryEmoji: string;
    parentName: string;
    candidates: Array<ReturnType<typeof makeRow>>;
  }>();

  function makeRow(candidate: (typeof candidateRows)[number]) {
    const address = candidate.roadAddress ?? candidate.lotAddress ?? "";
    const classification = classifyCandidate({
      sourceType: candidate.sourceType,
      businessSubtype: candidate.businessSubtype,
      businessName: candidate.businessName,
      address,
    });
    const aiRun = latestAi.get(candidate.id); let ai = null;
    if (aiRun?.status === "SUCCESS") try { ai = validateAiClassification({ categorySlug: aiRun.categorySlug, confidence: aiRun.confidence, reasons: JSON.parse(aiRun.reasonsJson ?? "[]") }, new Set(categoryRows.map((row) => row.slug))); } catch { ai = null; }
    const combined = reconcileAiClassification({ ruleSlug: classification.categorySlug, ruleConfidence: classification.confidence, ai });
    const category = categoryBySlug.get(combined.categorySlug);
    const review = classifyReviewState({
      confidence: combined.confidence,
      categoryAvailable: Boolean(category && terminalCategoryIds.has(category.id)),
      address,
      neighborhood: classification.neighborhood,
      latitude: candidate.latitude,
      longitude: candidate.longitude,
      duplicate: Boolean(address && duplicateKeys.has(duplicateKey(candidate.businessName, address))),
    });
    const classificationCompleted = Boolean(ai && category && terminalCategoryIds.has(category.id));
    const displayState = review.state === "BLOCKED" ? "BLOCKED" as const : classificationCompleted ? "AUTO" as const : review.state;
    return {
      ...candidate,
      address,
      categoryId: category?.id ?? null,
      categorySlug: combined.categorySlug,
      confidence: combined.confidence,
      neighborhood: classification.neighborhood,
      reasons: [...classification.reasons, ...combined.reasons],
      classificationSource: aiRun?.status === "SUCCESS" ? "AI_RULE" as const : aiRun?.status === "FAILED" ? "AI_FAILED" as const : "RULE_ONLY" as const,
      aiConfidence: aiRun?.confidence ?? null,
      blockers: review.blockers,
      reviewReasons: review.reviewReasons,
      reviewState: displayState,
      eligible: review.state === "AUTO",
    };
  }

  for (const candidate of candidateRows) {
    const row = makeRow(candidate);
    const category = categoryBySlug.get(row.categorySlug);
    const key = category?.id ?? `unknown:${row.categorySlug}`;
    if (!groups.has(key)) groups.set(key, {
      categoryId: category?.id ?? "",
      categorySlug: row.categorySlug,
      categoryName: category?.name ?? row.categorySlug,
      categoryEmoji: category?.emoji ?? "?",
      parentName: category?.parentId ? categoryById.get(category.parentId)?.name ?? "기타" : "분류 확인 필요",
      candidates: [],
    });
    groups.get(key)!.candidates.push(row);
  }
  return [...groups.values()].sort((a, b) => a.parentName.localeCompare(b.parentName, "ko") || a.categoryName.localeCompare(b.categoryName, "ko"));
}

export async function bulkApproveCandidates(db: AppDb, input: {
  candidateIds: string[];
  actorUserId: string;
  now: string;
}) {
  const candidateIds = [...new Set(input.candidateIds.filter(Boolean))];
  if (candidateIds.length > BULK_LIMIT) throw new Error("BULK_LIMIT_EXCEEDED");
  const groups = await listBulkReviewGroups(db);
  const candidates = new Map(groups.flatMap((group) => group.candidates).map((candidate) => [candidate.id, candidate]));
  return approveCandidateSelections(db, {
    selections: candidateIds.flatMap((candidateId) => {
      const candidate = candidates.get(candidateId);
      return candidate?.eligible && candidate.categoryId ? [{ candidateId, categoryId: candidate.categoryId }] : [{ candidateId, categoryId: "" }];
    }),
    actorUserId: input.actorUserId,
    now: input.now,
  });
}

export async function approveCandidateSelections(db: AppDb, input: {
  selections: Array<{ candidateId: string; categoryId: string }>;
  actorUserId: string;
  now: string;
}) {
  const selections = [...new Map(input.selections.filter((selection) => selection.candidateId).map((selection) => [selection.candidateId, selection])).values()];
  if (selections.length > BULK_LIMIT) throw new Error("BULK_LIMIT_EXCEEDED");
  const [groups, categoryRows] = await Promise.all([
    listBulkReviewGroups(db),
    db.select().from(categories).where(eq(categories.isActive, true)),
  ]);
  const candidates = new Map(groups.flatMap((group) => group.candidates).map((candidate) => [candidate.id, candidate]));
  const validCategoryIds = getTerminalCategoryIds(categoryRows);
  const batchKeys = new Set<string>();
  const approved: Array<{ candidateId: string; placeId: string }> = [];
  const skipped: Array<{ candidateId: string; reason: string }> = [];

  for (const { candidateId, categoryId } of selections) {
    const candidate = candidates.get(candidateId);
    if (!candidate) {
      skipped.push({ candidateId, reason: "검수 대기 중인 영업 후보가 아닙니다." });
      continue;
    }
    if (candidate.reviewState === "BLOCKED" || !candidate.neighborhood || candidate.latitude == null || candidate.longitude == null) {
      skipped.push({ candidateId, reason: candidate.blockers.join(", ") || "일괄 승인 조건을 충족하지 않습니다." });
      continue;
    }
    if (!validCategoryIds.has(categoryId)) {
      skipped.push({ candidateId, reason: "승인 가능한 최종 카테고리를 선택해야 합니다." });
      continue;
    }
    const key = duplicateKey(candidate.businessName, candidate.address);
    if (batchKeys.has(key)) {
      skipped.push({ candidateId, reason: "같은 상호와 주소가 이번 승인 목록에 중복됩니다." });
      continue;
    }
    batchKeys.add(key);
    try {
      const result = await approveCandidate(db, {
        candidateId,
        actorUserId: input.actorUserId,
        categoryId,
        name: candidate.businessName,
        address: candidate.address,
        latitude: candidate.latitude,
        longitude: candidate.longitude,
        now: input.now,
      });
      approved.push({ candidateId, placeId: result.placeId });
    } catch (error) {
      const code = error instanceof Error ? error.message : "";
      const reason = code === "CATEGORY_NOT_FOUND" ? "승인 가능한 최종 카테고리를 선택해야 합니다."
        : code === "CANDIDATE_NOT_APPROVABLE" ? "이미 처리됐거나 영업 중인 검수 후보가 아닙니다."
        : code === "INVALID_PLACE_COORDINATES" ? "좌표를 확인해야 합니다."
        : code === "PLACE_NEIGHBORHOOD_NOT_FOUND" ? "주소에서 동네를 확인할 수 없습니다."
        : "승인 처리 중 오류가 발생했습니다.";
      skipped.push({ candidateId, reason });
    }
  }
  return { approved, skipped };
}
