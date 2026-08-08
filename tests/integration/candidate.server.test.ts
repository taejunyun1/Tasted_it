import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";

import { createDb } from "../../app/db/client.server";
import { businessLicenseExclusions, placeRevalidationCases, places } from "../../app/db/schema";
import { approveCandidate, listExcludedCandidates, listPendingCandidates, restoreExcludedCandidate, upsertBusinessLicense } from "../../app/features/candidates/candidate.server";
import type { NormalizedLicense } from "../../app/features/candidates/public-data";

const now = "2026-08-05T10:00:00.000Z";
const openLicense: NormalizedLicense = {
  sourceType: "GENERAL_RESTAURANT", sourceManagementNo: "candidate-m-1", businessName: "후보식당", businessSubtype: "한식",
  salesStatusCode: "01", salesStatusName: "영업/정상", detailStatusCode: "01", detailStatusName: "영업", normalizedStatus: "OPEN",
  lotAddress: null, roadAddress: "광주광역시 동구 예술길 1 (동명동)", phone: null, sourceX: null, sourceY: null,
  latitude: 35.15, longitude: 126.92, regionCode: "GWANGJU", sourceUpdatedAt: now, rawPayload: "{}",
};

beforeEach(async () => {
  await env.DB.batch([
    env.DB.prepare("INSERT OR IGNORE INTO users (id,email,display_name,role,created_at,updated_at) VALUES ('candidate-admin','candidate-admin@example.com','관리자','ADMIN',?,?)").bind(now, now),
    env.DB.prepare("INSERT OR IGNORE INTO categories (id,slug,name,emoji,sort_order,parent_id,created_at,updated_at) VALUES ('candidate-parent','candidate-parent','테스트 대분류','🍚',1,NULL,?,?)").bind(now, now),
    env.DB.prepare("INSERT OR IGNORE INTO categories (id,slug,name,emoji,sort_order,parent_id,created_at,updated_at) VALUES ('candidate-category','candidate-child','한식','🍚',2,'candidate-parent',?,?)").bind(now, now),
    env.DB.prepare("UPDATE categories SET parent_id='candidate-parent', is_active=1 WHERE id='candidate-category'"),
  ]);
});

