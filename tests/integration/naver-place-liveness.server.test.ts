import { env } from "cloudflare:workers";
import { eq } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";

import { createDb } from "../../app/db/client.server";
import { naverLocalCategoryRuns, placeLivenessStates, places } from "../../app/db/schema";
import { verifyPlacesLivenessWithNaver } from "../../app/features/places/naver-place-liveness.server";

const NOW = "2026-08-15T06:00:00.000Z";

describe("NAVER place liveness", () => {
  it("checks selected places, stores only NAVER evidence codes, and counts its API calls in the shared daily budget", async () => {
    const db = createDb(env.DB);
    const id = `naver-liveness-${crypto.randomUUID()}`;
    await db.insert(places).values({ id, slug: id, name: "파리바게뜨 동명점", status: "HIDDEN", address: "광주광역시 동구 동명로 1", neighborhood: "동명동", latitude: 35.15, longitude: 126.92, searchText: "파리바게뜨 동명점", createdAt: NOW, updatedAt: NOW });
    const adapter = { search: vi.fn(async () => [{ name: "파리바게뜨 동명점", category: "음식점>베이커리", address: "광주광역시 동구 동명로 1", latitude: 35.15, longitude: 126.92 }]) };

    await expect(verifyPlacesLivenessWithNaver(db, { placeIds: [id], now: NOW, dailyLimit: 200, adapter })).resolves.toMatchObject({ scanned: 1, matched: 1, apiCalls: 1 });
    expect(adapter.search).toHaveBeenCalledWith({ businessName: "파리바게뜨 동명점", address: "광주광역시 동구 동명로 1", regionCode: "GWANGJU" });
    expect(await db.query.placeLivenessStates.findFirst({ where: eq(placeLivenessStates.placeId, id) }))
      .toMatchObject({ naverStatus: "MATCHED", naverMatchScore: 60, naverEvidenceCodesJson: expect.stringContaining("NAVER_EXACT_NAME") });
    expect(await db.query.naverLocalCategoryRuns.findFirst({ where: eq(naverLocalCategoryRuns.scope, "PUBLISHED") }))
      .toMatchObject({ apiCallCount: 1, status: "COMPLETED" });
  });
});
