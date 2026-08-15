import { env } from "cloudflare:workers";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createDb } from "../../app/db/client.server";
import { naverLocalCategoryRuns, naverLocalCategoryVerifications } from "../../app/db/schema";
import { upsertBusinessLicense } from "../../app/features/candidates/candidate.server";
import { verifyPendingCandidatesWithNaver } from "../../app/features/candidates/naver-pending-candidate-verification.server";
import { NaverLocalSearchError, type NaverLocalSearchAdapter } from "../../app/features/candidates/naver-local-search.server";

const now = "2026-08-15T02:00:00.000Z";

beforeEach(async () => {
  await env.DB.prepare("DELETE FROM naver_local_category_runs WHERE scope = 'PENDING'").run();
});

async function pendingCandidate(sourceManagementNo: string) {
  return upsertBusinessLicense(createDb(env.DB), {
    sourceType: "GENERAL_RESTAURANT",
    sourceManagementNo,
    businessName: "신 돼지세끼",
    businessSubtype: "식육(숯불구이)",
    salesStatusCode: "01",
    salesStatusName: "영업/정상",
    detailStatusCode: "01",
    detailStatusName: "영업",
    normalizedStatus: "OPEN",
    lotAddress: null,
    roadAddress: "광주광역시 서구 화정동 1",
    phone: null,
    sourceX: null,
    sourceY: null,
    latitude: 35.15,
    longitude: 126.92,
    regionCode: "GWANGJU",
    sourceUpdatedAt: now,
    rawPayload: "{}",
  }, now);
}

const exactAdapter = {
  search: vi.fn(async () => [{
    name: "신 돼지세끼",
    category: "음식점>육류,고기요리",
    address: "광주광역시 서구 화정동 1",
    latitude: 35.15,
    longitude: 126.92,
  }]),
} satisfies NaverLocalSearchAdapter;

describe("NAVER pending candidate verification", () => {
  it("persists only the safe evidence summary for a selected pending candidate", async () => {
    const candidate = await pendingCandidate(`naver-pending-${crypto.randomUUID()}`);

    await expect(verifyPendingCandidatesWithNaver(createDb(env.DB), {
      candidateIds: [candidate.id],
      limit: 25,
      now,
      adapter: exactAdapter,
      dailyLimit: 200,
    })).resolves.toMatchObject({ scanned: 1, verified: 1, automatic: 1, manual: 0, failed: 0, apiCalls: 1 });

    await expect(createDb(env.DB).query.naverLocalCategoryVerifications.findFirst({
      where: eq(naverLocalCategoryVerifications.businessLicenseId, candidate.id),
    })).resolves.toMatchObject({ status: "VERIFIED", confidenceScore: 80, failureCode: null });
  });

  it("stops the batch on an authentication or quota error", async () => {
    const candidate = await pendingCandidate(`naver-pending-stop-${crypto.randomUUID()}`);
    const adapter = { search: vi.fn(async () => { throw new NaverLocalSearchError("NAVER_LOCAL_SEARCH_QUOTA"); }) } satisfies NaverLocalSearchAdapter;

    await expect(verifyPendingCandidatesWithNaver(createDb(env.DB), {
      candidateIds: [candidate.id], limit: 25, now, adapter, dailyLimit: 200,
    })).rejects.toThrow("NAVER_LOCAL_SEARCH_QUOTA");
    expect(adapter.search).toHaveBeenCalledTimes(1);
    await expect(createDb(env.DB).query.naverLocalCategoryRuns.findFirst({
      where: eq(naverLocalCategoryRuns.errorCode, "NAVER_LOCAL_SEARCH_QUOTA"),
    })).resolves.toMatchObject({ scope: "PENDING", status: "FAILED" });
  });
});
