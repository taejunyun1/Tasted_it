import { and, asc, eq, gt, gte, lt, sql } from "drizzle-orm";

import type { AppDb } from "../../db/client.server";
import {
  adminAuditLogs,
  businessLicenses,
  categories,
  naverLocalCategoryRuns,
  naverLocalCategoryVerifications,
  placeCategories,
  places,
  placeSourceLinks,
} from "../../db/schema";
import { getTerminalCategoryIds } from "./category-selection";
import { classifyCandidate, getAuthoritativeSubtypeCategorySlug, getStrongestNameFoodCategorySlug } from "./category-suggestion";
import {
  decideCategoryAuthority,
  matchNaverLocalCategory,
  NAVER_CATEGORY_RULE_VERSION,
  type NaverEvidenceCode,
  type NaverLocalCategoryMatch,
  type NaverVerificationStatus,
} from "./naver-local-category";
import { NaverLocalSearchError, type NaverLocalSearchAdapter } from "./naver-local-search.server";

const MAX_PAGE_SIZE = 100;
const CACHE_DAYS = 90;
const allowedEvidenceCodes = new Set<NaverEvidenceCode>([
  "NAVER_EXACT_NAME",
  "NAVER_BRANCH_NORMALIZED_NAME",
  "NAVER_EXACT_ADDRESS",
  "NAVER_COORDINATES_WITHIN_100M",
  "NAVER_SPECIFIC_CATEGORY",
  "NAVER_BROAD_CATEGORY",
  "SOURCE_SUBTYPE_MATCH",
  "SOURCE_SUBTYPE_CONFLICT",
  "NAME_FOOD_MATCH",
]);

export type NaverReverificationChange = {
  placeId: string;
  businessLicenseId: string;
  fromSlug: string;
  toSlug: string | null;
  decision: "CHANGE" | "KEEP" | "MANUAL" | "FAILED" | "SKIPPED";
  reason: string;
  confidenceScore: number;
  evidenceCodes: NaverEvidenceCode[];
};

export type NaverReverificationPage = {
  runId: string;
  scanned: number;
  verified: number;
  changed: number;
  conflicts: number;
  failed: number;
  apiCalls: number;
  nextAfterPlaceId: string | null;
  changes: NaverReverificationChange[];
};

type Input = {
  afterPlaceId: string | null;
  limit: number;
  now: string;
  adapter: NaverLocalSearchAdapter;
  dailyLimit: number;
};

type ApplyInput = Input & { actorUserId: string };

type WorkRow = {
  placeId: string;
  businessLicenseId: string;
  fromCategoryId: string;
  fromSlug: string;
  businessName: string;
  businessSubtype: string | null;
  sourceType: "GENERAL_RESTAURANT" | "REST_CAFE" | "BAKERY" | "ENTERTAINMENT_BAR";
  address: string;
  latitude: number | null;
  longitude: number | null;
  regionCode: "GWANGJU" | "JEONNAM";
};

type Prepared = NaverReverificationChange & {
  fromCategoryId: string;
  toCategoryId: string | null;
};

function validLimit(limit: number) {
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_PAGE_SIZE) throw new Error("NAVER_REVERIFICATION_LIMIT_INVALID");
  return limit;
}

function utcDayStart(value: string) {
  const date = new Date(value);
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate())).toISOString();
}

function nextCacheExpiry(now: string) {
  return new Date(Date.parse(now) + CACHE_DAYS * 24 * 60 * 60 * 1_000).toISOString();
}

function safeEvidence(value: string) {
  try {
    const parsed = JSON.parse(value);
    if (!Array.isArray(parsed)) return [] as NaverEvidenceCode[];
    return parsed.filter((item): item is NaverEvidenceCode => typeof item === "string" && allowedEvidenceCodes.has(item as NaverEvidenceCode));
  } catch {
    return [] as NaverEvidenceCode[];
  }
}

function toCachedMatch(row: typeof naverLocalCategoryVerifications.$inferSelect, categoryById: Map<string, string>): NaverLocalCategoryMatch {
  return {
    status: row.status as NaverVerificationStatus,
    mappedCategorySlug: row.mappedCategoryId ? categoryById.get(row.mappedCategoryId) ?? null : null,
    matchScore: row.matchScore,
    specificityScore: row.specificityScore,
    confidenceScore: row.confidenceScore,
    evidenceCodes: safeEvidence(row.evidenceCodesJson),
  };
}

