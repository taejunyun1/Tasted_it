import { env } from "cloudflare:workers";
import { eq } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import { createDb } from "../../app/db/client.server";
import { adminAuditLogs, placeCorrectionRequests, placeRevisions, places, users } from "../../app/db/schema";
import { applyPlaceCorrection, createPlaceCorrectionRequest, transitionPlaceCorrection, verifyPlaceCorrectionRequest } from "../../app/features/places/place-correction.server";
import { listCorrectionOperations } from "../../app/features/places/place-operations-admin.server";

async function fixture(verified = false, options: { requestType?: "INFORMATION" | "CLOSED" | "RIGHTS"; now?: Date } = {}) {
  const db = createDb(env.DB), id = `s07-${crypto.randomUUID()}`, now = options.now ?? new Date("2026-11-18T01:00:00.000Z");
  const actorUserId = `${id}-admin`, placeId = `${id}-place`;
  await db.insert(users).values({ id: actorUserId, email: `${actorUserId}@example.test`, displayName: "합성 관리자", role: "ADMIN", createdAt: now.toISOString(), updatedAt: now.toISOString() });
  await db.insert(places).values({ id: placeId, slug: placeId, name: "기존 합성 식당", status: "PUBLISHED", address: "광주 합성 주소", neighborhood: "합성동", latitude: 35.15, longitude: 126.92, searchText: "기존 합성 식당", createdAt: now.toISOString(), updatedAt: now.toISOString() });
  const request = await createPlaceCorrectionRequest(db, { id, placeId, requesterUserId: null, requesterEmail: `${id}@example.test`, requesterRelation: "방문자", requestType: options.requestType ?? "INFORMATION", requestedChanges: { name: "확인한 새 상호" }, evidenceNote: "합성 현장 확인 근거", now });
  if (verified) await verifyPlaceCorrectionRequest(db, { token: request.token, now });
  return { db, id, now, actorUserId, placeId, token: request.token };
}

const reason = "확인한 합성 정정 근거";