describe("candidate review service", () => {
  it("lists only open pending candidates", async () => {
    const db = createDb(env.DB);
    await upsertBusinessLicense(db, openLicense, now);
    await upsertBusinessLicense(db, { ...openLicense, sourceManagementNo: "closed-candidate", businessName: "폐업식당", normalizedStatus: "CLOSED", salesStatusName: "폐업" }, now);
    const candidates = await listPendingCandidates(db);
    expect(candidates.map((candidate) => candidate.businessName)).toContain("후보식당");
    expect(candidates.map((candidate) => candidate.businessName)).not.toContain("폐업식당");
  });

  it("stores a new chain candidate as an active exclusion", async () => {
    const db = createDb(env.DB);
    const result = await upsertBusinessLicense(db, {
      ...openLicense,
      sourceManagementNo: `chain-${crypto.randomUUID()}`,
      businessName: "파리바게뜨 광주점",
    }, now);

    expect(result.excluded).toBe(true);
    expect((await listPendingCandidates(db)).map((candidate) => candidate.id)).not.toContain(result.id);
    expect(await listExcludedCandidates(db)).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: result.id, exclusionReason: "CHAIN_STORE", chainName: "파리바게뜨" }),
    ]));
  });

  it("stores a room salon candidate as an adult-entertainment exclusion", async () => {
    const db = createDb(env.DB);
    const result = await upsertBusinessLicense(db, {
      ...openLicense,
      sourceManagementNo: `adult-${crypto.randomUUID()}`,
      businessName: "황제 룸싸롱",
      businessSubtype: "유흥주점영업",
    }, now);

    expect(result.excluded).toBe(true);
    expect((await listPendingCandidates(db)).map((candidate) => candidate.id)).not.toContain(result.id);
    expect(await listExcludedCandidates(db)).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: result.id,
        exclusionReason: "ADULT_ENTERTAINMENT",
        exclusionCategory: "ADULT_ENTERTAINMENT",
      }),
    ]));
  });

  it("keeps a karaoke bar candidate in the pending queue", async () => {
    const db = createDb(env.DB);
    const result = await upsertBusinessLicense(db, {
      ...openLicense,
      sourceManagementNo: `karaoke-${crypto.randomUUID()}`,
      businessName: "동네 단란주점",
      businessSubtype: "단란주점영업",
    }, now);

    expect(result.excluded).toBe(false);
    expect((await listPendingCandidates(db)).map((candidate) => candidate.id)).toContain(result.id);
  });

  it("keeps an admin-restored chain candidate in the pending queue after resync", async () => {
    const db = createDb(env.DB);
    const sourceManagementNo = `restored-chain-${crypto.randomUUID()}`;
    const item = { ...openLicense, sourceManagementNo, businessName: "뚜레쥬르 동명점" };
    const candidate = await upsertBusinessLicense(db, item, now);

    await restoreExcludedCandidate(db, { candidateId: candidate.id, actorUserId: "candidate-admin", now: "2026-08-05T11:00:00.000Z" });
    const resynced = await upsertBusinessLicense(db, item, "2026-08-05T12:00:00.000Z");

    expect(resynced.excluded).toBe(false);
    expect((await listPendingCandidates(db)).map((row) => row.id)).toContain(candidate.id);
    expect(await db.query.businessLicenseExclusions.findFirst({ where: eq(businessLicenseExclusions.businessLicenseId, candidate.id) }))
      .toMatchObject({ status: "OVERRIDDEN", overriddenBy: "candidate-admin" });
  });

  it("clears an active exclusion when the business name no longer matches a chain", async () => {
    const db = createDb(env.DB);
    const sourceManagementNo = `renamed-chain-${crypto.randomUUID()}`;
    const candidate = await upsertBusinessLicense(db, { ...openLicense, sourceManagementNo, businessName: "파리바게트 충장점" }, now);

    const renamed = await upsertBusinessLicense(db, { ...openLicense, sourceManagementNo, businessName: "충장로 독립빵집" }, "2026-08-05T13:00:00.000Z");

    expect(renamed.excluded).toBe(false);
    expect(await db.query.businessLicenseExclusions.findFirst({ where: eq(businessLicenseExclusions.businessLicenseId, candidate.id) }))
      .toMatchObject({ status: "CLEARED" });
    expect((await listPendingCandidates(db)).map((row) => row.id)).toContain(candidate.id);
  });

  it("does not exclude a closed chain license or approve an active exclusion", async () => {
    const db = createDb(env.DB);
    const closed = await upsertBusinessLicense(db, {
      ...openLicense,
      sourceManagementNo: `closed-chain-${crypto.randomUUID()}`,
      businessName: "뚜레쥬르 폐업점",
      normalizedStatus: "CLOSED",
    }, now);
    const active = await upsertBusinessLicense(db, {
      ...openLicense,
      sourceManagementNo: `active-chain-${crypto.randomUUID()}`,
      businessName: "파리바게뜨 승인차단점",
    }, now);

    expect(closed.excluded).toBe(false);
    await expect(approveCandidate(db, {
      candidateId: active.id,
      actorUserId: "candidate-admin",
      categoryId: "candidate-category",
      name: "파리바게뜨 승인차단점",
      address: openLicense.roadAddress!,
      latitude: 35.15,
      longitude: 126.92,
      now,
    })).rejects.toThrow("CANDIDATE_NOT_APPROVABLE");
  });

  it("publishes after approval and hides the place when the license closes", async () => {
    const db = createDb(env.DB);
    const candidate = await upsertBusinessLicense(db, { ...openLicense, sourceManagementNo: "approval-candidate" }, now);
    const approved = await approveCandidate(db, { candidateId: candidate.id, actorUserId: "candidate-admin", categoryId: "candidate-category", slug: "approved-candidate", name: "승인식당", address: openLicense.roadAddress!, latitude: 35.15, longitude: 126.92, now });
    expect(await db.query.places.findFirst({ where: eq(places.id, approved.placeId) })).toMatchObject({ status: "PUBLISHED", neighborhood: "동명동" });
    await upsertBusinessLicense(db, { ...openLicense, sourceManagementNo: "approval-candidate", normalizedStatus: "CLOSED", salesStatusName: "폐업" }, "2026-08-05T11:00:00.000Z");
    expect((await db.query.places.findFirst({ where: eq(places.id, approved.placeId) }))).toMatchObject({ status: "HIDDEN", closedAt: "2026-08-05T11:00:00.000Z" });
    expect((await db.select().from(placeRevalidationCases)).some((item) => item.placeId === approved.placeId && item.reasonType === "CLOSED")).toBe(true);
  });

  it("creates unique slugs automatically from duplicate business names", async () => {
    const db = createDb(env.DB);
    const first = await upsertBusinessLicense(db, { ...openLicense, sourceManagementNo: "slug-first", businessName: "같은 상호" }, now);
    const second = await upsertBusinessLicense(db, { ...openLicense, sourceManagementNo: "slug-second", businessName: "같은 상호" }, now);
    const approve = (candidateId: string) => approveCandidate(db, { candidateId, actorUserId: "candidate-admin", categoryId: "candidate-category", name: "같은 상호", address: openLicense.roadAddress!, latitude: 35.15, longitude: 126.92, now });
    await approve(first.id);
    await approve(second.id);
    const rows = await db.select({ slug: places.slug }).from(places);
    expect(rows.map((row) => row.slug)).toEqual(expect.arrayContaining(["같은-상호", "같은-상호-2"]));
  });

  it("rejects approval when the address has no neighborhood token", async () => {
    const db = createDb(env.DB);
    const candidate = await upsertBusinessLicense(db, { ...openLicense, sourceManagementNo: "missing-neighborhood" }, now);
    await expect(approveCandidate(db, {
      candidateId: candidate.id, actorUserId: "candidate-admin", categoryId: "candidate-category",
      name: "동네없는식당", address: "광주광역시 동구 예술길 1", latitude: 35.15, longitude: 126.92, now,
    })).rejects.toThrow("PLACE_NEIGHBORHOOD_NOT_FOUND");
  });
});
