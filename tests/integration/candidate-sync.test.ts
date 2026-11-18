import { env } from "cloudflare:workers";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createDb } from "../../app/db/client.server";
import { businessLicenses, placeReviewWorkItems, places, publicDataSyncRuns } from "../../app/db/schema";
import { listExcludedCandidates, listPendingCandidates } from "../../app/features/candidates/candidate.server";
import { syncPublicDataBatch } from "../../app/features/candidates/sync.server";

beforeEach(async () => { await env.DB.prepare("DELETE FROM public_data_sync_runs").run(); });

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
    await expect(db.query.publicDataSyncRuns.findFirst({ where: eq(publicDataSyncRuns.id, runId) })).resolves.toMatchObject({ status: "PENDING", fetchedCount: 401 });
  });
  it("retries a 5xx page response and only fails after the bounded attempts", async () => {
    const db = createDb(env.DB);
    const fetcher = vi.fn(async () => new Response("timeout", { status: 504 }));
    await expect(syncPublicDataBatch(db, { serviceKey: "key", sourceType: "ENTERTAINMENT_BAR", addressField: "ROAD_NM_ADDR", fetcher: fetcher as typeof fetch, maxPages: 1, now: "2026-08-05T12:00:00.000Z" })).rejects.toThrow("PUBLIC_DATA_HTTP_504");
    expect(fetcher).toHaveBeenCalledTimes(3);
  });
});


