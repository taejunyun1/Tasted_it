import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";

import { createDb } from "../../app/db/client.server";
import { places } from "../../app/db/schema";
import { approveCandidate, listPendingCandidates, upsertBusinessLicense } from "../../app/features/candidates/candidate.server";
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

  it("publishes after approval and hides the place when the license closes", async () => {
    const db = createDb(env.DB);
    const candidate = await upsertBusinessLicense(db, { ...openLicense, sourceManagementNo: "approval-candidate" }, now);
    const approved = await approveCandidate(db, { candidateId: candidate.id, actorUserId: "candidate-admin", categoryId: "candidate-category", slug: "approved-candidate", name: "승인식당", address: openLicense.roadAddress!, latitude: 35.15, longitude: 126.92, now });
    expect(await db.query.places.findFirst({ where: eq(places.id, approved.placeId) })).toMatchObject({ status: "PUBLISHED", neighborhood: "동명동" });
    await upsertBusinessLicense(db, { ...openLicense, sourceManagementNo: "approval-candidate", normalizedStatus: "CLOSED", salesStatusName: "폐업" }, "2026-08-05T11:00:00.000Z");
    expect((await db.query.places.findFirst({ where: eq(places.id, approved.placeId) }))?.status).toBe("HIDDEN");
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
