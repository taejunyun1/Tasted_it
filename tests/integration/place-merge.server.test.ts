import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { createDb } from "../../app/db/client.server";
import { currentVotes, placeCategories, placeRevisions, placeSlugRedirects, places, savedPlaces, users, voteEvents } from "../../app/db/schema";
import { mergePlaces, restorePlaceRevision } from "../../app/features/places/place-merge.server";

describe("place merge and forward restore", () => {
  it("moves current relationships, hides the absorbed place, and creates a slug redirect", async () => {
    const db = createDb(env.DB); const prefix = `merge-${crypto.randomUUID()}`; const now = "2026-08-06T12:00:00.000Z";
    const category = await db.query.categories.findFirst(); if (!category) throw new Error("category fixture missing");
    await db.insert(users).values([{ id: `${prefix}-admin`, email: `${prefix}-admin@example.com`, displayName: "관리자", role: "ADMIN", createdAt: now, updatedAt: now }, { id: `${prefix}-user`, email: `${prefix}-user@example.com`, displayName: "회원", role: "USER", createdAt: now, updatedAt: now }]);
    for (const suffix of ["target", "source"]) await db.insert(places).values({ id: `${prefix}-${suffix}`, slug: `${prefix}-${suffix}`, name: suffix, status: "PUBLISHED", address: `광주 ${suffix}`, neighborhood: "동명동", latitude: 35.1, longitude: 126.9, searchText: suffix, createdAt: now, updatedAt: now });
    await db.insert(placeCategories).values({ placeId: `${prefix}-source`, categoryId: category.id, isPrimary: true });
    await db.insert(savedPlaces).values({ userId: `${prefix}-user`, placeId: `${prefix}-source`, createdAt: now });
    await db.insert(voteEvents).values({ id: `${prefix}-event`, placeId: `${prefix}-source`, userId: `${prefix}-user`, value: 1, eventType: "CREATE", createdAt: now });
    await db.insert(currentVotes).values({ placeId: `${prefix}-source`, userId: `${prefix}-user`, eventId: `${prefix}-event`, value: 1, updatedAt: now });
    await mergePlaces(db, { targetPlaceId: `${prefix}-target`, sourcePlaceId: `${prefix}-source`, actorUserId: `${prefix}-admin`, reason: "동일 지점", now });
    expect((await db.select().from(places)).find((row) => row.id === `${prefix}-source`)?.status).toBe("HIDDEN");
    expect((await db.select().from(savedPlaces)).some((row) => row.placeId === `${prefix}-target`)).toBe(true);
    expect((await db.select().from(currentVotes)).some((row) => row.placeId === `${prefix}-target`)).toBe(true);
    expect((await db.select().from(placeSlugRedirects)).find((row) => row.oldSlug === `${prefix}-source`)?.placeId).toBe(`${prefix}-target`);
  });

  it("restores an earlier snapshot by creating a new revision", async () => {
    const db = createDb(env.DB); const prefix = `restore-${crypto.randomUUID()}`; const now = "2026-08-06T12:00:00.000Z";
    await db.insert(users).values({ id: `${prefix}-admin`, email: `${prefix}@example.com`, displayName: "관리자", role: "ADMIN", createdAt: now, updatedAt: now });
    const original = { id: `${prefix}-place`, slug: `${prefix}-place`, name: "원래 상호", status: "PUBLISHED", address: "광주", neighborhood: "동명동", latitude: 35.1, longitude: 126.9, phone: null, parkingSummary: null, heroImageUrl: null, kakaoPlaceId: null, searchText: "원래 상호", lastVerifiedAt: null, closedAt: null, createdAt: now, updatedAt: now };
    await db.insert(places).values({ ...original, name: "변경 상호" });
    await db.insert(placeRevisions).values({ id: `${prefix}-revision`, placeId: original.id, actorUserId: `${prefix}-admin`, action: "CORRECTION", reason: "이전 수정", beforeJson: JSON.stringify(original), afterJson: JSON.stringify({ ...original, name: "변경 상호" }), sourceType: "TEST", createdAt: now });
    await restorePlaceRevision(db, { revisionId: `${prefix}-revision`, actorUserId: `${prefix}-admin`, reason: "잘못된 수정 복원", now: "2026-08-06T12:10:00.000Z" });
    expect((await db.select().from(places)).find((row) => row.id === original.id)?.name).toBe("원래 상호");
    expect((await db.select().from(placeRevisions)).filter((row) => row.placeId === original.id).some((row) => row.action === "RESTORE")).toBe(true);
  });
});
