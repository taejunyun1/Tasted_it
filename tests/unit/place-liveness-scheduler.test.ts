import { describe, expect, it, vi } from "vitest";

import type { LivenessTarget, PlaceLivenessEvidence } from "../../app/features/places/place-liveness.server";
import { KakaoLocalError } from "../../app/features/places/kakao-local.server";
import { runScheduledPlaceMaintenance } from "../../app/features/places/scheduled-place.server";

const now = "2026-08-13T00:00:00.000Z";

function target(index = 0, overrides: Partial<LivenessTarget> = {}): LivenessTarget {
  return {
    placeId: `place-${index}`,
    place: { name: `Place ${index}`, address: "Address", latitude: 35.1, longitude: 126.9, phone: null, kakaoPlaceId: null },
    status: "MONITORING",
    recommendationExcluded: false,
    consecutiveNotFound: 0,
    firstNotFoundAt: null,
    lastCheckedAt: null,
    protectedUntil: null,
    placeUpdatedAt: now,
    leaseToken: "lease",
    ...overrides,
  };
}

const evidence: PlaceLivenessEvidence = {
  reviewerVisitReviewCount: 0,
  reviewerPhotoCount: 0,
  recentReviewerActivityAt: null,
  currentVoteCount: 0,
  savedPlaceCount: 0,
  recentMemberActivityAt: null,
  openBusinessLicenseCount: 0,
  recentOpenSourceAt: null,
};

function scheduler(targets: LivenessTarget[], search = vi.fn(async () => ({ documents: [] as never[] })), mode = "OBSERVE") {
  const apply = vi.fn(async () => "APPLIED" as const);
  const enqueueStale = vi.fn(async () => ({ scanned: 1, created: 1 }));
  return {
    apply,
    enqueueStale,
    search,
    run: () => runScheduledPlaceMaintenance({
      DB: {} as D1Database,
      KAKAO_PLACE_VERIFICATION_ENABLED: "true",
      KAKAO_PLACE_VERIFICATION_MODE: mode,
      KAKAO_REST_API_KEY: "test-key",
    } as Env, {
      now,
      dependencies: {
        createDb: () => ({}) as never,
        enqueueStale,
        claimDuePlaceLivenessTargets: vi.fn(async () => targets),
        loadPlaceLivenessEvidence: vi.fn(async () => evidence),
        applyPlaceLivenessDecision: apply,
        searchKakaoPlaces: search,
        log: vi.fn(),
      },
    }),
  };
}

describe("place liveness scheduler", () => {
  it("keeps stale revalidation running and makes zero Kakao requests when disabled", async () => {
    const search = vi.fn();
    const enqueueStale = vi.fn(async () => ({ scanned: 1, created: 1 }));
    const result = await runScheduledPlaceMaintenance({ DB: {} as D1Database } as Env, {
      now,
      dependencies: { createDb: () => ({}) as never, enqueueStale, searchKakaoPlaces: search },
    });

    expect(result).toEqual({ staleRevalidation: { scanned: 1, created: 1 }, liveness: { status: "DISABLED", claimed: 0, checked: 0, errors: 0, hidden: 0 } });
    expect(enqueueStale).toHaveBeenCalledOnce();
    expect(search).not.toHaveBeenCalled();
  });

  it("stores decisions by mode, excluding recommendations from the second not-found result and hiding only in HIDE mode", async () => {
    const secondNotFound = target(1, { consecutiveNotFound: 1, firstNotFoundAt: "2026-08-01T00:00:00.000Z", lastCheckedAt: "2026-08-06T00:00:00.000Z" });
    const thirdNotFound = target(2, { consecutiveNotFound: 2, firstNotFoundAt: "2026-07-01T00:00:00.000Z", lastCheckedAt: "2026-08-06T00:00:00.000Z" });
    const observe = scheduler([secondNotFound], undefined, "OBSERVE");
    await observe.run();
    expect(observe.apply.mock.calls[0]?.[1].decision).toMatchObject({ recommendationExcluded: false, shouldHide: false });

    const recommend = scheduler([secondNotFound], undefined, "RECOMMEND");
    await recommend.run();
    expect(recommend.apply.mock.calls[0]?.[1].decision).toMatchObject({ recommendationExcluded: true, shouldHide: false });

    const hide = scheduler([thirdNotFound], undefined, "HIDE");
    await hide.run();
    expect(hide.apply.mock.calls[0]?.[1].decision).toMatchObject({ recommendationExcluded: true, shouldHide: true });
  });

  it.each(["KAKAO_RATE_LIMITED", "KAKAO_SERVER_ERROR"])("retries %s once", async (code) => {
    const search = vi.fn()
      .mockRejectedValueOnce(new KakaoLocalError(code, true))
      .mockResolvedValueOnce({ documents: [] });
    const task = scheduler([target()], search);

    await expect(task.run()).resolves.toMatchObject({ staleRevalidation: { scanned: 1, created: 1 }, liveness: { checked: 1, errors: 0 } });
    expect(search).toHaveBeenCalledTimes(2);
  });

  it("stops remaining targets immediately when the first provider error makes the error rate one hundred percent", async () => {
    const rate = scheduler([target(1), target(2), target(3), target(4)], vi.fn(async () => {
      throw new KakaoLocalError("KAKAO_REQUEST_FAILED");
    }));
    await expect(rate.run()).resolves.toMatchObject({ liveness: { status: "STOPPED", checked: 1, errors: 1 } });
    expect(rate.search).toHaveBeenCalledOnce();
    expect(rate.apply).toHaveBeenCalledOnce();
  });

  it("does not hide a place during a provider-error-heavy run", async () => {
    const hideCandidate = target(1, { consecutiveNotFound: 2, firstNotFoundAt: "2026-07-01T00:00:00.000Z", lastCheckedAt: "2026-08-06T00:00:00.000Z" });
    const task = scheduler([hideCandidate, target(2), target(3)], vi.fn()
      .mockResolvedValueOnce({ documents: [] })
      .mockRejectedValueOnce(new KakaoLocalError("KAKAO_SERVER_ERROR", true))
      .mockRejectedValueOnce(new KakaoLocalError("KAKAO_SERVER_ERROR", true)), "HIDE");

    await expect(task.run()).resolves.toMatchObject({ liveness: { status: "STOPPED", hidden: 0, errors: 1 } });
    expect(task.apply.mock.calls.map((call) => call[1].decision.shouldHide)).not.toContain(true);
  });

  it("stops applying decisions after an apply failure", async () => {
    const task = scheduler([target(1), target(2)]);
    task.apply.mockRejectedValueOnce(new Error("apply failed"));

    await expect(task.run()).resolves.toMatchObject({ liveness: { status: "STOPPED", checked: 2, errors: 1, hidden: 0 } });
    expect(task.apply).toHaveBeenCalledOnce();
  });

  it("caps claims at 25 and Kakao requests at 50", async () => {
    const search = vi.fn(async () => ({ documents: [] }));
    const task = scheduler(Array.from({ length: 30 }, (_, index) => target(index)), search);

    await expect(task.run()).resolves.toMatchObject({ liveness: { claimed: 25, checked: 25, errors: 0 } });
    expect(task.search).toHaveBeenCalledTimes(25);
    expect(task.apply).toHaveBeenCalledTimes(25);
  });
});
