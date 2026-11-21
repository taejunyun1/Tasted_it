import { env } from "cloudflare:workers";
import { eq } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";

import { createDb } from "../../app/db/client.server";
import { naverLocalCategoryRuns, placeLivenessStates, places } from "../../app/db/schema";
import { verifyPlacesLivenessWithNaver } from "../../app/features/places/naver-place-liveness.server";

const NOW = "2026-08-15T06:00:00.000Z";

describe("NAVER place liveness", () => {
  it("checks selected places, stores only NAVER evidence codes, and counts its API calls in the region daily budget", async () => {
    const db = createDb(env.DB);
    const id = `naver-liveness-${crypto.randomUUID()}`;
    await db.insert(places).values({ id, slug: id, name: "파리바게뜨 동명점", status: "HIDDEN", address: "광주광역시 동구 동명로 1", neighborhood: "동명동", latitude: 35.15, longitude: 126.92, searchText: "파리바게뜨 동명점", createdAt: NOW, updatedAt: NOW });
    const adapter = { search: vi.fn(async () => [{ name: "파리바게뜨 동명점", category: "음식점>베이커리", address: "광주광역시 동구 동명로 1", latitude: 35.15, longitude: 126.92 }]) };

    const result = await verifyPlacesLivenessWithNaver(db, { placeIds: [id], now: NOW, dailyLimit: 200, adapter });
    expect(result).toMatchObject({ scanned: 1, matched: 1, apiCalls: 1 });
    expect(adapter.search).toHaveBeenCalledWith({ businessName: "파리바게뜨 동명점", address: "광주광역시 동구 동명로 1", regionCode: "GWANGJU" }, { source: "PLACE_LIVENESS", runId: result.runId });
    expect(await db.query.placeLivenessStates.findFirst({ where: eq(placeLivenessStates.placeId, id) }))
      .toMatchObject({ naverStatus: "MATCHED", naverMatchScore: 60, naverEvidenceCodesJson: expect.stringContaining("NAVER_EXACT_NAME") });
    expect(await db.query.naverLocalCategoryRuns.findFirst({ where: eq(naverLocalCategoryRuns.id, result.runId) }))
      .toMatchObject({ apiCallCount: 1, status: "COMPLETED", regionCode: "GWANGJU" });
  });

  it("lets Jeonnam continue after Gwangju exhausts its own daily budget", async () => {
    const db = createDb(env.DB);
    const now = "2026-08-17T06:00:00.000Z";
    await db.insert(naverLocalCategoryRuns).values({
      id: `naver-quota-gwangju-${crypto.randomUUID()}`,
      mode: "APPLY",
      scope: "PUBLISHED",
      status: "COMPLETED",
      requestedLimit: 1,
      apiCallCount: 200,
      regionCode: "GWANGJU",
      startedAt: "2026-08-17T01:00:00.000Z",
      finishedAt: "2026-08-17T01:01:00.000Z",
    });
    await env.DB.prepare("INSERT INTO provider_daily_quotas(provider,utc_day,legacy_total,legacy_gwangju,baseline_at,baseline_source,cutover_state,created_at,updated_at) VALUES ('NAVER_LOCAL_SEARCH','2026-08-17',200,200,?,'LEGACY_RUN_ESTIMATE','CLOSED_LEGACY_UNCERTAIN',?,?)").bind(now, now, now).run();
    const jeonnamId = `naver-liveness-jeonnam-${crypto.randomUUID()}`;
    const gwangjuId = `naver-liveness-gwangju-full-${crypto.randomUUID()}`;
    await db.insert(places).values([
      { id: jeonnamId, slug: jeonnamId, name: "목포 국밥", status: "HIDDEN", address: "전라남도 목포시 영산로 1", neighborhood: "목포시", latitude: 34.79, longitude: 126.39, searchText: "목포 국밥", createdAt: now, updatedAt: now },
      { id: gwangjuId, slug: gwangjuId, name: "동명 국밥", status: "HIDDEN", address: "광주광역시 동구 동명로 2", neighborhood: "동명동", latitude: 35.15, longitude: 126.92, searchText: "동명 국밥", createdAt: now, updatedAt: now },
    ]);
    const adapter = { search: vi.fn(async (input) => [{ name: input.businessName, category: "음식점>한식", address: input.address, latitude: 34.79, longitude: 126.39 }]) };

    await expect(verifyPlacesLivenessWithNaver(db, { placeIds: [jeonnamId], now, dailyLimit: 200, adapter })).resolves.toMatchObject({ scanned: 1, matched: 1, apiCalls: 1 });
    await expect(verifyPlacesLivenessWithNaver(db, { placeIds: [gwangjuId], now, dailyLimit: 200, adapter })).rejects.toThrow("NAVER_LOCAL_SEARCH_QUOTA");
    expect(adapter.search).toHaveBeenCalledTimes(1);
  });
});
