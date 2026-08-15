import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";

import { createDb } from "../../app/db/client.server";
import { businessLicenses, naverLocalCategoryVerifications, places } from "../../app/db/schema";
import {
  approveCandidateSelections,
  bulkApproveCandidates,
  listBulkReviewGroups,
} from "../../app/features/candidates/bulk-review.server";
import { upsertBusinessLicense } from "../../app/features/candidates/candidate.server";
import type { NormalizedLicense } from "../../app/features/candidates/public-data";

const now = "2026-08-05T11:00:00.000Z";
const license: NormalizedLicense = {
  sourceType: "GENERAL_RESTAURANT",
  sourceManagementNo: "bulk-safe",
  businessName: "일품 양평해장국",
  businessSubtype: "한식",
  salesStatusCode: "01",
  salesStatusName: "영업/정상",
  detailStatusCode: "01",
  detailStatusName: "영업",
  normalizedStatus: "OPEN",
  lotAddress: null,
  roadAddress: "광주광역시 동구 증심사길 25 (운림동)",
  phone: null,
  sourceX: null,
  sourceY: null,
  latitude: 35.134266,
  longitude: 126.955304,
  regionCode: "GWANGJU",
  sourceUpdatedAt: now,
  rawPayload: "{}",
};

beforeEach(async () => {
  await env.DB.prepare("INSERT OR IGNORE INTO users (id,email,display_name,role,created_at,updated_at) VALUES ('bulk-admin','bulk-admin@example.com','관리자','ADMIN',?,?)").bind(now, now).run();
});

async function addVerifiedNaverEvidence(candidateId: string) {
  const db = createDb(env.DB);
  const category = await db.query.categories.findFirst({ where: (row, { eq }) => eq(row.slug, "gukbap-detail") });
  await db.insert(naverLocalCategoryVerifications).values({
    businessLicenseId: candidateId,
    status: "VERIFIED",
    mappedCategoryId: category!.id,
    matchScore: 40,
    specificityScore: 20,
    confidenceScore: 80,
    evidenceCodesJson: '["NAVER_EXACT_NAME","NAVER_EXACT_ADDRESS","NAVER_SPECIFIC_CATEGORY","SOURCE_SUBTYPE_MATCH"]',
    ruleVersion: "naver-category-v1",
    inputFingerprint: crypto.randomUUID(),
    queriedAt: now,
    expiresAt: "2099-08-05T11:00:00.000Z",
    failureCode: null,
    createdAt: now,
    updatedAt: now,
  });
}

