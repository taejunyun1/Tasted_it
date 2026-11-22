import { env } from "cloudflare:workers";
import { eq } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";

import { createDb } from "../../app/db/client.server";
import { adminAuditLogs, categories, placeCategories, placeDuplicateCandidates, placeReviewWorkItems, placeRevisions, places, placeSuggestions, reviewerApplications, users } from "../../app/db/schema";
import { approvePlaceSuggestion, listReviewablePlaceSuggestions, submitPlaceSuggestion, transitionPlaceSuggestion } from "../../app/features/places/place-suggestion.server";

async function decisionFixture() {
  const db = createDb(env.DB), prefix = crypto.randomUUID(), now = "2026-08-01T10:00:00.000Z";
  const category = await db.query.categories.findFirst();
  if (!category) throw new Error("category fixture missing");
  const userId = `${prefix}-member`, actorUserId = `${prefix}-admin`, otherAdmin = `${prefix}-other`, suggestionId = `${prefix}-suggestion`;
  await db.insert(users).values([userId, actorUserId, otherAdmin].map((id) => ({
    id, email: `${id}@example.test`, displayName: "합성 계정", role: id === userId ? "USER" : "ADMIN", emailVerifiedAt: now, createdAt: now, updatedAt: now,
  })));
  await submitPlaceSuggestion(db, {
    id: suggestionId, userId, name: "합성 제안 식당", address: "광주광역시 동구 합성로 10", neighborhood: "동명동",
    originLatitude: 35.16, originLongitude: 126.93, latitude: 35.16, longitude: 126.93,
    phone: null, categoryId: category.id, description: null, duplicateOverrideReason: "독립 시험 대상", now,
  });
  const read = () => db.query.placeSuggestions.findFirst({ where: eq(placeSuggestions.id, suggestionId) });
  const audit = () => db.query.adminAuditLogs.findMany({ where: eq(adminAuditLogs.targetId, suggestionId) });
  const current = async () => (await listReviewablePlaceSuggestions(db)).rows.find((row) => row.id === suggestionId)!;
  return { db, input: { suggestionId, actorUserId, now, reason: "합성 검수 근거" }, otherAdmin, read, audit, current };
}

