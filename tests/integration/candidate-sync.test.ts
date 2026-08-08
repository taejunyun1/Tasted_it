import { env } from "cloudflare:workers";
import { describe, expect, it, vi } from "vitest";
import { createDb } from "../../app/db/client.server";
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
});
