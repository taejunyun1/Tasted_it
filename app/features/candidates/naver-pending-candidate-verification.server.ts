import { and, asc, eq, inArray } from "drizzle-orm";

import type { AppDb } from "../../db/client.server";
import { businessLicenses, categories, naverLocalCategoryRuns, naverLocalCategoryVerifications } from "../../db/schema";
import { assertNaverRegionQuota, getNaverLocalSearchApiCallsToday, isNaverRegionSearchEnabled, uniqueRunRegion } from "../places/naver-region-quota.server";
import { ACTIVE_REGION_CODES, type RegionCode } from "../regions/region-pack";
import { getTerminalCategoryIds } from "./category-selection";
import { classifyCandidate, getAuthoritativeSubtypeCategorySlug, getStrongestNameFoodCategorySlug } from "./category-suggestion";
import { decideCategoryAuthority, matchNaverLocalCategory, NAVER_CATEGORY_RULE_VERSION, type NaverLocalCategoryMatch } from "./naver-local-category";
import { NaverLocalSearchError, type NaverLocalSearchAdapter } from "./naver-local-search.server";

const MAX_BATCH_SIZE = 25;
const CACHE_DAYS = 90;

type PendingWorkRow = {
  id: string;
  businessName: string;
  businessSubtype: string | null;
  sourceType: "GENERAL_RESTAURANT" | "REST_CAFE" | "BAKERY" | "ENTERTAINMENT_BAR";
  address: string;
  latitude: number | null;
  longitude: number | null;
  regionCode: "GWANGJU" | "JEONNAM";
};

export type NaverPendingCandidateVerificationInput = {
  candidateIds?: string[];
  limit?: number;
  now: string;
  adapter: NaverLocalSearchAdapter;
  dailyLimit?: number;
  actorUserId?: string;
};

export type NaverPendingCandidateVerificationResult = {
  runId: string;
  scanned: number;
  verified: number;
  automatic: number;
  manual: number;
  failed: number;
  apiCalls: number;
};

function validLimit(limit: number) {
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_BATCH_SIZE) throw new Error("NAVER_PENDING_VERIFICATION_LIMIT_INVALID");
  return limit;
}

function nextCacheExpiry(now: string) {
  return new Date(Date.parse(now) + CACHE_DAYS * 24 * 60 * 60 * 1_000).toISOString();
}

