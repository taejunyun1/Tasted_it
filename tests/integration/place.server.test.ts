import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";

import { createDb } from "../../app/db/client.server";
import { businessLicenses, placeLivenessStates, placeSourceLinks } from "../../app/db/schema";
import {
  getPlaceBySlug,
  resolvePlaceSlugRedirect,
  importPlaceRows,
  listAdminPlaces,
  listPlaces,
  listRecommendationCandidates,
  upsertPlace,
} from "../../app/features/places/place.server";
import type { PlaceImportRow } from "../../app/features/places/place.types";

const baseRow: PlaceImportRow = {
  name: "장소 서비스 테스트",
  slug: "place-service-test",
  address: "광주광역시 동구 테스트로 1",
  neighborhood: "동명동",
  latitude: 35.149,
  longitude: 126.9232,
  primaryCategory: "ramen",
  phone: null,
  parkingSummary: null,
  kakaoPlaceId: null,
  heroImageUrl: null,
  status: "PUBLISHED",
  searchText: "장소 서비스 테스트 동명동 ramen",
};

beforeEach(async () => {
  await env.DB.prepare(
    `INSERT OR IGNORE INTO categories
     (id, slug, name, emoji, sort_order, created_at, updated_at)
     VALUES ('test-category-ramen', 'ramen', '라멘', '🍜', 1, ?, ?)`,
  )
    .bind("2026-08-05T00:00:00Z", "2026-08-05T00:00:00Z")
    .run();
});