describe("bulk candidate review", () => {
  it("groups candidates and enables only safe high-confidence candidates", async () => {
    const db = createDb(env.DB);
    const safe = await upsertBusinessLicense(db, license, now);
    const unsafe = await upsertBusinessLicense(db, {
      ...license,
      sourceManagementNo: "bulk-unsafe",
      businessName: "맛있는집",
      businessSubtype: null,
      latitude: null,
      longitude: null,
    }, now);
    await addVerifiedNaverEvidence(safe.id);

    const groups = await listBulkReviewGroups(db);
    const rows = groups.flatMap((group) => group.candidates);
    expect(rows.find((row) => row.id === safe.id)).toMatchObject({ confidence: "MEDIUM", eligible: false, neighborhood: "운림동" });
    expect(rows.find((row) => row.id === unsafe.id)).toMatchObject({ confidence: "LOW", eligible: false, classificationSource: "RULE_ONLY" });
  });

  it("keeps a RULE_ONLY success manual without lowering its rule score", async () => {
    const db = createDb(env.DB);
    const candidate = await upsertBusinessLicense(db, {
      ...license,
      sourceManagementNo: "rule-only-high",
      businessName: "전주해장국",
      businessSubtype: "한식",
    }, now);
    const row = (await listBulkReviewGroups(db)).flatMap((group) => group.candidates).find((item) => item.id === candidate.id)!;

    expect(row).toMatchObject({
      categorySlug: "gukbap-detail",
      confidence: "HIGH",
      classificationSource: "RULE_ONLY",
      reviewState: "MANUAL",
      eligible: false,
      categoryId: null,
      suggestedCategoryId: expect.any(String),
    });
  });

  it("uses an unexpired NAVER authority record when source subtype agrees", async () => {
    const db = createDb(env.DB);
    const candidate = await upsertBusinessLicense(db, {
      ...license,
      sourceManagementNo: "naver-authority-candidate",
      businessName: "일품 양평해장국",
      businessSubtype: "국밥",
    }, now);
    const category = await db.query.categories.findFirst({ where: (row, { eq }) => eq(row.slug, "gukbap-detail") });
    await db.insert(naverLocalCategoryVerifications).values({
      businessLicenseId: candidate.id,
      status: "VERIFIED",
      mappedCategoryId: category!.id,
      matchScore: 40,
      specificityScore: 20,
      confidenceScore: 90,
      evidenceCodesJson: '["NAVER_EXACT_NAME","NAVER_EXACT_ADDRESS","NAVER_SPECIFIC_CATEGORY","SOURCE_SUBTYPE_MATCH"]',
      ruleVersion: "naver-category-v1",
      inputFingerprint: crypto.randomUUID(),
      queriedAt: now,
      expiresAt: "2099-08-05T11:00:00.000Z",
      failureCode: null,
      createdAt: now,
      updatedAt: now,
    });
    const row = (await listBulkReviewGroups(db)).flatMap((group) => group.candidates).find((item) => item.id === candidate.id)!;
    expect(row).toMatchObject({
      categorySlug: "gukbap-detail",
      confidence: "HIGH",
      reviewState: "AUTO",
      eligible: true,
      classificationSource: "NAVER_RULE",
      naverEvidence: { status: "VERIFIED", confidenceScore: 90, evidenceCodes: expect.arrayContaining(["NAVER_EXACT_NAME"]) },
    });
  });

  it("exposes a failed NAVER lookup as safe evidence and keeps the candidate manual", async () => {
    const db = createDb(env.DB);
    const candidate = await upsertBusinessLicense(db, { ...license, sourceManagementNo: "naver-failed-candidate" }, now);
    await db.insert(naverLocalCategoryVerifications).values({
      businessLicenseId: candidate.id,
      status: "FAILED",
      mappedCategoryId: null,
      matchScore: 0,
      specificityScore: 0,
      confidenceScore: 0,
      evidenceCodesJson: "[]",
      ruleVersion: "naver-category-v1",
      inputFingerprint: crypto.randomUUID(),
      queriedAt: now,
      expiresAt: null,
      failureCode: "NAVER_LOCAL_SEARCH_TIMEOUT",
      createdAt: now,
      updatedAt: now,
    });

    const row = (await listBulkReviewGroups(db)).flatMap((group) => group.candidates).find((item) => item.id === candidate.id)!;

    expect(row).toMatchObject({
      classificationSource: "NAVER_FAILED",
      reviewState: "MANUAL",
      naverEvidence: { status: "FAILED", confidenceScore: 0, evidenceCodes: [], failureCode: "NAVER_LOCAL_SEARCH_TIMEOUT" },
    });
    expect(JSON.stringify(row.naverEvidence)).not.toContain("provider");
  });

  it("loads NAVER evidence when the pending queue exceeds the D1 bind parameter limit", async () => {
    const db = createDb(env.DB);
    const candidates = [];
    for (let index = 0; index < 120; index += 1) {
      candidates.push(await upsertBusinessLicense(db, {
        ...license,
        sourceManagementNo: `bulk-large-${index}`,
        businessName: `대규모 검수 해장국 ${index}`,
      }, now));
    }
    await addVerifiedNaverEvidence(candidates.at(-1)!.id);

    const rows = (await listBulkReviewGroups(db)).flatMap((group) => group.candidates);

    expect(rows.length).toBeGreaterThanOrEqual(120);
    expect(rows.find((row) => row.id === candidates.at(-1)!.id)?.classificationSource).toBe("RULE_ONLY");
  });

  it("approves safe candidates and skips unsafe selections", async () => {
    const db = createDb(env.DB);
    const safe = await upsertBusinessLicense(db, { ...license, sourceManagementNo: "bulk-approve-safe", businessSubtype: "국밥" }, now);
    const unsafe = await upsertBusinessLicense(db, {
      ...license,
      sourceManagementNo: "bulk-approve-unsafe",
      businessName: "타코야끼앤버거",
      businessSubtype: "한식",
    }, now);
    await addVerifiedNaverEvidence(safe.id);

    const result = await bulkApproveCandidates(db, {
      candidateIds: [safe.id, unsafe.id],
      actorUserId: "bulk-admin",
      now,
    });

    expect(result.approved).toHaveLength(1);
    expect(result.approved[0].candidateId).toBe(safe.id);
    expect(result.skipped).toEqual(expect.arrayContaining([expect.objectContaining({ candidateId: unsafe.id })]));
    expect((await db.select().from(places)).some((place) => place.name === license.businessName)).toBe(true);
    expect((await db.select().from(businessLicenses)).find((row) => row.id === unsafe.id)?.reviewStatus).toBe("PENDING");
  });

  it("rejects more than 25 candidates in one request", async () => {
    const db = createDb(env.DB);
    await expect(bulkApproveCandidates(db, {
      candidateIds: Array.from({ length: 26 }, (_, index) => `candidate-${index}`),
      actorUserId: "bulk-admin",
      now,
    })).rejects.toThrow("BULK_LIMIT_EXCEEDED");
  });

  it("approves a conflict candidate when an active child category is selected manually", async () => {
    const db = createDb(env.DB);
    const candidate = await upsertBusinessLicense(db, {
      ...license, sourceManagementNo: "manual-conflict", businessName: "타코야끼앤버거", businessSubtype: "한식",
    }, now);
    const row = (await listBulkReviewGroups(db)).flatMap((group) => group.candidates).find((item) => item.id === candidate.id)!;
    expect(row).toMatchObject({ reviewState: "MANUAL", categoryId: null });

    const result = await approveCandidateSelections(db, {
      selections: [{ candidateId: candidate.id, categoryId: "cat-tteokbokki" }], actorUserId: "bulk-admin", now,
    });

    expect(result.approved).toEqual([expect.objectContaining({ candidateId: candidate.id })]);
  });

  it("approves a candidate with an active childless parent category", async () => {
    const db = createDb(env.DB);
    const candidate = await upsertBusinessLicense(db, {
      ...license,
      sourceManagementNo: "manual-terminal-parent",
      businessName: "기영이숯불두마리치킨 여수여천점",
      businessSubtype: "호프/통닭",
    }, now);

    const result = await approveCandidateSelections(db, {
      selections: [{ candidateId: candidate.id, categoryId: "cat-chicken" }],
      actorUserId: "bulk-admin",
      now,
    });

    expect(result.approved).toEqual([expect.objectContaining({ candidateId: candidate.id })]);
  });

  it("does not approve a blocked candidate even with a manual category", async () => {
    const db = createDb(env.DB);
    const candidate = await upsertBusinessLicense(db, {
      ...license, sourceManagementNo: "manual-blocked", latitude: null, longitude: null,
    }, now);
    const row = (await listBulkReviewGroups(db)).flatMap((group) => group.candidates).find((item) => item.id === candidate.id)!;
    const result = await approveCandidateSelections(db, {
      selections: [{ candidateId: candidate.id, categoryId: row.categoryId! }], actorUserId: "bulk-admin", now,
    });
    expect(result.approved).toHaveLength(0);
    expect(result.skipped).toEqual([expect.objectContaining({ candidateId: candidate.id, reason: expect.stringContaining("좌표") })]);
  });

  it("rejects more than 25 explicit selections", async () => {
    const db = createDb(env.DB);
    await expect(approveCandidateSelections(db, {
      selections: Array.from({ length: 26 }, (_, index) => ({ candidateId: `manual-${index}`, categoryId: "category" })),
      actorUserId: "bulk-admin", now,
    })).rejects.toThrow("BULK_LIMIT_EXCEEDED");
  });
});
