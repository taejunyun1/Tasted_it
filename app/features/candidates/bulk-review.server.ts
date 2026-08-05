import { asc, eq } from "drizzle-orm";

import type { AppDb } from "../../db/client.server";
import { categories, places } from "../../db/schema";
import { approveCandidate, listPendingCandidates } from "./candidate.server";
import type { CandidateFilters } from "./candidate.server";
import { classifyCandidate } from "./category-suggestion";
import { classifyReviewState } from "./review-classification";

const BULK_LIMIT = 25;

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
  const categoryBySlug = new Map(categoryRows.map((category) => [category.slug, category]));
  const categoryById = new Map(categoryRows.map((category) => [category.id, category]));
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
    const category = categoryBySlug.get(classification.categorySlug);
    const review = classifyReviewState({
      confidence: classification.confidence,
      categoryAvailable: Boolean(category?.parentId),
      address,
      neighborhood: classification.neighborhood,
      latitude: candidate.latitude,
      longitude: candidate.longitude,
      duplicate: Boolean(address && duplicateKeys.has(duplicateKey(candidate.businessName, address))),
    });
    return {
      ...candidate,
      address,
      categoryId: category?.id ?? null,
      categorySlug: classification.categorySlug,
      confidence: classification.confidence,
      neighborhood: classification.neighborhood,
      reasons: classification.reasons,
      blockers: review.blockers,
      reviewReasons: review.reviewReasons,
      reviewState: review.state,
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
      return candidate?.reviewState === "AUTO" && candidate.categoryId ? [{ candidateId, categoryId: candidate.categoryId }] : [{ candidateId, categoryId: "" }];
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
  const validCategoryIds = new Set(categoryRows.filter((category) => category.parentId).map((category) => category.id));
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
      skipped.push({ candidateId, reason: "활성 세부 카테고리를 선택해야 합니다." });
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
      skipped.push({ candidateId, reason: error instanceof Error ? error.message : "승인 처리 실패" });
    }
  }
  return { approved, skipped };
}
