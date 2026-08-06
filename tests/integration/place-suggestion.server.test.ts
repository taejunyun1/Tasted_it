import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

import { createDb } from "../../app/db/client.server";
import { categories, placeCategories, placeDuplicateCandidates, placeRevisions, places, placeSuggestions, reviewerApplications, users } from "../../app/db/schema";
import { approvePlaceSuggestion, submitPlaceSuggestion } from "../../app/features/places/place-suggestion.server";

describe("place suggestions", () => {
  it("requires verified email and explicit duplicate override", async () => {
    const db = createDb(env.DB); const prefix = `suggest-${crypto.randomUUID()}`; const now = "2026-08-06T10:00:00.000Z";
    const category = await db.query.categories.findFirst(); if (!category) throw new Error("category fixture missing");
    await db.insert(users).values({ id: `${prefix}-user`, email: `${prefix}@example.com`, displayName: "제안자", role: "USER", createdAt: now, updatedAt: now });
    await expect(submitPlaceSuggestion(db, { id: `${prefix}-unverified`, userId: `${prefix}-user`, name: "신규식당", address: "광주 동구 동명로 1", neighborhood: "동명동", latitude: 35.15, longitude: 126.92, phone: null, categoryId: category.id, description: null, duplicateOverrideReason: null, now })).rejects.toThrow("EMAIL_VERIFICATION_REQUIRED");
    await db.update(users).set({ emailVerifiedAt: now }).where((await import("drizzle-orm")).eq(users.id, `${prefix}-user`));
    await db.insert(places).values({ id: `${prefix}-place`, slug: `${prefix}-place`, name: "신규 식당", status: "PUBLISHED", address: "광주 동구 동명로 1", neighborhood: "동명동", latitude: 35.15, longitude: 126.92, phone: "062-111-2222", searchText: "신규 식당", createdAt: now, updatedAt: now });
    const input = { id: `${prefix}-suggestion`, userId: `${prefix}-user`, name: "신규식당 본점", address: "광주 동구 동명로 1", neighborhood: "동명동", latitude: 35.1501, longitude: 126.9201, phone: "0621112222", categoryId: category.id, description: "새 지점", duplicateOverrideReason: null, now };
    await expect(submitPlaceSuggestion(db, input)).rejects.toThrow("DUPLICATE_CONFIRMATION_REQUIRED");
    const result = await submitPlaceSuggestion(db, { ...input, duplicateOverrideReason: "동일 건물의 별도 사업장" });
    expect(result.duplicates[0]?.level).toBe("HIGH");
    expect((await db.select().from(placeDuplicateCandidates)).some((item) => item.suggestionId === input.id)).toBe(true);
  });

  it("approves into a draft place with revision and reviewer qualification count", async () => {
    const db = createDb(env.DB); const prefix = `approve-${crypto.randomUUID()}`; const now = "2026-08-06T10:00:00.000Z";
    const category = await db.query.categories.findFirst(); if (!category) throw new Error("category fixture missing");
    await db.insert(users).values([
      { id: `${prefix}-user`, email: `${prefix}-user@example.com`, displayName: "제안자", role: "USER", emailVerifiedAt: now, createdAt: now, updatedAt: now },
      { id: `${prefix}-admin`, email: `${prefix}-admin@example.com`, displayName: "관리자", role: "ADMIN", emailVerifiedAt: now, createdAt: now, updatedAt: now },
    ]);
    await db.insert(reviewerApplications).values({ id: `${prefix}-application`, userId: `${prefix}-user`, status: "APPLIED", statement: "기준 설명입니다 충분합니다", occupation: "기록자", tasteDirection: "지역 음식", regionCode: "GWANGJU", specialtySlugs: "[]", approvedSuggestionCount: 0, createdAt: now, updatedAt: now });
    await submitPlaceSuggestion(db, { id: `${prefix}-suggestion`, userId: `${prefix}-user`, name: "승인 식당", address: "광주 동구 승인로 2", neighborhood: "동명동", latitude: 35.16, longitude: 126.93, phone: null, categoryId: category.id, description: "추천", duplicateOverrideReason: null, now });
    const result = await approvePlaceSuggestion(db, { suggestionId: `${prefix}-suggestion`, actorUserId: `${prefix}-admin`, placeId: `${prefix}-place`, reason: "정보 확인", now });
    expect(result.status).toBe("DRAFT");
    expect((await db.select().from(places)).find((item) => item.id === result.placeId)?.status).toBe("DRAFT");
    expect((await db.select().from(placeCategories)).some((item) => item.placeId === result.placeId && item.isPrimary)).toBe(true);
    expect((await db.select().from(placeSuggestions)).find((item) => item.id === `${prefix}-suggestion`)?.status).toBe("APPROVED");
    expect((await db.select().from(placeRevisions)).some((item) => item.placeId === result.placeId && item.action === "CREATE_FROM_SUGGESTION")).toBe(true);
    expect((await db.select().from(reviewerApplications)).find((item) => item.id === `${prefix}-application`)?.approvedSuggestionCount).toBe(1);
  });
});