async function fingerprint(row: PendingWorkRow) {
  const value = [
    row.businessName.normalize("NFKC").trim().toLocaleLowerCase("ko-KR"),
    row.address.normalize("NFKC").trim().toLocaleLowerCase("ko-KR"),
    row.latitude?.toFixed(6) ?? "",
    row.longitude?.toFixed(6) ?? "",
  ].join("|");
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(hash)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function listPendingWork(db: AppDb, input: { candidateIds?: string[]; limit: number }) {
  const conditions = [
    eq(businessLicenses.reviewStatus, "PENDING"),
    eq(businessLicenses.normalizedStatus, "OPEN"),
  ];
  if (input.candidateIds?.length) conditions.push(inArray(businessLicenses.id, input.candidateIds));
  const [rows, categoryRows] = await Promise.all([
    db.select({
      id: businessLicenses.id,
      businessName: businessLicenses.businessName,
      businessSubtype: businessLicenses.businessSubtype,
      sourceType: businessLicenses.sourceType,
      roadAddress: businessLicenses.roadAddress,
      lotAddress: businessLicenses.lotAddress,
      latitude: businessLicenses.latitude,
      longitude: businessLicenses.longitude,
      regionCode: businessLicenses.regionCode,
    }).from(businessLicenses).where(and(...conditions)).orderBy(asc(businessLicenses.createdAt)).limit(input.limit),
    db.select().from(categories).where(eq(categories.isActive, true)),
  ]);
  return {
    rows: rows.flatMap((row) => {
      const address = row.roadAddress ?? row.lotAddress;
      return address ? [{ ...row, address } as PendingWorkRow] : [];
    }),
    categoryRows,
  };
}

function safeFailureCode(error: unknown) {
  return error instanceof NaverLocalSearchError ? error.code : "NAVER_LOCAL_SEARCH_UNAVAILABLE";
}

function immediatelyStop(error: unknown) {
  const code = safeFailureCode(error);
  return code === "NAVER_LOCAL_SEARCH_DISABLED"
    || code === "NAVER_LOCAL_SEARCH_QUOTA"
    || code === "NAVER_LOCAL_SEARCH_REJECTED";
}

async function upsertVerification(db: AppDb, input: {
  businessLicenseId: string;
  inputFingerprint: string;
  match: NaverLocalCategoryMatch;
  mappedCategoryId: string | null;
  failureCode: string | null;
  now: string;
}) {
  const values = {
    status: input.match.status,
    mappedCategoryId: input.mappedCategoryId,
    matchScore: Math.round(input.match.matchScore),
    specificityScore: Math.round(input.match.specificityScore),
    confidenceScore: Math.round(input.match.confidenceScore),
    evidenceCodesJson: JSON.stringify(input.match.evidenceCodes),
    ruleVersion: NAVER_CATEGORY_RULE_VERSION,
    inputFingerprint: input.inputFingerprint,
    queriedAt: input.now,
    expiresAt: input.match.status === "VERIFIED" ? nextCacheExpiry(input.now) : null,
    failureCode: input.failureCode,
    updatedAt: input.now,
  };
  await db.insert(naverLocalCategoryVerifications).values({ businessLicenseId: input.businessLicenseId, ...values, createdAt: input.now })
    .onConflictDoUpdate({ target: naverLocalCategoryVerifications.businessLicenseId, set: values });
}

export async function verifyPendingCandidatesWithNaver(db: AppDb, input: NaverPendingCandidateVerificationInput): Promise<NaverPendingCandidateVerificationResult> {
  const candidateIds = [...new Set(input.candidateIds?.filter(Boolean) ?? [])];
  const limit = validLimit(Math.min(input.limit ?? MAX_BATCH_SIZE, MAX_BATCH_SIZE));
  if (candidateIds.length > MAX_BATCH_SIZE) throw new Error("NAVER_PENDING_VERIFICATION_LIMIT_INVALID");
  const { rows, categoryRows } = await listPendingWork(db, { candidateIds, limit });
  const runId = crypto.randomUUID();
  await db.insert(naverLocalCategoryRuns).values({
    id: runId,
    mode: "APPLY",
    scope: "PENDING",
    status: "RUNNING",
    requestedLimit: limit,
    regionCode: uniqueRunRegion(rows.map((row) => row.regionCode)),
    startedAt: input.now,
    createdBy: input.actorUserId ?? null,
  });

  let apiCalls = 0;
  let scanned = 0;
  let verified = 0;
  let automatic = 0;
  let manual = 0;
  let failed = 0;
  const extraCalls: Record<RegionCode, number> = { GWANGJU: 0, JEONNAM: 0 };
  try {
    const terminalCategoryIds = getTerminalCategoryIds(categoryRows);
    const terminalSlugs = new Set(categoryRows.filter((category) => terminalCategoryIds.has(category.id)).map((category) => category.slug));
    const categoryBySlug = new Map(categoryRows.map((category) => [category.slug, category]));
    const usedByRegion = Object.fromEntries(await Promise.all(ACTIVE_REGION_CODES.map(async (code) =>
      [code, await getNaverLocalSearchApiCallsToday(db, input.now, code)] as const))) as Record<RegionCode, number>;

    for (const row of rows) {
      scanned += 1;
      const inputFingerprint = await fingerprint(row);
      const cached = await db.query.naverLocalCategoryVerifications.findFirst({ where: eq(naverLocalCategoryVerifications.businessLicenseId, row.id) });
      let match: NaverLocalCategoryMatch;
      let failureCode: string | null = null;
      if (cached && cached.status === "VERIFIED" && cached.inputFingerprint === inputFingerprint && cached.expiresAt && cached.expiresAt > input.now) {
        const category = cached.mappedCategoryId ? categoryRows.find((item) => item.id === cached.mappedCategoryId) : null;
        match = {
          status: "VERIFIED",
          mappedCategorySlug: category?.slug ?? null,
          matchScore: cached.matchScore,
          specificityScore: cached.specificityScore,
          confidenceScore: cached.confidenceScore,
          evidenceCodes: JSON.parse(cached.evidenceCodesJson) as NaverLocalCategoryMatch["evidenceCodes"],
        };
      } else if (!isNaverRegionSearchEnabled(row.regionCode)) {
        match = { status: "SKIPPED", mappedCategorySlug: null, matchScore: 0, specificityScore: 0, confidenceScore: 0, evidenceCodes: [] };
        failureCode = "NAVER_LOCAL_SEARCH_DISABLED";
      } else {
        assertNaverRegionQuota({
          regionCode: row.regionCode,
          used: usedByRegion[row.regionCode],
          extraCalls: extraCalls[row.regionCode],
          dailyLimit: input.dailyLimit,
        });
        try {
          const results = await input.adapter.search({ businessName: row.businessName, address: row.address, regionCode: row.regionCode });
          apiCalls += 1;
          extraCalls[row.regionCode] += 1;
          match = matchNaverLocalCategory({ ...row, results, terminalSlugs });
        } catch (error) {
          apiCalls += 1;
          extraCalls[row.regionCode] += 1;
          if (immediatelyStop(error)) throw error;
          failureCode = safeFailureCode(error);
          match = { status: "FAILED", mappedCategorySlug: null, matchScore: 0, specificityScore: 0, confidenceScore: 0, evidenceCodes: [] };
        }
      }

      const rule = classifyCandidate({ sourceType: row.sourceType, businessSubtype: row.businessSubtype, businessName: row.businessName, address: row.address });
      const authority = decideCategoryAuthority({
        rule,
        subtypeSlug: getAuthoritativeSubtypeCategorySlug({ sourceType: row.sourceType, businessSubtype: row.businessSubtype, businessName: row.businessName, address: row.address }, rule),
        nameSlug: getStrongestNameFoodCategorySlug({ sourceType: row.sourceType, businessSubtype: row.businessSubtype, businessName: row.businessName, address: row.address }),
        naver: match,
      });
      const mappedCategory = authority.naver?.mappedCategorySlug ? categoryBySlug.get(authority.naver.mappedCategorySlug) ?? null : null;
      await upsertVerification(db, { businessLicenseId: row.id, inputFingerprint, match: authority.naver ?? match, mappedCategoryId: mappedCategory?.id ?? null, failureCode, now: input.now });
      if (match.status === "VERIFIED") verified += 1;
      if (match.status === "FAILED" || match.status === "SKIPPED") failed += 1;
      else if (authority.automatic && mappedCategory && terminalCategoryIds.has(mappedCategory.id)) automatic += 1;
      else manual += 1;
    }

    const result = { runId, scanned, verified, automatic, manual, failed, apiCalls };
    await db.update(naverLocalCategoryRuns).set({
      status: "COMPLETED",
      scannedCount: scanned,
      verifiedCount: verified,
      changeCount: automatic,
      conflictCount: manual,
      failedCount: failed,
      apiCallCount: apiCalls,
      finishedAt: input.now,
    }).where(eq(naverLocalCategoryRuns.id, runId));
    return result;
  } catch (error) {
    await db.update(naverLocalCategoryRuns).set({ status: "FAILED", apiCallCount: apiCalls, finishedAt: input.now, errorCode: safeFailureCode(error) }).where(eq(naverLocalCategoryRuns.id, runId));
    throw error;
  }
}