async function inputFingerprint(row: WorkRow) {
  const input = [
    row.businessName.normalize("NFKC").trim().toLocaleLowerCase("ko-KR"),
    row.address.normalize("NFKC").trim().toLocaleLowerCase("ko-KR"),
    row.latitude?.toFixed(6) ?? "",
    row.longitude?.toFixed(6) ?? "",
  ].join("|");
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return [...new Uint8Array(hash)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function listWork(db: AppDb, input: Pick<Input, "afterPlaceId" | "limit">) {
  const conditions = [eq(places.status, "PUBLISHED"), eq(placeCategories.isPrimary, true), eq(placeSourceLinks.isPrimary, true)];
  if (input.afterPlaceId) conditions.push(gt(places.id, input.afterPlaceId));
  const [rows, categoryRows] = await Promise.all([
    db.select({
      placeId: places.id,
      businessLicenseId: businessLicenses.id,
      fromCategoryId: placeCategories.categoryId,
      fromSlug: categories.slug,
      businessName: businessLicenses.businessName,
      businessSubtype: businessLicenses.businessSubtype,
      sourceType: businessLicenses.sourceType,
      address: places.address,
      latitude: businessLicenses.latitude,
      longitude: businessLicenses.longitude,
      regionCode: businessLicenses.regionCode,
    }).from(places)
      .innerJoin(placeCategories, eq(placeCategories.placeId, places.id))
      .innerJoin(categories, eq(categories.id, placeCategories.categoryId))
      .innerJoin(placeSourceLinks, eq(placeSourceLinks.placeId, places.id))
      .innerJoin(businessLicenses, eq(businessLicenses.id, placeSourceLinks.businessLicenseId))
      .where(and(...conditions))
      .orderBy(asc(places.id))
      .limit(input.limit + 1),
    db.select().from(categories).where(eq(categories.isActive, true)),
  ]);
  return { rows: rows.slice(0, input.limit) as WorkRow[], hasNext: rows.length > input.limit, categoryRows };
}

async function todayApiCalls(db: AppDb, now: string) {
  const result = await db.select({ total: sql<number>`coalesce(sum(${naverLocalCategoryRuns.apiCallCount}), 0)` })
    .from(naverLocalCategoryRuns)
    .where(and(gte(naverLocalCategoryRuns.startedAt, utcDayStart(now)), lt(naverLocalCategoryRuns.startedAt, now)));
  return Number(result[0]?.total ?? 0);
}

function failureCode(error: unknown) {
  return error instanceof NaverLocalSearchError ? error.code : "NAVER_LOCAL_SEARCH_UNAVAILABLE";
}

function pageFromPrepared(runId: string, prepared: Prepared[], input: Input, hasNext: boolean, apiCalls: number): NaverReverificationPage {
  const changes = prepared.map(({ fromCategoryId: _fromCategoryId, toCategoryId: _toCategoryId, ...change }) => change);
  return {
    runId,
    scanned: changes.length,
    verified: changes.filter((change) => change.decision === "CHANGE" || change.decision === "KEEP" || change.decision === "MANUAL").length,
    changed: changes.filter((change) => change.decision === "CHANGE").length,
    conflicts: changes.filter((change) => change.decision === "MANUAL").length,
    failed: changes.filter((change) => change.decision === "FAILED" || change.decision === "SKIPPED").length,
    apiCalls,
    nextAfterPlaceId: hasNext ? changes.at(-1)?.placeId ?? null : null,
    changes,
  };
}

async function upsertVerification(db: AppDb, input: {
  businessLicenseId: string;
  fingerprint: string;
  match: NaverLocalCategoryMatch;
  mappedCategoryId: string | null;
  now: string;
  failureCode: string | null;
}) {
  await db.insert(naverLocalCategoryVerifications).values({
    businessLicenseId: input.businessLicenseId,
    status: input.match.status,
    mappedCategoryId: input.mappedCategoryId,
    matchScore: Math.round(input.match.matchScore),
    specificityScore: Math.round(input.match.specificityScore),
    confidenceScore: Math.round(input.match.confidenceScore),
    evidenceCodesJson: JSON.stringify(input.match.evidenceCodes),
    ruleVersion: NAVER_CATEGORY_RULE_VERSION,
    inputFingerprint: input.fingerprint,
    queriedAt: input.now,
    expiresAt: input.match.status === "VERIFIED" ? nextCacheExpiry(input.now) : null,
    failureCode: input.failureCode,
    createdAt: input.now,
    updatedAt: input.now,
  }).onConflictDoUpdate({
    target: naverLocalCategoryVerifications.businessLicenseId,
    set: {
      status: input.match.status,
      mappedCategoryId: input.mappedCategoryId,
      matchScore: Math.round(input.match.matchScore),
      specificityScore: Math.round(input.match.specificityScore),
      confidenceScore: Math.round(input.match.confidenceScore),
      evidenceCodesJson: JSON.stringify(input.match.evidenceCodes),
      ruleVersion: NAVER_CATEGORY_RULE_VERSION,
      inputFingerprint: input.fingerprint,
      queriedAt: input.now,
      expiresAt: input.match.status === "VERIFIED" ? nextCacheExpiry(input.now) : null,
      failureCode: input.failureCode,
      updatedAt: input.now,
    },
  });
}

async function prepare(db: AppDb, input: Input) {
  const limit = validLimit(input.limit);
  const { rows, hasNext, categoryRows } = await listWork(db, { afterPlaceId: input.afterPlaceId, limit });
  const categoryBySlug = new Map(categoryRows.map((category) => [category.slug, category]));
  const categoryById = new Map(categoryRows.map((category) => [category.id, category.slug]));
  const terminalSlugs = new Set(categoryRows.filter((category) => getTerminalCategoryIds(categoryRows).has(category.id)).map((category) => category.slug));
  const used = await todayApiCalls(db, input.now);
  let apiCalls = 0;
  const prepared: Prepared[] = [];

  for (const row of rows) {
    const fingerprint = await inputFingerprint(row);
    const cached = await db.query.naverLocalCategoryVerifications.findFirst({ where: eq(naverLocalCategoryVerifications.businessLicenseId, row.businessLicenseId) });
    let match: NaverLocalCategoryMatch;
    let code: string | null = null;
    if (cached && cached.status === "VERIFIED" && cached.inputFingerprint === fingerprint && cached.expiresAt && cached.expiresAt > input.now) {
      match = toCachedMatch(cached, categoryById);
    } else if (used + apiCalls >= input.dailyLimit) {
      prepared.push({ placeId: row.placeId, businessLicenseId: row.businessLicenseId, fromCategoryId: row.fromCategoryId, fromSlug: row.fromSlug, toSlug: null, toCategoryId: null, decision: "SKIPPED", reason: "NAVER 일일 확인 한도에 도달", confidenceScore: 0, evidenceCodes: [] });
      continue;
    } else {
      try {
        const results = await input.adapter.search({ businessName: row.businessName, address: row.address, regionCode: row.regionCode });
        apiCalls += 1;
        match = matchNaverLocalCategory({
          businessName: row.businessName,
          address: row.address,
          latitude: row.latitude,
          longitude: row.longitude,
          regionCode: row.regionCode,
          results,
          terminalSlugs,
        });
      } catch (error) {
        code = failureCode(error);
        // A disabled feature is an operation-level state, not a failed result for
        // every individual place. Let the route surface the safe-stop notice.
        if (code === "NAVER_LOCAL_SEARCH_DISABLED") throw error;
        apiCalls += 1;
        match = { status: "FAILED", mappedCategorySlug: null, matchScore: 0, specificityScore: 0, confidenceScore: 0, evidenceCodes: [] };
      }
    }

    const classification = classifyCandidate({ sourceType: row.sourceType, businessSubtype: row.businessSubtype, businessName: row.businessName, address: row.address });
    const decision = decideCategoryAuthority({
      rule: classification,
      subtypeSlug: getAuthoritativeSubtypeCategorySlug({ sourceType: row.sourceType, businessSubtype: row.businessSubtype, businessName: row.businessName, address: row.address }, classification),
      nameSlug: getStrongestNameFoodCategorySlug({ sourceType: row.sourceType, businessSubtype: row.businessSubtype, businessName: row.businessName, address: row.address }),
      naver: match,
    });
    const mappedCategory = decision.naver?.mappedCategorySlug ? categoryBySlug.get(decision.naver.mappedCategorySlug) ?? null : null;
    const verifiedSameSubtype = decision.naver?.status === "VERIFIED"
      && decision.naver.mappedCategorySlug === decision.categorySlug
      && decision.naver.confidenceScore >= 80
      && decision.naver.evidenceCodes.includes("SOURCE_SUBTYPE_MATCH")
      && decision.confidence !== "CONFLICT";
    await upsertVerification(db, { businessLicenseId: row.businessLicenseId, fingerprint, match: decision.naver ?? match, mappedCategoryId: mappedCategory?.id ?? null, now: input.now, failureCode: code });
    if (match.status === "FAILED") {
      prepared.push({ placeId: row.placeId, businessLicenseId: row.businessLicenseId, fromCategoryId: row.fromCategoryId, fromSlug: row.fromSlug, toSlug: null, toCategoryId: null, decision: "FAILED", reason: "NAVER 확인을 완료하지 못함", confidenceScore: 0, evidenceCodes: [] });
    } else if (!verifiedSameSubtype || !mappedCategory) {
      prepared.push({ placeId: row.placeId, businessLicenseId: row.businessLicenseId, fromCategoryId: row.fromCategoryId, fromSlug: row.fromSlug, toSlug: decision.categorySlug, toCategoryId: mappedCategory?.id ?? null, decision: "MANUAL", reason: decision.reasons[0] ?? "자동 변경 근거 부족", confidenceScore: decision.confidenceScore, evidenceCodes: decision.naver?.evidenceCodes ?? [] });
    } else if (row.fromSlug === decision.categorySlug) {
      prepared.push({ placeId: row.placeId, businessLicenseId: row.businessLicenseId, fromCategoryId: row.fromCategoryId, fromSlug: row.fromSlug, toSlug: decision.categorySlug, toCategoryId: mappedCategory.id, decision: "KEEP", reason: "NAVER·원천 업태와 현재 카테고리가 일치", confidenceScore: decision.confidenceScore, evidenceCodes: decision.naver?.evidenceCodes ?? [] });
    } else {
      prepared.push({ placeId: row.placeId, businessLicenseId: row.businessLicenseId, fromCategoryId: row.fromCategoryId, fromSlug: row.fromSlug, toSlug: decision.categorySlug, toCategoryId: mappedCategory.id, decision: "CHANGE", reason: "NAVER 상호·위치 및 원천 업태가 일치", confidenceScore: decision.confidenceScore, evidenceCodes: decision.naver?.evidenceCodes ?? [] });
    }
  }
  return { prepared, hasNext, apiCalls };
}

async function run(db: AppDb, input: Input | ApplyInput, mode: "PREVIEW" | "APPLY") {
  const runId = crypto.randomUUID();
  await db.insert(naverLocalCategoryRuns).values({
    id: runId,
    mode,
    scope: "PUBLISHED",
    status: "RUNNING",
    afterBusinessLicenseId: input.afterPlaceId,
    requestedLimit: validLimit(input.limit),
    startedAt: input.now,
    createdBy: "actorUserId" in input ? input.actorUserId : null,
  });
  try {
    const { prepared, hasNext, apiCalls } = await prepare(db, input);
    if (mode === "APPLY") {
      for (const item of prepared) {
        if (item.decision !== "CHANGE" || !item.toCategoryId || !("actorUserId" in input)) continue;
        const current = await db.query.placeCategories.findFirst({ where: and(eq(placeCategories.placeId, item.placeId), eq(placeCategories.isPrimary, true)) });
        if (!current || current.categoryId !== item.fromCategoryId) continue;
        await db.batch([
          db.update(placeCategories).set({ categoryId: item.toCategoryId }).where(and(eq(placeCategories.placeId, item.placeId), eq(placeCategories.categoryId, item.fromCategoryId), eq(placeCategories.isPrimary, true))),
          db.insert(adminAuditLogs).values({
            id: crypto.randomUUID(), actorUserId: input.actorUserId, action: "NAVER_CATEGORY_REVERIFICATION", targetType: "PLACE", targetId: item.placeId,
            beforeState: JSON.stringify({ categorySlug: item.fromSlug }),
            afterState: JSON.stringify({ categorySlug: item.toSlug, confidenceScore: item.confidenceScore, evidenceCodes: item.evidenceCodes, ruleVersion: NAVER_CATEGORY_RULE_VERSION }),
            createdAt: input.now,
          }),
        ]);
      }
    }
    const page = pageFromPrepared(runId, prepared, input, hasNext, apiCalls);
    await db.update(naverLocalCategoryRuns).set({
      status: "COMPLETED", scannedCount: page.scanned, verifiedCount: page.verified, changeCount: page.changed,
      conflictCount: page.conflicts, failedCount: page.failed, apiCallCount: page.apiCalls, finishedAt: input.now,
    }).where(eq(naverLocalCategoryRuns.id, runId));
    return page;
  } catch (error) {
    const code = failureCode(error);
    await db.update(naverLocalCategoryRuns).set({ status: "FAILED", finishedAt: input.now, errorCode: code }).where(eq(naverLocalCategoryRuns.id, runId));
    throw error;
  }
}

export function previewNaverCategoryReverification(db: AppDb, input: Input) {
  return run(db, input, "PREVIEW");
}

export function applyNaverCategoryReverification(db: AppDb, input: ApplyInput) {
  return run(db, input, "APPLY");
}
