import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { createDb } from "../../app/db/client.server";
import { placeCorrectionRequests, placeRevisions, places, users } from "../../app/db/schema";
import { applyPlaceCorrection, createPlaceCorrectionRequest, verifyPlaceCorrectionRequest } from "../../app/features/places/place-correction.server";

describe("place correction requests", () => {
  it("keeps an anonymous request pending until its email token is verified", async () => {
    const db = createDb(env.DB); const prefix = `correction-${crypto.randomUUID()}`; const now = new Date("2026-08-06T11:00:00.000Z");
    const result = await createPlaceCorrectionRequest(db, { id: prefix, placeId: null, requesterUserId: null, requesterEmail: `${prefix}@example.com`, requesterRelation: "업주", requestType: "CLOSED", requestedChanges: { status: "HIDDEN" }, evidenceNote: "폐업 신고", now });
    expect((await db.select().from(placeCorrectionRequests)).find((row) => row.id === prefix)?.status).toBe("PENDING_VERIFICATION");
    await verifyPlaceCorrectionRequest(db, { token: result.token, now: new Date(now.getTime() + 60_000) });
    expect((await db.select().from(placeCorrectionRequests)).find((row) => row.id === prefix)?.status).toBe("SUBMITTED");
  });

  it("applies verified changes with a forward revision", async () => {
    const db = createDb(env.DB); const prefix = `apply-correction-${crypto.randomUUID()}`; const now = new Date("2026-08-06T11:00:00.000Z");
    await db.insert(users).values({ id: `${prefix}-admin`, email: `${prefix}@example.com`, displayName: "관리자", role: "ADMIN", emailVerifiedAt: now.toISOString(), createdAt: now.toISOString(), updatedAt: now.toISOString() });
    await db.insert(places).values({ id: `${prefix}-place`, slug: `${prefix}-place`, name: "이전 상호", status: "PUBLISHED", address: "광주 동구", neighborhood: "동명동", latitude: 35.1, longitude: 126.9, searchText: "이전 상호", createdAt: now.toISOString(), updatedAt: now.toISOString() });
    const request = await createPlaceCorrectionRequest(db, { id: `${prefix}-request`, placeId: `${prefix}-place`, requesterUserId: null, requesterEmail: `${prefix}-owner@example.com`, requesterRelation: "업주", requestType: "INFORMATION", requestedChanges: { name: "새 상호", phone: "0621234567" }, evidenceNote: "사업자 정보", now });
    await verifyPlaceCorrectionRequest(db, { token: request.token, now: new Date(now.getTime() + 60_000) });
    await applyPlaceCorrection(db, { requestId: `${prefix}-request`, actorUserId: `${prefix}-admin`, reason: "공식 정보 확인", now: new Date(now.getTime() + 120_000).toISOString() });
    expect((await db.select().from(places)).find((row) => row.id === `${prefix}-place`)).toMatchObject({ name: "새 상호", phone: "0621234567" });
    expect((await db.select().from(placeRevisions)).some((row) => row.placeId === `${prefix}-place` && row.action === "CORRECTION")).toBe(true);
  });
});
