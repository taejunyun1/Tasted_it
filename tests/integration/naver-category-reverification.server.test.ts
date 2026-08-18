import { env } from "cloudflare:workers";
import { and, eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createDb } from "../../app/db/client.server";
import { adminAuditLogs, categories, naverLocalCategoryVerifications, placeCategories, placeSourceLinks, places } from "../../app/db/schema";
import { upsertBusinessLicense } from "../../app/features/candidates/candidate.server";
import { applyNaverCategoryReverification, previewNaverCategoryReverification } from "../../app/features/candidates/naver-category-reverification.server";
import { NaverLocalSearchError, type NaverLocalSearchAdapter } from "../../app/features/candidates/naver-local-search.server";
import { upsertPlace } from "../../app/features/places/place.server";

const now = "2026-08-15T01:00:00.000Z";

beforeEach(async () => {
  await env.DB.batch([
    env.DB.prepare("DELETE FROM naver_local_category_verifications WHERE business_license_id LIKE 'naver-reverify-%'"),
    env.DB.prepare("DELETE FROM place_source_links WHERE place_id = 'naver-reverify-place'"),
    env.DB.prepare("DELETE FROM places WHERE id = 'naver-reverify-place'"),
    env.DB.prepare("DELETE FROM users WHERE id = 'naver-reverify-admin'"),
    env.DB.prepare("INSERT OR IGNORE INTO users (id,email,display_name,role,created_at,updated_at) VALUES ('naver-reverify-admin','naver-reverify-admin@example.com','관리자','ADMIN',?,?)").bind(now, now),
    env.DB.prepare("INSERT OR IGNORE INTO categories (id,slug,name,emoji,sort_order,parent_id,created_at,updated_at) VALUES ('naver-reverify-home','home-meal','백반·가정식','🍚',1,NULL,?,?)").bind(now, now),
    env.DB.prepare("INSERT OR IGNORE INTO categories (id,slug,name,emoji,sort_order,parent_id,created_at,updated_at) VALUES ('naver-reverify-grill','grill','고기·구이','🥩',2,NULL,?,?)").bind(now, now),
  ]);
});

async function seedPublishedPlace() {
  const db = createDb(env.DB);
  const license = await upsertBusinessLicense(db, {
    sourceType: "GENERAL_RESTAURANT", sourceManagementNo: `naver-reverify-${crypto.randomUUID()}`,
    businessName: "신 돼지세끼", businessSubtype: "식육(숯불구이)", salesStatusCode: "01", salesStatusName: "영업/정상",
    detailStatusCode: "01", detailStatusName: "영업", normalizedStatus: "OPEN", lotAddress: null,
    roadAddress: "광주광역시 서구 화정동 1", phone: null, sourceX: null, sourceY: null,
    latitude: 35.15, longitude: 126.92, regionCode: "GWANGJU", sourceUpdatedAt: now, rawPayload: "{}",
  }, now);
  await upsertPlace(db, {
    id: "naver-reverify-place",
    row: {
      name: "신 돼지세끼", slug: "naver-reverify-place", address: "광주광역시 서구 화정동 1", neighborhood: "화정동",
      latitude: 35.15, longitude: 126.92, primaryCategory: "home-meal", phone: null, parkingSummary: null,
      kakaoPlaceId: null, heroImageUrl: null, status: "PUBLISHED", searchText: "신 돼지세끼 화정동",
    },
    now,
  });
  await db.insert(placeSourceLinks).values({ id: "naver-reverify-link", placeId: "naver-reverify-place", businessLicenseId: license.id, isPrimary: true, createdAt: now });
  return { db, licenseId: license.id };
}

function verifiedGrillAdapter() {
  return {
    search: vi.fn(async () => [{
      name: "신 돼지세끼", category: "음식점>육류,고기요리", address: "광주광역시 서구 화정동 1", roadAddress: "광주광역시 서구 화정동 1", latitude: 35.15, longitude: 126.92,
    }]),
  } satisfies NaverLocalSearchAdapter;
}

describe("NAVER category reverification", () => {
  it("previews an authority-backed public-place change and persists only the safe verification summary", async () => {
    const { db, licenseId } = await seedPublishedPlace();
    const adapter = verifiedGrillAdapter();

    await expect(previewNaverCategoryReverification(db, {
      afterPlaceId: null, limit: 100, now, adapter, dailyLimit: 200,
    })).resolves.toMatchObject({
      scanned: 1, verified: 1, changed: 1, apiCalls: 1,
      changes: [expect.objectContaining({ placeId: "naver-reverify-place", fromSlug: "home-meal", toSlug: "grill", decision: "CHANGE" })],
    });
    expect(adapter.search).toHaveBeenCalledTimes(1);
    const verification = await db.query.naverLocalCategoryVerifications.findFirst({ where: eq(naverLocalCategoryVerifications.businessLicenseId, licenseId) });
    expect(verification).toMatchObject({ status: "VERIFIED", confidenceScore: 100, failureCode: null });
    await expect(db.query.categories.findFirst({ where: eq(categories.id, verification!.mappedCategoryId!) }))
      .resolves.toMatchObject({ slug: "grill" });
  });

  it("applies an eligible result exactly once, creates an audit trail, and reuses the safe cache", async () => {
    const { db } = await seedPublishedPlace();
    const adapter = verifiedGrillAdapter();

    await expect(applyNaverCategoryReverification(db, {
      actorUserId: "naver-reverify-admin", afterPlaceId: null, limit: 100, now, adapter, dailyLimit: 200,
    })).resolves.toMatchObject({ changed: 1, apiCalls: 1 });
    await expect(db.select({ slug: categories.slug }).from(placeCategories).innerJoin(categories, eq(categories.id, placeCategories.categoryId))
      .where(eq(placeCategories.placeId, "naver-reverify-place"))).resolves.toEqual([{ slug: "grill" }]);
    await expect(db.query.adminAuditLogs.findFirst({ where: and(eq(adminAuditLogs.targetId, "naver-reverify-place"), eq(adminAuditLogs.action, "NAVER_CATEGORY_REVERIFICATION")) }))
      .resolves.toMatchObject({ actorUserId: "naver-reverify-admin" });

    await expect(applyNaverCategoryReverification(db, {
      actorUserId: "naver-reverify-admin", afterPlaceId: null, limit: 100, now: "2026-08-15T01:01:00.000Z", adapter, dailyLimit: 200,
    })).resolves.toMatchObject({ changed: 0, apiCalls: 0 });
    expect(adapter.search).toHaveBeenCalledTimes(1);
  });

  it("stops the whole run when the NAVER feature is disabled instead of recording every place as a failed lookup", async () => {
    const { db, licenseId } = await seedPublishedPlace();
    const adapter = {
      search: vi.fn(async () => {
        throw new NaverLocalSearchError("NAVER_LOCAL_SEARCH_DISABLED");
      }),
    } satisfies NaverLocalSearchAdapter;

    await expect(previewNaverCategoryReverification(db, {
      afterPlaceId: null, limit: 100, now, adapter, dailyLimit: 200,
    })).rejects.toThrow("NAVER_LOCAL_SEARCH_DISABLED");
    expect(adapter.search).toHaveBeenCalledTimes(1);
    await expect(db.query.naverLocalCategoryVerifications.findFirst({
      where: eq(naverLocalCategoryVerifications.businessLicenseId, licenseId),
    })).resolves.toBeUndefined();
  });
});