describe("S07 correction boundaries", () => {
  it("rejects unknown public request types before creating a pending request", async () => {
    const f = await fixture();
    await expect(createPlaceCorrectionRequest(f.db, { id: `${f.id}-invalid`, placeId: f.placeId, requesterUserId: null, requesterEmail: `${f.id}@example.test`, requesterRelation: "방문자", requestType: "__proto__" as never, requestedChanges: {}, evidenceNote: null, now: f.now })).rejects.toThrow("CORRECTION_TYPE_INVALID");
  });

  it("places verified closure and rights reports before ordinary requests in stable time order", async () => {
    const normal = await fixture(true);
    const closure = await fixture(true, { requestType: "CLOSED", now: new Date("2026-11-18T01:01:00.000Z") });
    const rights = await fixture(true, { requestType: "RIGHTS", now: new Date("2026-11-18T01:02:00.000Z") });
    const ids = new Set([normal.id, closure.id, rights.id]);
    expect((await listCorrectionOperations(normal.db)).filter(row => ids.has(row.id)).map(row => row.id)).toEqual([closure.id, rights.id, normal.id]);
  });

  it("does not expose or transition an unverified request through an admin ID", async () => {
    const f = await fixture();
    expect((await listCorrectionOperations(f.db)).map(row => row.id)).not.toContain(f.id);
    await expect(transitionPlaceCorrection(f.db, { requestId: f.id, actorUserId: f.actorUserId, status: "REVIEWING", reason, now: f.now.toISOString() })).rejects.toThrow("CORRECTION_NOT_APPLICABLE");
    await expect(applyPlaceCorrection(f.db, { requestId: f.id, actorUserId: f.actorUserId, reason, now: f.now.toISOString(), preservePublicationState: true })).rejects.toThrow("CORRECTION_NOT_APPLICABLE");
    expect((await f.db.query.placeCorrectionRequests.findFirst({ where: eq(placeCorrectionRequests.id, f.id) }))?.status).toBe("PENDING_VERIFICATION");
    expect((await f.db.query.places.findFirst({ where: eq(places.id, f.placeId) }))?.name).toBe("기존 합성 식당");
  });

  it("verifies a token atomically once, including concurrent and expired use", async () => {
    const f = await fixture();
    const outcomes = await Promise.allSettled([1, 2].map(() => verifyPlaceCorrectionRequest(f.db, { token: f.token, now: f.now })));
    expect(outcomes.filter(outcome => outcome.status === "fulfilled")).toHaveLength(1);
    await expect(verifyPlaceCorrectionRequest(f.db, { token: f.token, now: f.now })).rejects.toThrow("CORRECTION_TOKEN_INVALID");
    const expired = await fixture();
    await expect(verifyPlaceCorrectionRequest(expired.db, { token: expired.token, now: new Date(expired.now.getTime() + 30 * 60_000) })).rejects.toThrow("CORRECTION_TOKEN_INVALID");
  });

  it("records internal review without public changes and never resurrects a terminal request", async () => {
    const f = await fixture(true);
    await transitionPlaceCorrection(f.db, { requestId: f.id, actorUserId: f.actorUserId, status: "REVIEWING", reason, now: f.now.toISOString() });
    expect((await f.db.query.places.findFirst({ where: eq(places.id, f.placeId) }))?.name).toBe("기존 합성 식당");
    expect(await f.db.query.adminAuditLogs.findFirst({ where: eq(adminAuditLogs.targetId, f.id) })).toMatchObject({ action: "TRANSITION_PLACE_CORRECTION", targetId: f.id });
    await transitionPlaceCorrection(f.db, { requestId: f.id, actorUserId: f.actorUserId, status: "REJECTED", reason, now: f.now.toISOString() });
    await expect(transitionPlaceCorrection(f.db, { requestId: f.id, actorUserId: f.actorUserId, status: "REVIEWING", reason, now: f.now.toISOString() })).rejects.toThrow("CORRECTION_NOT_APPLICABLE");
    await expect(transitionPlaceCorrection(f.db, { requestId: "missing", actorUserId: f.actorUserId, status: "REJECTED", reason, now: f.now.toISOString() })).rejects.toThrow("CORRECTION_NOT_APPLICABLE");
  });

  it("allows only one concurrent apply and one corresponding revision and audit", async () => {
    const f = await fixture(true);
    const outcomes = await Promise.allSettled([1, 2].map(() => applyPlaceCorrection(f.db, { requestId: f.id, actorUserId: f.actorUserId, reason, now: f.now.toISOString(), preservePublicationState: true })));
    expect(outcomes.filter(outcome => outcome.status === "fulfilled")).toHaveLength(1);
    expect(await f.db.query.placeRevisions.findMany({ where: eq(placeRevisions.placeId, f.placeId) })).toHaveLength(1);
    expect(await f.db.query.adminAuditLogs.findMany({ where: eq(adminAuditLogs.targetId, f.placeId) })).toHaveLength(1);
    expect(await f.db.query.places.findFirst({ where: eq(places.id, f.placeId) })).toMatchObject({ name: "확인한 새 상호", status: "PUBLISHED" });
  });

  it("arbitrates competing apply and rejection without changing a rejected place", async () => {
    const f = await fixture(true);
    const outcomes = await Promise.allSettled([
      applyPlaceCorrection(f.db, { requestId: f.id, actorUserId: f.actorUserId, reason, now: f.now.toISOString(), preservePublicationState: true }),
      transitionPlaceCorrection(f.db, { requestId: f.id, actorUserId: f.actorUserId, status: "REJECTED", reason, now: f.now.toISOString() }),
    ]);
    expect(outcomes.filter(outcome => outcome.status === "fulfilled")).toHaveLength(1);
    const request = await f.db.query.placeCorrectionRequests.findFirst({ where: eq(placeCorrectionRequests.id, f.id) });
    expect(["APPLIED", "REJECTED"]).toContain(request?.status);
    expect((await f.db.query.places.findFirst({ where: eq(places.id, f.placeId) }))?.name).toBe(request?.status === "APPLIED" ? "확인한 새 상호" : "기존 합성 식당");
    const audit = await f.db.query.adminAuditLogs.findMany({ where: eq(adminAuditLogs.targetId, request?.status === "APPLIED" ? f.placeId : f.id) });
    expect(audit).toHaveLength(1);
  });

  it("keeps a newer place edit and the pending request when the place changes before commit", async () => {
    const f = await fixture(true), originalBatch = f.db.batch.bind(f.db);
    const batch = vi.spyOn(f.db, "batch").mockImplementationOnce((async statements => {
      await f.db.update(places).set({ name: "다른 운영자의 새 상호" }).where(eq(places.id, f.placeId));
      return originalBatch(statements);
    }) as typeof f.db.batch);
    try {
      await expect(applyPlaceCorrection(f.db, { requestId: f.id, actorUserId: f.actorUserId, reason, now: f.now.toISOString(), preservePublicationState: true })).rejects.toThrow();
    } finally { batch.mockRestore(); }
    expect((await f.db.query.places.findFirst({ where: eq(places.id, f.placeId) }))?.name).toBe("다른 운영자의 새 상호");
    expect((await f.db.query.placeCorrectionRequests.findFirst({ where: eq(placeCorrectionRequests.id, f.id) }))?.status).toBe("SUBMITTED");
    expect(await f.db.query.placeRevisions.findMany({ where: eq(placeRevisions.placeId, f.placeId) })).toHaveLength(0);
  });

  it("rolls back request, place and revision if the audit insert fails", async () => {
    const f = await fixture(true);
    const trigger = `s07_audit_${f.id.replaceAll("-", "")}`;
    await env.DB.exec(`CREATE TRIGGER ${trigger} BEFORE INSERT ON admin_audit_logs WHEN NEW.action='APPLY_PLACE_CORRECTION' BEGIN SELECT RAISE(ABORT,'S07_AUDIT_UNAVAILABLE'); END;`);
    try {
      await expect(applyPlaceCorrection(f.db, { requestId: f.id, actorUserId: f.actorUserId, reason, now: f.now.toISOString(), preservePublicationState: true })).rejects.toThrow();
    } finally { await env.DB.exec(`DROP TRIGGER ${trigger}`); }
    expect((await f.db.query.places.findFirst({ where: eq(places.id, f.placeId) }))?.name).toBe("기존 합성 식당");
    expect((await f.db.query.placeCorrectionRequests.findFirst({ where: eq(placeCorrectionRequests.id, f.id) }))?.status).toBe("SUBMITTED");
    expect(await f.db.query.placeRevisions.findMany({ where: eq(placeRevisions.placeId, f.placeId) })).toHaveLength(0);
  });
});
