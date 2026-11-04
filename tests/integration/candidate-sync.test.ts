import { env } from "cloudflare:workers";
import { eq } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import { createDb } from "../../app/db/client.server";
import { publicDataSyncRuns } from "../../app/db/schema";
import { listExcludedCandidates, listPendingCandidates } from "../../app/features/candidates/candidate.server";
import { syncPublicDataBatch } from "../../app/features/candidates/sync.server";

describe("public data sync", () => {
  it("stores only open rows as visible review candidates", async () => {
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      expect(url.searchParams.get("cond[ROAD_NM_ADDR::LIKE]")).toBe("전남광주통합특별시%");
      return Response.json({ response: { header: { resultCode: "0", resultMsg: "정상" }, body: { totalCount: 3, items: { item: [
        { MNG_NO: "sync-open", BPLC_NM: "동기화 영업점", ROAD_NM_ADDR: "전남광주통합특별시 동구 테스트로 1", SALS_STTS_CD: "01", SALS_STTS_NM: "영업/정상", DTL_SALS_STTS_CD: "01", DTL_SALS_STTS_NM: "영업" },
        { MNG_NO: "sync-chain", BPLC_NM: "뚜레쥬르 동명점", ROAD_NM_ADDR: "전남광주통합특별시 동구 테스트로 3", SALS_STTS_CD: "01", SALS_STTS_NM: "영업/정상", DTL_SALS_STTS_CD: "01", DTL_SALS_STTS_NM: "영업" },
        { MNG_NO: "sync-closed", BPLC_NM: "동기화 폐업점", ROAD_NM_ADDR: "전남광주통합특별시 목포시 테스트로 2", SALS_STTS_CD: "03", SALS_STTS_NM: "폐업", DTL_SALS_STTS_CD: "02", DTL_SALS_STTS_NM: "폐업" },
      ] } } } });
    });
    const db = createDb(env.DB);
    const result = await syncPublicDataBatch(db, { serviceKey: "encoded%2Bkey%3D", sourceType: "GENERAL_RESTAURANT", addressField: "ROAD_NM_ADDR", fetcher: fetcher as typeof fetch, maxPages: 1, now: "2026-08-05T12:00:00.000Z" });
    expect(result).toMatchObject({ fetched: 3, excluded: 1 });
    expect((await listPendingCandidates(db)).map((item) => item.businessName)).toContain("동기화 영업점");
    expect((await listPendingCandidates(db)).map((item) => item.businessName)).not.toContain("뚜레쥬르 동명점");
    expect((await listExcludedCandidates(db)).map((item) => item.businessName)).toContain("뚜레쥬르 동명점");
    expect((await listPendingCandidates(db)).map((item) => item.businessName)).not.toContain("동기화 폐업점");
  });
  it("resumes a failed run at nextPage instead of restarting from page 1", async () => {
    const db = createDb(env.DB);
    const runId = crypto.randomUUID();
    const now = "2026-08-05T12:00:00.000Z";
    await db.insert(publicDataSyncRuns).values({
      id: runId, sourceType: "BAKERY", regionCode: "GWANGJU_JEONNAM", addressField: "LOTNO_ADDR",
      status: "FAILED", nextPage: 5, totalCount: 600, errorSummary: "PUBLIC_DATA_HTTP_504",
      fetchedCount: 400, insertedCount: 350, updatedCount: 0, skippedCount: 0,
      startedAt: now, finishedAt: now, createdAt: now, updatedAt: now,
    });
    const seenPages: number[] = [];
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      seenPages.push(Number(url.searchParams.get("pageNo")));
      return Response.json({ response: { header: { resultCode: "0", resultMsg: "정상" }, body: { totalCount: 600, items: { item: [
        { MNG_NO: `resume-${crypto.randomUUID()}`, BPLC_NM: "재개 제과점", LOTNO_ADDR: "전남광주통합특별시 동구 지번 2", SALS_STTS_CD: "01", SALS_STTS_NM: "영업/정상", DTL_SALS_STTS_CD: "01", DTL_SALS_STTS_NM: "영업" },
      ] } } } });
    });
    const result = await syncPublicDataBatch(db, { serviceKey: "key", sourceType: "BAKERY", addressField: "LOTNO_ADDR", fetcher: fetcher as typeof fetch, maxPages: 1, now });
    expect(result.runId).toBe(runId);
    expect(seenPages[0]).toBe(5);
    await expect(db.query.publicDataSyncRuns.findFirst({ where: eq(publicDataSyncRuns.id, runId) })).resolves.toMatchObject({ status: "RUNNING", fetchedCount: 401 });
  });
  it("retries a 5xx page response and only fails after the bounded attempts", async () => {
    const db = createDb(env.DB);
    const fetcher = vi.fn(async () => new Response("timeout", { status: 504 }));
    await expect(syncPublicDataBatch(db, { serviceKey: "key", sourceType: "ENTERTAINMENT_BAR", addressField: "ROAD_NM_ADDR", fetcher: fetcher as typeof fetch, maxPages: 1, now: "2026-08-05T12:00:00.000Z" })).rejects.toThrow("PUBLIC_DATA_HTTP_504");
    expect(fetcher).toHaveBeenCalledTimes(3);
  });
});
