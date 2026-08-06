import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { createDb } from "../../app/db/client.server";
import { placeRevalidationCases, places, users } from "../../app/db/schema";
import { enqueueStalePlaceRevalidations, resolvePlaceRevalidation } from "../../app/features/places/place-revalidation.server";

describe("place revalidation", () => {
  it("queues places not verified for 90 days and restores only by admin resolution", async () => {
    const db = createDb(env.DB); const prefix = `revalidate-${crypto.randomUUID()}`; const now = "2026-08-06T12:00:00.000Z";
    await db.insert(users).values({ id: `${prefix}-admin`, email: `${prefix}@example.com`, displayName: "관리자", role: "ADMIN", createdAt: now, updatedAt: now });
    await db.insert(places).values({ id: `${prefix}-place`, slug: `${prefix}-place`, name: "오래된 장소", status: "PUBLISHED", address: "광주", neighborhood: "동명동", latitude: 35.1, longitude: 126.9, searchText: "오래된 장소", lastVerifiedAt: "2026-01-01T00:00:00.000Z", createdAt: now, updatedAt: now });
    expect((await enqueueStalePlaceRevalidations(db, { now })).created).toBeGreaterThanOrEqual(1);
    const item = (await db.select().from(placeRevalidationCases)).find((row) => row.placeId === `${prefix}-place` && row.reasonType === "STALE_90D"); if (!item) throw new Error("case missing");
    await resolvePlaceRevalidation(db, { caseId: item.id, actorUserId: `${prefix}-admin`, resolution: "KEEP_PUBLISHED", reason: "영업 확인", now });
    expect((await db.select().from(places)).find((row) => row.id === `${prefix}-place`)).toMatchObject({ status: "PUBLISHED", lastVerifiedAt: now });
  });
});
