import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";

import { createDb } from "../../app/db/client.server";
import { businessLicenseExclusions, categories, placeCategories, placeSourceLinks, places } from "../../app/db/schema";
import { applyCategoryReclassification, previewCategoryReclassification } from "../../app/features/candidates/category-reclassification.server";
import { upsertBusinessLicense } from "../../app/features/candidates/candidate.server";
import { upsertPlace } from "../../app/features/places/place.server";

const now = "2026-08-14T10:00:00.000Z";

beforeEach(async () => {
  await env.DB.batch([
    env.DB.prepare("DELETE FROM place_source_links WHERE place_id IN ('reclassification-grill-place', 'reclassification-pc-place')"),
    env.DB.prepare("DELETE FROM places WHERE id IN ('reclassification-grill-place', 'reclassification-pc-place')"),
    env.DB.prepare("INSERT OR IGNORE INTO users (id,email,display_name,role,created_at,updated_at) VALUES ('reclassification-admin','reclassification-admin@example.com','관리자','ADMIN',?,?)").bind(now, now),
    env.DB.prepare("INSERT OR IGNORE INTO categories (id,slug,name,emoji,sort_order,parent_id,created_at,updated_at) VALUES ('reclassification-home','home-meal','백반·가정식','🍚',1,NULL,?,?)").bind(now, now),
    env.DB.prepare("INSERT OR IGNORE INTO categories (id,slug,name,emoji,sort_order,parent_id,created_at,updated_at) VALUES ('reclassification-grill','grill','고기·구이','🥩',2,NULL,?,?)").bind(now, now),
  ]);
});

describe("place category reclassification", () => {
  it("previews and applies a source-backed grill correction once", async () => {
    const db = createDb(env.DB);
    const license = await upsertBusinessLicense(db, {
      sourceType: "GENERAL_RESTAURANT", sourceManagementNo: `grill-${crypto.randomUUID()}`,
      businessName: "신 돼지세끼", businessSubtype: "식육(숯불구이)", salesStatusCode: "01", salesStatusName: "영업/정상",
      detailStatusCode: "01", detailStatusName: "영업", normalizedStatus: "OPEN", lotAddress: null,
      roadAddress: "광주광역시 서구 화정동 1", phone: null, sourceX: null, sourceY: null,
      latitude: 35.15, longitude: 126.92, regionCode: "GWANGJU", sourceUpdatedAt: now, rawPayload: "{}",
    }, now);
    await upsertPlace(db, {
      id: "reclassification-grill-place",
      row: {
        name: "신 돼지세끼", slug: "reclassification-grill-place", address: "광주광역시 서구 화정동 1", neighborhood: "화정동",
        latitude: 35.15, longitude: 126.92, primaryCategory: "home-meal", phone: null, parkingSummary: null,
        kakaoPlaceId: null, heroImageUrl: null, status: "PUBLISHED", searchText: "신 돼지세끼 화정동",
      },
      now,
    });
    await db.insert(placeSourceLinks).values({ id: "reclassification-grill-link", placeId: "reclassification-grill-place", businessLicenseId: license.id, isPrimary: true, createdAt: now });

    await expect(previewCategoryReclassification(db, { afterPlaceId: null, limit: 100 })).resolves.toMatchObject({
      changed: 1,
      changes: expect.arrayContaining([expect.objectContaining({ placeId: "reclassification-grill-place", fromSlug: "home-meal", toSlug: "grill", decision: "CHANGE" })]),
    });

    await expect(applyCategoryReclassification(db, { actorUserId: "reclassification-admin", afterPlaceId: null, limit: 100, now })).resolves.toMatchObject({ changed: 1 });
    await expect(db.select({ slug: categories.slug }).from(placeCategories).innerJoin(categories, eq(categories.id, placeCategories.categoryId))
      .where(eq(placeCategories.placeId, "reclassification-grill-place"))).resolves.toEqual([{ slug: "grill" }]);
    await expect(applyCategoryReclassification(db, { actorUserId: "reclassification-admin", afterPlaceId: null, limit: 100, now })).resolves.toMatchObject({ changed: 0 });
  });

  it("persists non-food exclusions without hiding or deleting the place row", async () => {
    const db = createDb(env.DB);
    const license = await upsertBusinessLicense(db, {
      sourceType: "GENERAL_RESTAURANT", sourceManagementNo: `pc-bang-${crypto.randomUUID()}`,
      businessName: "청춘 PC방", businessSubtype: "일반음식점", salesStatusCode: "01", salesStatusName: "영업/정상",
      detailStatusCode: "01", detailStatusName: "영업", normalizedStatus: "OPEN", lotAddress: null,
      roadAddress: "광주광역시 서구 화정동 2", phone: null, sourceX: null, sourceY: null,
      latitude: 35.15, longitude: 126.92, regionCode: "GWANGJU", sourceUpdatedAt: now, rawPayload: "{}",
    }, now);
    // Simulate a place published before the new rule existed. New ingestion
    // already excludes this name, but the batch must repair legacy records too.
    await db.update(businessLicenseExclusions).set({ status: "CLEARED", updatedAt: now })
      .where(eq(businessLicenseExclusions.businessLicenseId, license.id));
    await upsertPlace(db, {
      id: "reclassification-pc-place",
      row: {
        name: "청춘 PC방", slug: "reclassification-pc-place", address: "광주광역시 서구 화정동 2", neighborhood: "화정동",
        latitude: 35.15, longitude: 126.92, primaryCategory: "home-meal", phone: null, parkingSummary: null,
        kakaoPlaceId: null, heroImageUrl: null, status: "PUBLISHED", searchText: "청춘 pc방 화정동",
      },
      now,
    });
    await db.insert(placeSourceLinks).values({ id: "reclassification-pc-link", placeId: "reclassification-pc-place", businessLicenseId: license.id, isPrimary: true, createdAt: now });

    await expect(previewCategoryReclassification(db, { afterPlaceId: null, limit: 100 })).resolves.toMatchObject({
      excluded: 1,
      changes: expect.arrayContaining([expect.objectContaining({ placeId: "reclassification-pc-place", decision: "EXCLUDE" })]),
    });
    await expect(applyCategoryReclassification(db, { actorUserId: "reclassification-admin", afterPlaceId: null, limit: 100, now })).resolves.toMatchObject({ excluded: 1 });
    await expect(db.query.businessLicenseExclusions.findFirst({ where: eq(businessLicenseExclusions.businessLicenseId, license.id) }))
      .resolves.toMatchObject({ reason: "NOT_RESTAURANT", status: "ACTIVE", matchedRule: "NAME_PC_BANG" });
    await expect(db.query.places.findFirst({ where: eq(places.id, "reclassification-pc-place") })).resolves.toMatchObject({ status: "PUBLISHED" });
    await expect(applyCategoryReclassification(db, { actorUserId: "reclassification-admin", afterPlaceId: null, limit: 100, now })).resolves.toMatchObject({ excluded: 0 });
  });
});
