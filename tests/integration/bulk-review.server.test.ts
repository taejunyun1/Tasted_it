import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";

import { createDb } from "../../app/db/client.server";
import { aiClassificationRuns, businessLicenses, places } from "../../app/db/schema";
import {
  approveCandidateSelections,
  bulkApproveCandidates,
  listBulkReviewGroups,
} from "../../app/features/candidates/bulk-review.server";
import { upsertBusinessLicense } from "../../app/features/candidates/candidate.server";
import type { NormalizedLicense } from "../../app/features/candidates/public-data";
import { AI_CLASSIFICATION_PROMPT } from "../../app/features/candidates/ai-classification.server";

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

async function addAiAgreement(candidateId: string) {
  await createDb(env.DB).insert(aiClassificationRuns).values({ id: crypto.randomUUID(), candidateId, inputHash: crypto.randomUUID(), model: "test", promptVersion: AI_CLASSIFICATION_PROMPT, status: "SUCCESS", categorySlug: "gukbap-detail", confidence: 0.95, reasonsJson: '["규칙과 일치"]', createdAt: now });
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
    await addAiAgreement(safe.id);

    const groups = await listBulkReviewGroups(db);
    const rows = groups.flatMap((group) => group.candidates);
    expect(rows.find((row) => row.id === safe.id)).toMatchObject({ confidence: "HIGH", eligible: true, neighborhood: "운림동" });
    expect(rows.find((row) => row.id === unsafe.id)).toMatchObject({ confidence: "MEDIUM", eligible: false, classificationSource: "RULE_ONLY" });
  });

  it("loads AI results when the pending queue exceeds the D1 bind parameter limit", async () => {
    const db = createDb(env.DB);
    const candidates = [];
    for (let index = 0; index < 120; index += 1) {
      candidates.push(await upsertBusinessLicense(db, {
        ...license,
        sourceManagementNo: `bulk-large-${index}`,
        businessName: `대규모 검수 식당 ${index}`,
      }, now));
    }
    await addAiAgreement(candidates.at(-1)!.id);

    const rows = (await listBulkReviewGroups(db)).flatMap((group) => group.candidates);

    expect(rows.length).toBeGreaterThanOrEqual(120);
    expect(rows.find((row) => row.id === candidates.at(-1)!.id)?.classificationSource).toBe("AI_RULE");
  });

  it("moves a valid AI result out of manual review without marking an unsafe conflict eligible", async () => {
    const db = createDb(env.DB);
    const candidate = await upsertBusinessLicense(db, {
      ...license, sourceManagementNo: "ai-completed-conflict", businessName: "스시 충돌", businessSubtype: "한식",
    }, now);
    await db.insert(aiClassificationRuns).values({ id: crypto.randomUUID(), candidateId: candidate.id, inputHash: crypto.randomUUID(), model: "test", promptVersion: AI_CLASSIFICATION_PROMPT, status: "SUCCESS", categorySlug: "sushi-sashimi", confidence: 0.96, reasonsJson: '["AI 분류 완료"]', createdAt: now });

    const row = (await listBulkReviewGroups(db)).flatMap((group) => group.candidates).find((item) => item.id === candidate.id)!;

    expect(row).toMatchObject({ reviewState: "AUTO", eligible: false, classificationSource: "AI_RULE" });
  });

  it("ignores a legacy AI result and returns the candidate to manual review", async () => {
    const db = createDb(env.DB);
    const candidate = await upsertBusinessLicense(db, { ...license, sourceManagementNo: "legacy-ai-result", businessName: "콩물동부육계장", businessSubtype: "기타" }, now);
    await db.insert(aiClassificationRuns).values({ id: crypto.randomUUID(), candidateId: candidate.id, inputHash: crypto.randomUUID(), model: "legacy", promptVersion: "place-category-v1", status: "SUCCESS", categorySlug: "gimbap", confidence: 0.8, reasonsJson: '["gimbap"]', createdAt: now });

    const row = (await listBulkReviewGroups(db)).flatMap((group) => group.candidates).find((item) => item.id === candidate.id)!;

    expect(row).toMatchObject({ categorySlug: "stew", reviewState: "MANUAL", classificationSource: "RULE_ONLY" });
  });

  it("approves safe candidates and skips unsafe selections", async () => {
    const db = createDb(env.DB);
    const safe = await upsertBusinessLicense(db, { ...license, sourceManagementNo: "bulk-approve-safe" }, now);
    const unsafe = await upsertBusinessLicense(db, {
      ...license,
      sourceManagementNo: "bulk-approve-unsafe",
      businessName: "스시 충돌",
      businessSubtype: "한식",
    }, now);
    await addAiAgreement(safe.id);

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
      ...license, sourceManagementNo: "manual-conflict", businessName: "스시 충돌", businessSubtype: "한식",
    }, now);
    const row = (await listBulkReviewGroups(db)).flatMap((group) => group.candidates).find((item) => item.id === candidate.id)!;
    expect(row.reviewState).toBe("MANUAL");

    const result = await approveCandidateSelections(db, {
      selections: [{ candidateId: candidate.id, categoryId: row.categoryId! }], actorUserId: "bulk-admin", now,
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
