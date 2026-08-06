import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";

import { createDb } from "../../app/db/client.server";
import {
  getPlaceBySlug,
  resolvePlaceSlugRedirect,
  importPlaceRows,
  listAdminPlaces,
  listPlaces,
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

  it("resolves an absorbed place slug to its published target", async () => {
    const db = createDb(env.DB);
    await upsertPlace(db, { id: "redirect-target", row: { ...baseRow, slug: "redirect-target" }, now: "2026-08-05T00:00:00Z" });
    await env.DB.prepare("INSERT INTO place_slug_redirects (old_slug, place_id, created_at) VALUES (?, ?, ?)").bind("old-place", "redirect-target", "2026-08-05T00:00:00Z").run();
    await expect(resolvePlaceSlugRedirect(db, "old-place")).resolves.toBe("redirect-target");
    await expect(resolvePlaceSlugRedirect(db, "unknown-old-place")).resolves.toBeNull();
  });
});
