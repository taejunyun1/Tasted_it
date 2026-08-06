import { env } from "cloudflare:workers";
import { describe, expect, it, vi } from "vitest";
import { createDb } from "../../app/db/client.server";
import { aiClassificationRuns, businessLicenses } from "../../app/db/schema";
import { classifyPendingCandidatesWithAi } from "../../app/features/candidates/ai-classification.server";

describe("Workers AI candidate classification", () => {
  it("stores validated output and reuses the 30-day input cache", async () => {
    const db = createDb(env.DB); const id = `ai-candidate-${crypto.randomUUID()}`; const now = "2026-08-06T10:00:00.000Z";
    await db.insert(businessLicenses).values({ id, sourceType: "GENERAL_RESTAURANT", sourceManagementNo: id, businessName: "테스트 라멘", businessSubtype: "일식", normalizedStatus: "OPEN", roadAddress: "광주광역시 동구 동명동", latitude: 35.1, longitude: 126.9, regionCode: "GWANGJU", rawPayload: "{}", reviewStatus: "PENDING", firstSeenAt: now, lastSeenAt: now, createdAt: now, updatedAt: now });
    const run = vi.fn().mockResolvedValue({ response: { categorySlug: "ramen-detail", confidence: 0.94, reasons: ["상호에 라멘"] } });
    const first = await classifyPendingCandidatesWithAi(db, { run } as never, { candidateIds: [id], now });
    const second = await classifyPendingCandidatesWithAi(db, { run } as never, { candidateIds: [id], now: "2026-08-07T10:00:00.000Z" });
    expect(first).toMatchObject({ processed: 1, succeeded: 1, failed: 0, cached: 0 });
    expect(second).toMatchObject({ processed: 1, succeeded: 1, failed: 0, cached: 1 });
    expect(run).toHaveBeenCalledTimes(1);
    expect((await db.select().from(aiClassificationRuns)).filter((item) => item.candidateId === id)).toHaveLength(2);
  });
});