describe("place service", () => {
  it("upserts by slug and lists only published places", async () => {
    const db = createDb(env.DB);
    await upsertPlace(db, {
      id: "place-service-1",
      row: baseRow,
      now: "2026-08-05T00:00:00Z",
    });
    await upsertPlace(db, {
      id: "ignored-on-update",
      row: { ...baseRow, name: "수정된 장소명" },
      now: "2026-08-05T00:01:00Z",
    });
    await upsertPlace(db, {
      id: "hidden-place",
      row: { ...baseRow, slug: "hidden-place", status: "HIDDEN" },
      now: "2026-08-05T00:01:00Z",
    });

    const result = await listPlaces(db, { categorySlug: "ramen" });

    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("수정된 장소명");
    expect(await getPlaceBySlug(db, "place-service-test")).toMatchObject({
      slug: "place-service-test",
    });
    await expect(getPlaceBySlug(db, "hidden-place")).rejects.toMatchObject({
      status: 404,
    });
  });

  it("keeps liveness-excluded places public while omitting them from recommendation candidates", async () => {
    const db = createDb(env.DB);
    const prefix = `recommendation-liveness-${crypto.randomUUID()}`;
    const excludedId = `${prefix}-excluded`;
    const includedId = `${prefix}-included`;
    const noStateId = `${prefix}-no-state`;
    const hiddenId = `${prefix}-hidden`;

    await Promise.all([
      upsertPlace(db, {
        id: excludedId,
        row: { ...baseRow, slug: excludedId, name: "추천 제외 의심 장소" },
        now: "2026-08-13T00:00:00Z",
      }),
      upsertPlace(db, {
        id: includedId,
        row: { ...baseRow, slug: includedId, name: "추천 유지 장소" },
        now: "2026-08-13T00:00:00Z",
      }),
      upsertPlace(db, {
        id: noStateId,
        row: { ...baseRow, slug: noStateId, name: "상태 없음 장소" },
        now: "2026-08-13T00:00:00Z",
      }),
      upsertPlace(db, {
        id: hiddenId,
        row: { ...baseRow, slug: hiddenId, name: "숨김 장소", status: "HIDDEN" },
        now: "2026-08-13T00:00:00Z",
      }),
    ]);
    await db.insert(placeLivenessStates).values([
      {
        placeId: excludedId,
        status: "SUSPECTED",
        recommendationExcluded: true,
        updatedAt: "2026-08-13T00:00:00Z",
      },
      {
        placeId: includedId,
        status: "SUSPECTED",
        recommendationExcluded: false,
        updatedAt: "2026-08-13T00:00:00Z",
      },
    ]);

    const publicSlugs = (await listPlaces(db, { categorySlug: "ramen" })).map((place) => place.slug);
    const recommendationSlugs = (await listRecommendationCandidates(db, { categorySlug: "ramen" })).map((place) => place.slug);

    expect(publicSlugs).toEqual(expect.arrayContaining([excludedId, includedId, noStateId]));
    expect(publicSlugs).not.toContain(hiddenId);
    expect(recommendationSlugs).not.toContain(excludedId);
    expect(recommendationSlugs).toEqual(expect.arrayContaining([includedId, noStateId]));
    expect(recommendationSlugs).not.toContain(hiddenId);
    await expect(getPlaceBySlug(db, excludedId)).resolves.toMatchObject({ slug: excludedId });
    await expect(getPlaceBySlug(db, hiddenId)).rejects.toMatchObject({ status: 404 });
  });

  it("imports valid rows as one administrative batch", async () => {
    const db = createDb(env.DB);
    await importPlaceRows(db, {
      rows: [
        { ...baseRow, slug: "batch-place-1", name: "배치 장소 1" },
        { ...baseRow, slug: "batch-place-2", name: "배치 장소 2" },
      ],
      ids: ["batch-place-id-1", "batch-place-id-2"],
      now: "2026-08-05T00:00:00Z",
    });

    const adminPlaces = await listAdminPlaces(db);
    expect(adminPlaces.map((place) => place.slug)).toEqual(
      expect.arrayContaining(["batch-place-1", "batch-place-2"]),
    );
  });

  it("keeps non-restaurant venues out of public lists and recommendations", async () => {
    const db = createDb(env.DB);
    await upsertPlace(db, {
      id: "food-venue-place",
      row: { ...baseRow, slug: "food-venue-place", name: "별밤 라이브카페" },
      now: "2026-08-05T00:00:00Z",
    });
    await upsertPlace(db, {
      id: "pc-bang-place",
      row: { ...baseRow, slug: "pc-bang-place", name: "청춘 PC방" },
      now: "2026-08-05T00:00:00Z",
    });
    await upsertPlace(db, {
      id: "convenience-place",
      row: { ...baseRow, slug: "convenience-place", name: "GS25 동명점" },
      now: "2026-08-05T00:00:00Z",
    });
    await upsertPlace(db, {
      id: "cu-convenience-place",
      row: { ...baseRow, slug: "cu-convenience-place", name: "CU 광주상무점" },
      now: "2026-08-05T00:00:00Z",
    });
    await upsertPlace(db, {
      id: "curry-place",
      row: { ...baseRow, slug: "curry-place", name: "Curry Universe" },
      now: "2026-08-05T00:00:00Z",
    });
    await upsertPlace(db, {
      id: "live-bar-place",
      row: { ...baseRow, slug: "live-bar-place", name: "7080 별밤 라이브바" },
      now: "2026-08-05T00:00:00Z",
    });
    await upsertPlace(db, {
      id: "cabaret-place",
      row: { ...baseRow, slug: "cabaret-place", name: "황금 카바레" },
      now: "2026-08-05T00:00:00Z",
    });
    await upsertPlace(db, {
      id: "spaced-live-bar-place",
      row: { ...baseRow, slug: "spaced-live-bar-place", name: "7080 라이브\u00a0바" },
      now: "2026-08-05T00:00:00Z",
    });
    await upsertPlace(db, {
      id: "fullwidth-live-bar-place",
      row: { ...baseRow, slug: "fullwidth-live-bar-place", name: "7080 라이브ＢＡＲ" },
      now: "2026-08-05T00:00:00Z",
    });
    await upsertPlace(db, {
      id: "linked-karaoke-place",
      row: { ...baseRow, slug: "linked-karaoke-place", name: "청춘회관" },
      now: "2026-08-05T00:00:00Z",
    });
    await db.insert(businessLicenses).values({
      id: "linked-karaoke-license",
      sourceType: "GENERAL_RESTAURANT",
      sourceManagementNo: "linked-karaoke-license",
      businessName: "청춘회관",
      businessSubtype: "노래연습장업",
      normalizedStatus: "OPEN",
      regionCode: "GWANGJU",
      rawPayload: "{}",
      reviewStatus: "APPROVED",
      firstSeenAt: "2026-08-05T00:00:00Z",
      lastSeenAt: "2026-08-05T00:00:00Z",
      createdAt: "2026-08-05T00:00:00Z",
      updatedAt: "2026-08-05T00:00:00Z",
    });
    await db.insert(placeSourceLinks).values({
      id: "linked-karaoke-source-link",
      placeId: "linked-karaoke-place",
      businessLicenseId: "linked-karaoke-license",
      isPrimary: true,
      createdAt: "2026-08-05T00:00:00Z",
    });
    await env.DB.prepare("INSERT INTO place_slug_redirects (old_slug, place_id, created_at) VALUES (?, ?, ?)")
      .bind("old-live-bar-place", "live-bar-place", "2026-08-05T00:00:00Z")
      .run();

    const publicNames = (await listPlaces(db, { categorySlug: "ramen" })).map((place) => place.name);
    const recommendedNames = (await listRecommendationCandidates(db, { categorySlug: "ramen" })).map((place) => place.name);

    expect(publicNames).not.toContain("별밤 라이브카페");
    expect(publicNames).not.toContain("청춘 PC방");
    expect(publicNames).not.toContain("GS25 동명점");
    expect(publicNames).not.toContain("CU 광주상무점");
    expect(publicNames).not.toContain("7080 별밤 라이브바");
    expect(publicNames).not.toContain("황금 카바레");
    expect(publicNames).not.toContain("7080 라이브\u00a0바");
    expect(publicNames).not.toContain("7080 라이브ＢＡＲ");
    expect(publicNames).not.toContain("청춘회관");
    expect(publicNames).toContain("Curry Universe");
    expect(recommendedNames).not.toContain("별밤 라이브카페");
    expect(recommendedNames).not.toContain("7080 별밤 라이브바");
    expect(recommendedNames).not.toContain("황금 카바레");
    await expect(getPlaceBySlug(db, "live-bar-place")).rejects.toMatchObject({ status: 404 });
    await expect(getPlaceBySlug(db, "linked-karaoke-place")).rejects.toMatchObject({ status: 404 });
    await expect(resolvePlaceSlugRedirect(db, "old-live-bar-place")).resolves.toBeNull();
  });

  it("resolves an absorbed place slug to its published target", async () => {
    const db = createDb(env.DB);
    await upsertPlace(db, { id: "redirect-target", row: { ...baseRow, slug: "redirect-target" }, now: "2026-08-05T00:00:00Z" });
    await env.DB.prepare("INSERT INTO place_slug_redirects (old_slug, place_id, created_at) VALUES (?, ?, ?)").bind("old-place", "redirect-target", "2026-08-05T00:00:00Z").run();
    await expect(resolvePlaceSlugRedirect(db, "old-place")).resolves.toBe("redirect-target");
    await expect(resolvePlaceSlugRedirect(db, "unknown-old-place")).resolves.toBeNull();
  });
});
