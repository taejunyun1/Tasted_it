import { env } from "cloudflare:workers";
import { describe, expect, it, vi } from "vitest";
import { createDb } from "../../app/db/client.server";
import { aiClassificationRuns, businessLicenses } from "../../app/db/schema";
import { classifyPendingCandidatesWithAi } from "../../app/features/candidates/ai-classification.server";

describe("Workers AI candidate classification", () => {
  it("stores validated output and reuses the 30-day input cache", async () => {
    const db = createDb(env.DB); const id = `ai-candidate-${crypto.randomUUID()}`; const now = "2026-08-06T10:00:00.000Z";
    await db.insert(businessLicenses).values({ id, sourceType: "GENERAL_RESTAURANT", sourceManagementNo: id, businessName: "테스트 라멘", businessSubtype: "일식", normalizedStatus: "OPEN", roadAddress: "광주광역시 동구 동명동", latitude: 35.1, longitude: 126.9, regionCode: "GWANGJU", rawPayload: "{}", reviewStatus: "PENDING", firstSeenAt: now, lastSeenAt: now, createdAt: now, updatedAt: now });
    const run = vi.fn().mockResolvedValue({ response: { categorySlug: "ramen-detail", confidence: 0.94, reasons: ["상호에 라멘"] }, usage: { prompt_tokens: 1_000, completion_tokens: 100 } });
    const first = await classifyPendingCandidatesWithAi(db, { run } as never, { candidateIds: [id], now });
    const second = await classifyPendingCandidatesWithAi(db, { run } as never, { candidateIds: [id], now: "2026-08-07T10:00:00.000Z" });
    expect(first).toMatchObject({ processed: 1, succeeded: 1, failed: 0, cached: 0 });
    expect(second).toMatchObject({ processed: 1, succeeded: 1, failed: 0, cached: 1 });
    expect(run).toHaveBeenCalledTimes(1);
    const rows = (await db.select().from(aiClassificationRuns)).filter((item) => item.candidateId === id);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ inputTokens: 1_000, outputTokens: 100, estimatedNeurons: 34, attemptCount: 1 });
    expect(rows[1]).toMatchObject({ estimatedNeurons: 0, cachedFromId: rows[0].id });
  });

  it("retries malformed JSON once and adds both attempts to usage", async () => {
    const db = createDb(env.DB); const id = `ai-retry-${crypto.randomUUID()}`; const now = "2026-08-08T10:00:00.000Z";
    await db.insert(businessLicenses).values({ id, sourceType: "GENERAL_RESTAURANT", sourceManagementNo: id, businessName: "재시도 라멘", businessSubtype: "일식", normalizedStatus: "OPEN", roadAddress: "광주광역시 동구", latitude: 35.1, longitude: 126.9, regionCode: "GWANGJU", rawPayload: "{}", reviewStatus: "PENDING", firstSeenAt: now, lastSeenAt: now, createdAt: now, updatedAt: now });
    const usage = { prompt_tokens: 100, completion_tokens: 10 };
    const run = vi.fn().mockResolvedValueOnce({ response: { nope: true }, usage }).mockResolvedValueOnce({ response: { categorySlug: "ramen-detail", confidence: 0.9, reasons: ["라멘"] }, usage });
    const result = await classifyPendingCandidatesWithAi(db, { run } as never, { candidateIds: [id], now });
    expect(result).toMatchObject({ processed: 1, succeeded: 1, failed: 0 });
    expect(run).toHaveBeenCalledTimes(2);
    const row = (await db.select().from(aiClassificationRuns)).find((item) => item.candidateId === id)!;
    expect(row).toMatchObject({ inputTokens: 200, outputTokens: 20, attemptCount: 2 });
  });

  it("does not call Workers AI after the daily 90 percent cutoff", async () => {
    const db = createDb(env.DB); const now = "2026-08-09T10:00:00.000Z"; const id = `quota-${crypto.randomUUID()}`;
    await db.insert(businessLicenses).values({ id, sourceType: "GENERAL_RESTAURANT", sourceManagementNo: id, businessName: "쿼터 테스트", normalizedStatus: "OPEN", regionCode: "GWANGJU", rawPayload: "{}", reviewStatus: "PENDING", firstSeenAt: now, lastSeenAt: now, createdAt: now, updatedAt: now });
    await db.insert(aiClassificationRuns).values({ id: crypto.randomUUID(), candidateId: id, inputHash: crypto.randomUUID(), model: "test", promptVersion: "test", status: "SUCCESS", estimatedNeurons: 9_000, createdAt: now });
    const run = vi.fn();
    const result = await classifyPendingCandidatesWithAi(db, { run } as never, { now });
    expect(result).toMatchObject({ processed: 0, limited: true, quota: { blocked: true } });
    expect(run).not.toHaveBeenCalled();
  });

  it("processes at most ten candidates in one Worker invocation", async () => {
    const db = createDb(env.DB); const now = "2026-08-10T10:00:00.000Z";
    const ids = Array.from({ length: 11 }, (_, index) => `batch-${index}-${crypto.randomUUID()}`);
    for (const [index, id] of ids.entries()) await db.insert(businessLicenses).values({ id, sourceType: "GENERAL_RESTAURANT", sourceManagementNo: id, businessName: `배치 라멘 ${index}`, businessSubtype: "일식", normalizedStatus: "OPEN", regionCode: "GWANGJU", rawPayload: "{}", reviewStatus: "PENDING", firstSeenAt: now, lastSeenAt: now, createdAt: now, updatedAt: now });
    const run = vi.fn().mockResolvedValue({ response: { categorySlug: "ramen-detail", confidence: 0.9, reasons: ["라멘"] }, usage: { prompt_tokens: 10, completion_tokens: 5 } });
    const result = await classifyPendingCandidatesWithAi(db, { run } as never, { candidateIds: ids, limit: 100, now });
    expect(result.processed).toBe(10);
    expect(run).toHaveBeenCalledTimes(10);
  });

  it("skips candidates that already have a successful AI result when advancing the queue", async () => {
    const db = createDb(env.DB); const now = "2026-08-11T10:00:00.000Z";
    const completedId = `completed-${crypto.randomUUID()}`; const pendingId = `pending-${crypto.randomUUID()}`;
    for (const id of [completedId, pendingId]) await db.insert(businessLicenses).values({ id, sourceType: "GENERAL_RESTAURANT", sourceManagementNo: id, businessName: `${id} 라멘`, businessSubtype: "일식", normalizedStatus: "OPEN", regionCode: "GWANGJU", rawPayload: "{}", reviewStatus: "PENDING", firstSeenAt: now, lastSeenAt: now, createdAt: now, updatedAt: "1999-01-01T00:00:00.000Z" });
    await db.insert(aiClassificationRuns).values({ id: crypto.randomUUID(), candidateId: completedId, inputHash: crypto.randomUUID(), model: "test", promptVersion: "test", status: "SUCCESS", categorySlug: "ramen-detail", confidence: 0.9, reasonsJson: '["완료"]', createdAt: now });
    const run = vi.fn().mockResolvedValue({ response: { categorySlug: "ramen-detail", confidence: 0.9, reasons: ["라멘"] }, usage: { prompt_tokens: 10, completion_tokens: 5 } });

    const result = await classifyPendingCandidatesWithAi(db, { run } as never, { limit: 10, now });

    expect(result.processed).toBeGreaterThanOrEqual(1);
    expect(run).toHaveBeenCalled();
    expect((await db.select().from(aiClassificationRuns)).filter((row) => row.candidateId === completedId)).toHaveLength(1);
    expect((await db.select().from(aiClassificationRuns)).some((row) => row.candidateId === pendingId && row.status === "SUCCESS")).toBe(true);
  });
});