describe("public sync execution ownership", () => {
  it("does not issue a second request while the same source has an active owner", async () => {
    const db = createDb(env.DB);
    let release!: () => void;
    let entered!: () => void;
    const started = new Promise<void>((resolve) => { entered = resolve; });
    const blocked = new Promise<void>((resolve) => { release = resolve; });
    const fetcher = vi.fn(async () => {
      entered(); await blocked;
      return Response.json({ response: { header: { resultCode: "0" }, body: { totalCount: 0, items: { item: [] } } } });
    });
    const input = { serviceKey: "test", sourceType: "REST_CAFE" as const, addressField: "ROAD_NM_ADDR" as const, maxPages: 1, fetcher: fetcher as typeof fetch };
    const first = syncPublicDataBatch(db, input);
    await started;
    const second = syncPublicDataBatch(db, input);
    await new Promise((resolve) => setTimeout(resolve, 20));
    release(); await Promise.all([first, second]);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});

function publicPage(items: Record<string, unknown>[], totalCount = items.length) {
  return Response.json({ response: { header: { resultCode: "0" }, body: { totalCount, items: { item: items } } } });
}
function license(no: string, name = "동기화 확인 식당") {
  return { MNG_NO: no, BPLC_NM: name, ROAD_NM_ADDR: "전남광주통합특별시 동구 확인로 1", SALS_STTS_CD: "01", SALS_STTS_NM: "영업/정상", DTL_SALS_STTS_CD: "01", DTL_SALS_STTS_NM: "영업" };
}

describe("public sync fenced pages", () => {
  it("updates the same source in a distinct completed run without duplicating its review or place", async () => {
    const db = createDb(env.DB), no = `repeat-source-${crypto.randomUUID()}`;
    const firstAt = "2026-11-17T01:00:00.000Z", secondAt = "2026-11-18T01:00:00.000Z";
    const placeCount = (await db.select().from(places)).length;
    const first = await syncPublicDataBatch(db, {
      serviceKey: "test", sourceType: "GENERAL_RESTAURANT", addressField: "ROAD_NM_ADDR", now: firstAt,
      fetcher: async () => publicPage([{ ...license(no), LAST_MDFCN_PNT: "2026-11-16" }]),
    });
    const source = await db.query.businessLicenses.findFirst({ where: eq(businessLicenses.sourceManagementNo, no) });
    expect(source).toMatchObject({ sourceType: "GENERAL_RESTAURANT", firstSeenAt: firstAt, lastSeenAt: firstAt, sourceUpdatedAt: "2026-11-16" });
    const originalReview = await db.query.placeReviewWorkItems.findFirst({ where: eq(placeReviewWorkItems.businessLicenseId, source!.id) });
    expect(originalReview).toMatchObject({ status: "ACTIVE", stage: "SOURCE_REVIEW", stageVersion: 0 });
    expect(first.run).toMatchObject({ status: "COMPLETED", fetchedCount: 1, insertedCount: 1, updatedCount: 0 });

    const second = await syncPublicDataBatch(db, {
      serviceKey: "test", sourceType: "GENERAL_RESTAURANT", addressField: "ROAD_NM_ADDR", now: secondAt,
      fetcher: async () => publicPage([{ ...license(no, "재확인한 동기화 식당"), LAST_MDFCN_PNT: "2026-11-17" }]),
    });

    expect(second.runId).not.toBe(first.runId);
    expect(second.run).toMatchObject({ status: "COMPLETED", fetchedCount: 1, insertedCount: 0, updatedCount: 1 });
    expect(await db.query.publicDataSyncRuns.findFirst({ where: eq(publicDataSyncRuns.id, first.runId) })).toMatchObject({ status: "COMPLETED", fetchedCount: 1, insertedCount: 1, updatedCount: 0, finishedAt: firstAt });
    expect(await db.select().from(businessLicenses).where(eq(businessLicenses.sourceManagementNo, no))).toEqual([
      expect.objectContaining({ id: source!.id, businessName: "재확인한 동기화 식당", firstSeenAt: firstAt, createdAt: firstAt, lastSeenAt: secondAt, sourceUpdatedAt: "2026-11-17", updatedAt: secondAt }),
    ]);
    expect(await db.select().from(placeReviewWorkItems).where(eq(placeReviewWorkItems.businessLicenseId, source!.id))).toEqual([originalReview]);
    expect((await db.select().from(places)).length).toBe(placeCount);
  });

  it("rejects unsupported scope before creating a run or calling a provider", async () => {
    const fetcher = vi.fn();
    await expect(syncPublicDataBatch(createDb(env.DB), { serviceKey: "test", sourceType: "forged" as never, addressField: "ROAD_NM_ADDR", fetcher })).rejects.toThrow();
    expect(fetcher).not.toHaveBeenCalled();
    expect((await env.DB.prepare("SELECT count(*) n FROM public_data_sync_runs").first<{n:number}>())?.n).toBe(0);
  });

  it("rolls back every source row and counter when any write in a page fails", async () => {
    const db = createDb(env.DB), prefix = crypto.randomUUID();
    const items = [license(`${prefix}-ok`), license(`${prefix}-reject`, "rollback sentinel")];
    await env.DB.exec("CREATE TRIGGER sync_page_failure BEFORE INSERT ON business_licenses WHEN NEW.business_name='rollback sentinel' BEGIN SELECT RAISE(ABORT,'page sentinel'); END;");
    let run;
    try {
      await expect(syncPublicDataBatch(db, { serviceKey: "test", sourceType: "GENERAL_RESTAURANT", addressField: "ROAD_NM_ADDR", fetcher: async () => publicPage(items) })).rejects.toThrow("PUBLIC_DATA_SYNC_FAILED");
      run = await db.query.publicDataSyncRuns.findFirst();
      expect(run).toMatchObject({ status: "FAILED", nextPage: 1, fetchedCount: 0, insertedCount: 0, retryCount: 1 });
      expect((await env.DB.prepare("SELECT count(*) n FROM business_licenses WHERE source_management_no LIKE ?").bind(`${prefix}%`).first<{n:number}>())?.n).toBe(0);
    } finally { await env.DB.exec("DROP TRIGGER sync_page_failure"); }
    const result = await syncPublicDataBatch(db, { serviceKey: "test", sourceType: "GENERAL_RESTAURANT", addressField: "ROAD_NM_ADDR", runId: run!.id, fetcher: async () => publicPage(items) });
    expect(result.run).toMatchObject({ status: "COMPLETED", fetchedCount: 2, insertedCount: 2, attempts: 2 });
  });

  it("resumes the last uncommitted page and does not count the prior page twice", async () => {
    const db = createDb(env.DB), prefix = crypto.randomUUID();
    const first = vi.fn(async (input: RequestInfo | URL) => {
      if (new URL(String(input)).searchParams.get("pageNo") === "1") return publicPage([license(`${prefix}-one`)], 200);
      return new Response(null, { status: 503 });
    });
    await expect(syncPublicDataBatch(db, { serviceKey: "test", sourceType: "BAKERY", addressField: "ROAD_NM_ADDR", maxPages: 2, fetcher: first })).rejects.toThrow("PUBLIC_DATA_HTTP_503");
    const run = await db.query.publicDataSyncRuns.findFirst();
    expect(run).toMatchObject({ nextPage: 2, fetchedCount: 1, insertedCount: 1 });
    const next = vi.fn(async (input: RequestInfo | URL) => {
      expect(new URL(String(input)).searchParams.get("pageNo")).toBe("2");
      return publicPage([license(`${prefix}-two`)], 200);
    });
    const result = await syncPublicDataBatch(db, { serviceKey: "test", sourceType: "BAKERY", addressField: "ROAD_NM_ADDR", runId: run!.id, fetcher: next });
    expect(result.run).toMatchObject({ status: "COMPLETED", fetchedCount: 2, insertedCount: 2, requestCount: 5 });
  });

  it("fences a late page after a stale owner is replaced", async () => {
    const db = createDb(env.DB), no = crypto.randomUUID();
    let release!: () => void, enter!: () => void;
    const blocked = new Promise<void>(r => { release = r; }), entered = new Promise<void>(r => { enter = r; });
    const scope = { serviceKey: "test", sourceType: "REST_CAFE" as const, addressField: "LOTNO_ADDR" as const };
    const first = syncPublicDataBatch(db, { ...scope, now: "2026-08-05T12:00:00.000Z", fetcher: async () => { enter(); await blocked; return publicPage([license(no, "stale owner")]); } });
    await entered;
    const run = await db.query.publicDataSyncRuns.findFirst();
    const second = await syncPublicDataBatch(db, { ...scope, runId: run!.id, now: "2026-08-05T12:03:00.000Z", fetcher: async () => publicPage([license(no, "current owner")]) });
    release(); await first;
    expect(second.run).toMatchObject({ status: "COMPLETED", attempts: 2, retryCount: 1, fetchedCount: 1 });
    expect((await env.DB.prepare("SELECT business_name FROM business_licenses WHERE source_management_no=?").bind(no).first<{business_name:string}>())?.business_name).toBe("current owner");
  });

  it("stops after the bounded failed attempts without starting another run", async () => {
    const db = createDb(env.DB), fetcher = vi.fn(async () => new Response(null, {status:503}));
    const input = { serviceKey: "test", sourceType: "BAKERY" as const, addressField: "LOTNO_ADDR" as const, fetcher };
    for (let i=0;i<3;i++) await expect(syncPublicDataBatch(db,input)).rejects.toThrow("PUBLIC_DATA_HTTP_503");
    const result = await syncPublicDataBatch(db,input);
    expect(fetcher).toHaveBeenCalledTimes(9);
    expect(result.run).toMatchObject({ retryCount:3, attempts:3, canResume:false });
    expect((await env.DB.prepare("SELECT count(*) n FROM public_data_sync_runs").first<{n:number}>())?.n).toBe(1);
  });
});


it("commits a full hundred-row page without exceeding D1 binding limits", async()=>{
  const db=createDb(env.DB),prefix=crypto.randomUUID();
  const result=await syncPublicDataBatch(db,{serviceKey:"test",sourceType:"GENERAL_RESTAURANT",addressField:"ROAD_NM_ADDR",fetcher:async()=>publicPage(Array.from({length:100},(_,i)=>license(`${prefix}-${i}`)))});
  expect(result.run).toMatchObject({status:"COMPLETED",fetchedCount:100,insertedCount:100});
  expect((await env.DB.prepare("SELECT count(*) n FROM public_data_sync_guards").first<{n:number}>())?.n).toBe(0);
});