describe("place suggestions", () => {
  it("writes no approval records if rejection commits before the approval batch", async () => {
    const f = await decisionFixture();
    const { db, input } = f;
    const originalBatch = db.batch.bind(db);
    const batch = vi.spyOn(db, "batch").mockImplementationOnce(async (...statements) => {
      await transitionPlaceSuggestion(db, { ...input, actorUserId: f.otherAdmin, status: "REJECTED", reason: "검수 반려 근거" });
      return originalBatch(...statements);
    });
    try {
      await expect(approvePlaceSuggestion(db, input)).rejects.toThrow("SUGGESTION_STALE");
    } finally {
      batch.mockRestore();
    }
    expect(await f.read()).toMatchObject({ status: "REJECTED", approvedPlaceId: null });
    expect(await db.query.places.findFirst({ where: eq(places.id, input.suggestionId) })).toBeUndefined();
    expect(await db.query.placeReviewWorkItems.findFirst({ where: eq(placeReviewWorkItems.placeId, input.suggestionId) })).toBeUndefined();
    expect(await db.query.placeRevisions.findFirst({ where: eq(placeRevisions.placeId, input.suggestionId) })).toBeUndefined();
    expect((await f.audit()).map((row) => row.action)).toEqual(["TRANSITION_PLACE_SUGGESTION"]);
  });

  it("locks approved and rejected suggestions and audits only real status decisions", async () => {
    const approved = await decisionFixture();
    await approvePlaceSuggestion(approved.db, approved.input);
    await expect(transitionPlaceSuggestion(approved.db, { ...approved.input, status: "REJECTED" })).rejects.toThrow("SUGGESTION_NOT_REVIEWABLE");
    expect(await approved.read()).toMatchObject({ status: "APPROVED", approvedPlaceId: approved.input.suggestionId });
    expect(await approved.audit()).toHaveLength(1);

    const rejected = await decisionFixture();
    const decision = { ...rejected.input, status: "REJECTED" as const };
    await transitionPlaceSuggestion(rejected.db, decision);
    await expect(transitionPlaceSuggestion(rejected.db, { ...decision, status: "NEEDS_INFO" })).rejects.toThrow("SUGGESTION_NOT_REVIEWABLE");
    await expect(transitionPlaceSuggestion(rejected.db, { ...decision, suggestionId: "missing-suggestion" })).rejects.toThrow("SUGGESTION_NOT_REVIEWABLE");
    expect(await rejected.read()).toMatchObject({ status: "REJECTED", approvedPlaceId: null });
    const [audit] = await rejected.audit();
    expect(audit).toMatchObject({ actorUserId: decision.actorUserId, action: "TRANSITION_PLACE_SUGGESTION", targetType: "PLACE_SUGGESTION", createdAt: decision.now });
    expect(JSON.parse(audit!.beforeState!)).toMatchObject({ status: "SUBMITTED", reviewReason: null });
    expect(JSON.parse(audit!.afterState!)).toMatchObject({ status: "REJECTED", reviewReason: decision.reason });
  });

  it("rejects old forms after a same-timestamp decision and reports an exact no-op", async () => {
    const f = await decisionFixture();
    const initialRevision = (await f.current()).decisionRevision;
    const first = { ...f.input, expectedRevision: initialRevision, status: "NEEDS_INFO" as const };
    await transitionPlaceSuggestion(f.db, first);
    const memoRevision = (await f.current()).decisionRevision;
    expect(memoRevision).not.toBe(initialRevision);
    expect(await f.read()).toMatchObject({ updatedAt: f.input.now });
    await expect(transitionPlaceSuggestion(f.db, { ...first, actorUserId: f.otherAdmin, reason: "다른 운영자의 확인" })).rejects.toThrow("SUGGESTION_STALE");
    await expect(approvePlaceSuggestion(f.db, { ...f.input, expectedRevision: initialRevision })).rejects.toThrow("SUGGESTION_STALE");
    await expect(transitionPlaceSuggestion(f.db, { ...first, expectedRevision: memoRevision })).rejects.toThrow("SUGGESTION_UNCHANGED");
    expect(await f.audit()).toHaveLength(1);
    expect(await f.read()).toMatchObject({ status: "NEEDS_INFO", reviewReason: first.reason, reviewedBy: first.actorUserId });
  });

  it("keeps the single approved draft and audit when approval commits before rejection", async () => {
    const f = await decisionFixture();
    const revision = (await f.current()).decisionRevision;
    const originalBatch = f.db.batch.bind(f.db);
    const batch = vi.spyOn(f.db, "batch").mockImplementationOnce(async (...statements) => {
      await approvePlaceSuggestion(f.db, { ...f.input, actorUserId: f.otherAdmin, expectedRevision: revision });
      return originalBatch(...statements);
    });
    try {
      await expect(transitionPlaceSuggestion(f.db, { ...f.input, status: "REJECTED", expectedRevision: revision })).rejects.toThrow("SUGGESTION_STALE");
    } finally {
      batch.mockRestore();
    }
    expect(await f.read()).toMatchObject({ status: "APPROVED", reviewedBy: f.otherAdmin, approvedPlaceId: f.input.suggestionId });
    expect(await f.db.query.places.findFirst({ where: eq(places.id, f.input.suggestionId) })).toMatchObject({ status: "DRAFT" });
    expect((await f.audit()).map((row) => row.action)).toEqual(["APPROVE_PLACE_SUGGESTION"]);
  });

  it("rolls back a decision if its audit insert is skipped", async () => {
    const f = await decisionFixture();
    await env.DB.exec("CREATE TRIGGER test_skip_suggestion_audit BEFORE INSERT ON admin_audit_logs WHEN NEW.target_type='PLACE_SUGGESTION' BEGIN SELECT RAISE(IGNORE); END;");
    try {
      await expect(transitionPlaceSuggestion(f.db, { ...f.input, status: "NEEDS_INFO" })).rejects.toThrow("SUGGESTION_STALE");
      await expect(approvePlaceSuggestion(f.db, f.input)).rejects.toThrow("SUGGESTION_STALE");
    } finally {
      await env.DB.exec("DROP TRIGGER test_skip_suggestion_audit");
    }
    expect(await f.read()).toMatchObject({ status: "SUBMITTED", reviewReason: null, approvedPlaceId: null });
    expect(await f.db.query.places.findFirst({ where: eq(places.id, f.input.suggestionId) })).toBeUndefined();
    expect(await f.db.query.placeRevisions.findFirst({ where: eq(placeRevisions.placeId, f.input.suggestionId) })).toBeUndefined();
    expect(await f.audit()).toHaveLength(0);
  });
  it("requires verified email and explicit duplicate override", async () => {
    const db = createDb(env.DB); const prefix = `suggest-${crypto.randomUUID()}`; const now = "2026-08-06T10:00:00.000Z";
    const category = await db.query.categories.findFirst(); if (!category) throw new Error("category fixture missing");
    await db.insert(users).values({ id: `${prefix}-user`, email: `${prefix}@example.com`, displayName: "제안자", role: "USER", createdAt: now, updatedAt: now });
    await expect(submitPlaceSuggestion(db, { id: `${prefix}-unverified`, userId: `${prefix}-user`, name: "신규식당", address: "광주 동구 동명로 1", neighborhood: "동명동", originLatitude: 35.15, originLongitude: 126.92, latitude: 35.15, longitude: 126.92, phone: null, categoryId: category.id, description: null, duplicateOverrideReason: null, now })).rejects.toThrow("EMAIL_VERIFICATION_REQUIRED");
    await db.update(users).set({ emailVerifiedAt: now }).where((await import("drizzle-orm")).eq(users.id, `${prefix}-user`));
    await db.insert(places).values({ id: `${prefix}-place`, slug: `${prefix}-place`, name: "신규 식당", status: "PUBLISHED", address: "광주 동구 동명로 1", neighborhood: "동명동", latitude: 35.15, longitude: 126.92, phone: "062-111-2222", searchText: "신규 식당", createdAt: now, updatedAt: now });
    const input = { id: `${prefix}-suggestion`, userId: `${prefix}-user`, name: "신규식당 본점", address: "광주 동구 동명로 1", neighborhood: "동명동", originLatitude: 35.1501, originLongitude: 126.9201, latitude: 35.1501, longitude: 126.9201, phone: "0621112222", categoryId: category.id, description: "새 지점", duplicateOverrideReason: null, now };
    await expect(submitPlaceSuggestion(db, input)).rejects.toThrow("DUPLICATE_CONFIRMATION_REQUIRED");
    const result = await submitPlaceSuggestion(db, { ...input, duplicateOverrideReason: "동일 건물의 별도 사업장" });
    expect(result.duplicates[0]?.level).toBe("HIGH");
    expect((await db.select().from(placeDuplicateCandidates)).some((item) => item.suggestionId === input.id)).toBe(true);
  });

  it("requires a verified Gwangju or Jeonnam location and preserves its numeric coordinate", async () => {
    const db = createDb(env.DB); const prefix = `location-${crypto.randomUUID()}`; const now = "2026-08-14T10:00:00.000Z";
    const category = await db.query.categories.findFirst(); if (!category) throw new Error("category fixture missing");
    await db.insert(users).values({ id: `${prefix}-user`, email: `${prefix}@example.com`, displayName: "제안자", role: "USER", emailVerifiedAt: now, createdAt: now, updatedAt: now });
    const input = {
      id: `${prefix}-suggestion`, userId: `${prefix}-user`, name: "새 위치 식당", address: "광주광역시 동구 서석로 1", neighborhood: "서석동",
      originLatitude: 35.146, originLongitude: 126.923, latitude: 35.146, longitude: 126.923, phone: null, categoryId: category.id, description: null, duplicateOverrideReason: null, now,
    };

    await expect(submitPlaceSuggestion(db, { ...input, id: `${prefix}-missing`, latitude: null as unknown as number }))
      .rejects.toThrow("LOCATION_REQUIRED");
    await expect(submitPlaceSuggestion(db, { ...input, id: `${prefix}-invalid`, latitude: Number.NaN }))
      .rejects.toThrow("LOCATION_OUT_OF_SCOPE");
    await expect(submitPlaceSuggestion(db, { ...input, id: `${prefix}-outside`, address: "서울특별시 종로구 세종대로 1" }))
      .rejects.toThrow("LOCATION_OUT_OF_SCOPE");

    await submitPlaceSuggestion(db, input);
    const saved = await db.query.placeSuggestions.findFirst({ where: (table, { eq }) => eq(table.id, input.id) });
    expect(saved).toMatchObject({
      address: "광주광역시 동구 서석로 1",
      latitude: 35.146,
      longitude: 126.923,
    });

    const legacyId = `${prefix}-legacy-gwangju`;
    await submitPlaceSuggestion(db, {
      ...input,
      id: legacyId,
      name: "축약 주소 식당",
      address: "전남광주 북구 용봉동 1403-1",
      neighborhood: "용봉동",
      duplicateOverrideReason: "축약 주소 정규화 회귀 테스트용 별도 제안",
    });
    expect(await db.query.placeSuggestions.findFirst({ where: (table, { eq }) => eq(table.id, legacyId) }))
      .toMatchObject({ address: "광주광역시 북구 용봉동 1403-1" });
  });

  it("rejects a confirmed pin more than 2km away from the searched address", async () => {
    const db = createDb(env.DB); const prefix = `location-distance-${crypto.randomUUID()}`; const now = "2026-08-14T10:00:00.000Z";
    const category = await db.query.categories.findFirst(); if (!category) throw new Error("category fixture missing");
    await db.insert(users).values({ id: `${prefix}-user`, email: `${prefix}@example.com`, displayName: "제안자", role: "USER", emailVerifiedAt: now, createdAt: now, updatedAt: now });

    await expect(submitPlaceSuggestion(db, {
      id: `${prefix}-suggestion`, userId: `${prefix}-user`, name: "먼 위치 식당", address: "광주광역시 동구 서석로 1", neighborhood: "서석동",
      originLatitude: 35.146, originLongitude: 126.923,
      latitude: 35.1815, longitude: 126.923, phone: null, categoryId: category.id, description: null, duplicateOverrideReason: null, now,
    })).rejects.toThrow("LOCATION_TOO_FAR_FROM_ADDRESS");
  });

  it("approves into a draft place with revision and reviewer qualification count", async () => {
    const db = createDb(env.DB); const prefix = `approve-${crypto.randomUUID()}`; const now = "2026-08-06T10:00:00.000Z";
    const category = await db.query.categories.findFirst(); if (!category) throw new Error("category fixture missing");
    await db.insert(users).values([
      { id: `${prefix}-user`, email: `${prefix}-user@example.com`, displayName: "제안자", role: "USER", emailVerifiedAt: now, createdAt: now, updatedAt: now },
      { id: `${prefix}-admin`, email: `${prefix}-admin@example.com`, displayName: "관리자", role: "ADMIN", emailVerifiedAt: now, createdAt: now, updatedAt: now },
    ]);
    await db.insert(reviewerApplications).values({ id: `${prefix}-application`, userId: `${prefix}-user`, status: "APPLIED", statement: "기준 설명입니다 충분합니다", occupation: "기록자", tasteDirection: "지역 음식", regionCode: "GWANGJU", specialtySlugs: "[]", approvedSuggestionCount: 0, createdAt: now, updatedAt: now });
    await submitPlaceSuggestion(db, { id: `${prefix}-suggestion`, userId: `${prefix}-user`, name: "승인 식당", address: "광주 동구 승인로 2", neighborhood: "동명동", originLatitude: 35.16, originLongitude: 126.93, latitude: 35.16, longitude: 126.93, phone: null, categoryId: category.id, description: "추천", duplicateOverrideReason: null, now });
    const confirmedLocation = {
      address: "광주광역시 동구 동명로 10",
      neighborhood: "동명동",
      latitude: 35.152,
      longitude: 126.924,
    };
    const result = await approvePlaceSuggestion(db, {
      suggestionId: `${prefix}-suggestion`,
      actorUserId: `${prefix}-admin`,
      reason: "정보 확인",
      now,
      ...confirmedLocation,
    });
    expect(result.status).toBe("DRAFT");
    expect((await db.select().from(places)).find((item) => item.id === result.placeId)).toMatchObject({
      status: "DRAFT",
      ...confirmedLocation,
    });
    expect((await db.select().from(placeCategories)).some((item) => item.placeId === result.placeId && item.isPrimary)).toBe(true);
    expect((await db.select().from(placeSuggestions)).find((item) => item.id === `${prefix}-suggestion`)).toMatchObject({
      status: "APPROVED",
      ...confirmedLocation,
    });
    expect((await db.select().from(placeRevisions)).some((item) => item.placeId === result.placeId && item.action === "CREATE_FROM_SUGGESTION")).toBe(true);
    expect((await db.select().from(placeReviewWorkItems)).find((item) => item.placeId === result.placeId)).toMatchObject({
      sourceKind: "PLACE_SUGGESTION", stage: "SOURCE_REVIEW", status: "ACTIVE",
    });
    expect((await db.select().from(reviewerApplications)).find((item) => item.id === `${prefix}-application`)?.approvedSuggestionCount).toBe(1);
  });

  it("accepts concurrent approval retries only once and returns the same draft", async () => {
    const db = createDb(env.DB); const prefix = `approve-race-${crypto.randomUUID()}`; const now = "2026-08-14T10:00:00.000Z";
    const category = await db.query.categories.findFirst(); if (!category) throw new Error("category fixture missing");
    await db.insert(users).values([
      { id: `${prefix}-user`, email: `${prefix}-user@example.com`, displayName: "제안자", role: "USER", emailVerifiedAt: now, createdAt: now, updatedAt: now },
      { id: `${prefix}-admin`, email: `${prefix}-admin@example.com`, displayName: "관리자", role: "ADMIN", emailVerifiedAt: now, createdAt: now, updatedAt: now },
    ]);
    await db.insert(reviewerApplications).values({ id: `${prefix}-application`, userId: `${prefix}-user`, status: "APPLIED", statement: "기준 설명입니다 충분합니다", occupation: "기록자", tasteDirection: "지역 음식", regionCode: "GWANGJU", specialtySlugs: "[]", approvedSuggestionCount: 0, createdAt: now, updatedAt: now });
    await submitPlaceSuggestion(db, { id: `${prefix}-suggestion`, userId: `${prefix}-user`, name: "동시 승인 식당", address: "광주 동구 승인로 3", neighborhood: "동명동", originLatitude: 35.16, originLongitude: 126.93, latitude: 35.16, longitude: 126.93, phone: null, categoryId: category.id, description: "추천", duplicateOverrideReason: "동시 승인 회귀 테스트용 별도 제안", now });

    const results = await Promise.all([
      approvePlaceSuggestion(db, { suggestionId: `${prefix}-suggestion`, actorUserId: `${prefix}-admin`, reason: "정보 확인", now }),
      approvePlaceSuggestion(db, { suggestionId: `${prefix}-suggestion`, actorUserId: `${prefix}-admin`, reason: "정보 확인", now }),
    ]);

    expect(new Set(results.map((item) => item.placeId))).toEqual(new Set([`${prefix}-suggestion`]));
    expect((await db.select().from(places)).filter((item) => item.id === `${prefix}-suggestion`)).toHaveLength(1);
    expect((await db.select().from(placeCategories)).filter((item) => item.placeId === `${prefix}-suggestion`)).toHaveLength(1);
    expect((await db.select().from(placeRevisions)).filter((item) => item.placeId === `${prefix}-suggestion` && item.action === "CREATE_FROM_SUGGESTION")).toHaveLength(1);
    expect((await db.select().from(placeSuggestions)).find((item) => item.id === `${prefix}-suggestion`)).toMatchObject({ status: "APPROVED", approvedPlaceId: `${prefix}-suggestion` });
    expect((await db.select().from(reviewerApplications)).find((item) => item.id === `${prefix}-application`)?.approvedSuggestionCount).toBe(1);
    await expect(approvePlaceSuggestion(db, { suggestionId: `${prefix}-suggestion`, actorUserId: `${prefix}-admin`, reason: "정보 확인", now }))
      .resolves.toMatchObject({ placeId: `${prefix}-suggestion`, status: "DRAFT", replayed: true });
    await expect(approvePlaceSuggestion(db, { suggestionId: `${prefix}-suggestion`, actorUserId: `${prefix}-admin`, reason: "다른 승인 근거", now }))
      .rejects.toThrow("SUGGESTION_NOT_REVIEWABLE");
  });

  it("returns the committed draft when D1 loses only the approval response", async () => {
    const db = createDb(env.DB); const prefix = `approve-response-lost-${crypto.randomUUID()}`; const now = "2026-08-14T10:00:00.000Z";
    const category = await db.query.categories.findFirst(); if (!category) throw new Error("category fixture missing");
    await db.insert(users).values([
      { id: `${prefix}-user`, email: `${prefix}-user@example.com`, displayName: "제안자", role: "USER", emailVerifiedAt: now, createdAt: now, updatedAt: now },
      { id: `${prefix}-admin`, email: `${prefix}-admin@example.com`, displayName: "관리자", role: "ADMIN", emailVerifiedAt: now, createdAt: now, updatedAt: now },
    ]);
    await submitPlaceSuggestion(db, { id: `${prefix}-suggestion`, userId: `${prefix}-user`, name: "응답 유실 식당", address: "광주 동구 응답로 4", neighborhood: "동명동", originLatitude: 35.16, originLongitude: 126.93, latitude: 35.16, longitude: 126.93, phone: null, categoryId: category.id, description: "추천", duplicateOverrideReason: "응답 유실 회귀 테스트용 별도 제안", now });

    const originalBatch = db.batch.bind(db);
    const batch = vi.spyOn(db, "batch").mockImplementationOnce(async (...statements) => {
      await originalBatch(...statements);
      throw new Error("D1_RESPONSE_LOST");
    });
    try {
      await expect(approvePlaceSuggestion(db, { suggestionId: `${prefix}-suggestion`, actorUserId: `${prefix}-admin`, reason: "정보 확인", now }))
        .resolves.toMatchObject({ placeId: `${prefix}-suggestion`, status: "DRAFT", replayed: true });
    } finally {
      batch.mockRestore();
    }

    expect((await db.select().from(places)).filter((item) => item.id === `${prefix}-suggestion`)).toHaveLength(1);
    expect((await db.select().from(placeSuggestions)).find((item) => item.id === `${prefix}-suggestion`)).toMatchObject({ status: "APPROVED", approvedPlaceId: `${prefix}-suggestion` });
  });

  it("rolls back every approval write when a revision cannot be recorded", async () => {
    const db = createDb(env.DB); const prefix = `approve-rollback-${crypto.randomUUID()}`; const now = "2026-08-14T10:00:00.000Z";
    const category = await db.query.categories.findFirst(); if (!category) throw new Error("category fixture missing");
    await db.insert(users).values([
      { id: `${prefix}-user`, email: `${prefix}-user@example.com`, displayName: "제안자", role: "USER", emailVerifiedAt: now, createdAt: now, updatedAt: now },
      { id: `${prefix}-admin`, email: `${prefix}-admin@example.com`, displayName: "관리자", role: "ADMIN", emailVerifiedAt: now, createdAt: now, updatedAt: now },
    ]);
    await submitPlaceSuggestion(db, { id: `${prefix}-suggestion`, userId: `${prefix}-user`, name: "롤백 식당", address: "광주 동구 롤백로 5", neighborhood: "동명동", originLatitude: 35.16, originLongitude: 126.93, latitude: 35.16, longitude: 126.93, phone: null, categoryId: category.id, description: "추천", duplicateOverrideReason: "롤백 회귀 테스트용 별도 제안", now });
    const triggerName = `reject_suggestion_revision_${crypto.randomUUID().replaceAll("-", "")}`;
    await env.DB.exec(`CREATE TRIGGER ${triggerName} BEFORE INSERT ON place_revisions WHEN NEW.action = 'CREATE_FROM_SUGGESTION' BEGIN SELECT RAISE(ABORT, 'revision rejected'); END`);

    try {
      await expect(approvePlaceSuggestion(db, { suggestionId: `${prefix}-suggestion`, actorUserId: `${prefix}-admin`, reason: "정보 확인", now })).rejects.toThrow("revision rejected");
    } finally {
      await env.DB.exec(`DROP TRIGGER IF EXISTS ${triggerName}`);
    }

    expect((await db.select().from(places)).filter((item) => item.id === `${prefix}-suggestion`)).toHaveLength(0);
    expect((await db.select().from(placeCategories)).filter((item) => item.placeId === `${prefix}-suggestion`)).toHaveLength(0);
    expect((await db.select().from(placeRevisions)).filter((item) => item.placeId === `${prefix}-suggestion`)).toHaveLength(0);
    expect((await db.select().from(placeSuggestions)).find((item) => item.id === `${prefix}-suggestion`)).toMatchObject({ status: "SUBMITTED", approvedPlaceId: null });
  });

  it("lists only reviewable suggestions without submitter identity", async () => {
    const db = createDb(env.DB); const prefix = `list-${crypto.randomUUID()}`; const now = "2026-08-17T04:00:00.000Z";
    const category = await db.query.categories.findFirst(); if (!category) throw new Error("category fixture missing");
    await db.insert(users).values([
      { id: `${prefix}-user`, email: `${prefix}-user@example.com`, displayName: "제안자", role: "USER", emailVerifiedAt: now, createdAt: now, updatedAt: now },
      { id: `${prefix}-admin`, email: `${prefix}-admin@example.com`, displayName: "관리자", role: "ADMIN", emailVerifiedAt: now, createdAt: now, updatedAt: now },
    ]);
    await submitPlaceSuggestion(db, { id: `${prefix}-open`, userId: `${prefix}-user`, name: "목록 식당", address: "광주 동구 목록로 1", neighborhood: "동명동", originLatitude: 35.16, originLongitude: 126.93, latitude: 35.16, longitude: 126.93, phone: "062-000-0000", categoryId: category.id, description: "목록", duplicateOverrideReason: "목록 회귀 테스트용 별도 제안", now });
    await submitPlaceSuggestion(db, { id: `${prefix}-done`, userId: `${prefix}-user`, name: "승인될 식당", address: "광주 동구 목록로 2", neighborhood: "동명동", originLatitude: 35.161, originLongitude: 126.931, latitude: 35.161, longitude: 126.931, phone: null, categoryId: category.id, description: null, duplicateOverrideReason: "목록 회귀 테스트용 별도 제안 2", now });
    await approvePlaceSuggestion(db, { suggestionId: `${prefix}-done`, actorUserId: `${prefix}-admin`, reason: "정보 확인", now });

    const listed = await listReviewablePlaceSuggestions(db);
    const open = listed.rows.find((item) => item.id === `${prefix}-open`);
    const done = listed.rows.find((item) => item.id === `${prefix}-done`);

    expect(open).toMatchObject({ status: "SUBMITTED", name: "목록 식당" });
    expect(done).toBeUndefined();
    expect(open && "userId" in open).toBe(false);
    expect(open && "phone" in open).toBe(false);
  });
});
