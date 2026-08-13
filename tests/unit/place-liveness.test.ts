import { describe, expect, it } from "vitest";

import { decidePlaceLiveness, type LivenessDecisionInput } from "../../app/features/places/place-liveness";

const now = "2026-08-12T00:00:00.000Z";
const baseInput: LivenessDecisionInput = {
  now,
  mode: "HIDE",
  currentStatus: "VERIFIED",
  currentRecommendationExcluded: false,
  consecutiveNotFound: 0,
  firstNotFoundAt: null,
  lastCheckedAt: null,
  protectedUntil: null,
  place: {
    kakaoPlaceId: null,
    name: "카페 봄 (동명점)",
    address: "광주광역시 동구 동명로 1",
    phone: "062-123-4567",
    latitude: 35.149,
    longitude: 126.923,
  },
  candidates: [],
  recentReviewerActivityAt: null,
  recentMemberActivityAt: null,
  recentOpenSourceAt: null,
};

const candidate = {
  id: "kakao-1",
  name: "카페봄",
  categoryGroupCode: "CE7",
  address: "광주광역시 동구 동명로 1",
  roadAddress: "광주광역시 동구 동명로 1",
  phone: "0621234567",
  latitude: 35.1495,
  longitude: 126.923,
};

describe("place liveness", () => {
  it.each([
    {
      name: "matches an identical Kakao ID immediately",
      input: { ...baseInput, place: { ...baseInput.place, kakaoPlaceId: "kakao-1" }, candidates: [{ ...candidate, name: "전혀 다른 상호", categoryGroupCode: "FD6" }] },
      expected: { kakaoStatus: "MATCHED", status: "VERIFIED", score: 100 },
    },
    {
      name: "matches an identical Kakao ID even for a non-food category",
      input: { ...baseInput, place: { ...baseInput.place, kakaoPlaceId: "kakao-1" }, candidates: [{ ...candidate, categoryGroupCode: "MT1" }] },
      expected: { kakaoStatus: "MATCHED", status: "VERIFIED", score: 100 },
    },
    {
      name: "matches an identical Kakao ID before tied candidate checks",
      input: { ...baseInput, place: { ...baseInput.place, kakaoPlaceId: "kakao-1" }, candidates: [{ ...candidate, id: "kakao-2" }, candidate] },
      expected: { kakaoStatus: "MATCHED", status: "VERIFIED", score: 100 },
    },
    {
      name: "combines name, address, distance, and phone scores",
      input: { ...baseInput, candidates: [candidate] },
      expected: { kakaoStatus: "MATCHED", status: "VERIFIED", score: 100 },
    },
    {
      name: "does not match a non-food category even with 100 points",
      input: { ...baseInput, candidates: [{ ...candidate, categoryGroupCode: "MT1" }] },
      expected: { kakaoStatus: "AMBIGUOUS", status: "MONITORING", score: 100 },
    },
    {
      name: "treats 50 to 69 points as ambiguous",
      input: { ...baseInput, candidates: [{ ...candidate, address: "다른 주소", roadAddress: "다른 주소", phone: null }] },
      expected: { kakaoStatus: "AMBIGUOUS", status: "MONITORING", score: 60 },
    },
    {
      name: "matches a food candidate with exactly 70 points",
      input: { ...baseInput, candidates: [{ ...candidate, phone: null, latitude: 35.2 }] },
      expected: { kakaoStatus: "MATCHED", status: "VERIFIED", score: 70 },
    },
    {
      name: "treats fewer than 50 points as not found",
      input: { ...baseInput, candidates: [{ ...candidate, address: "다른 주소", roadAddress: "다른 주소", phone: null, latitude: 35.2 }] },
      expected: { kakaoStatus: "NOT_FOUND", status: "MONITORING", score: 40 },
    },
    {
      name: "treats two equally strong candidates as ambiguous",
      input: { ...baseInput, candidates: [candidate, { ...candidate, id: "kakao-2" }] },
      expected: { kakaoStatus: "AMBIGUOUS", status: "MONITORING", score: 100 },
    },
    {
      name: "normalizes NFKC, whitespace, parentheses, and branch labels without merging distinct names",
      input: { ...baseInput, place: { ...baseInput.place, name: "\uFF23\uFF41\uFF46\uFF45 \uBD04 (\uB3D9\uBA85\uC810)" }, candidates: [{ ...candidate, name: "Cafe\uBD04 \uB3D9\uBA85\uC810" }] },
      expected: { kakaoStatus: "MATCHED", status: "VERIFIED", score: 100 },
    },
    {
      name: "normalizes a no-space branch suffix",
      input: { ...baseInput, place: { ...baseInput.place, name: "\uCE74\uD398\uBD04" }, candidates: [{ ...candidate, name: "\uCE74\uD398\uBD04\uB3D9\uBA85\uC810" }] },
      expected: { kakaoStatus: "MATCHED", status: "VERIFIED", score: 100 },
    },
  ])("$name", ({ input, expected }) => {
    const decision = decidePlaceLiveness(input);
    expect(decision).toMatchObject({ kakaoStatus: expected.kakaoStatus, status: expected.status });
    expect(decision.evidence.score.total).toBe(expected.score);
  });

  it("does not merge distinct normalized names", () => {
    const decision = decidePlaceLiveness({ ...baseInput, candidates: [{ ...candidate, name: "카페 여름" }] });
    expect(decision).toMatchObject({ kakaoStatus: "AMBIGUOUS" });
    expect(decision.evidence.score.name).toBe(0);
  });

  it("does not treat a one-character point suffix as a branch label", () => {
    const decision = decidePlaceLiveness({ ...baseInput, place: { ...baseInput.place, name: "카페봄" }, candidates: [{ ...candidate, name: "카페봄점" }] });
    expect(decision.evidence.score.name).toBe(0);
  });

  it("leaves the current state unchanged for provider errors", () => {
    expect(decidePlaceLiveness({ ...baseInput, currentStatus: "SUSPECTED", currentRecommendationExcluded: true, consecutiveNotFound: 2, searchError: true }))
      .toMatchObject({ status: "SUSPECTED", kakaoStatus: "ERROR", consecutiveNotFound: 2, recommendationExcluded: true, shouldHide: false, shouldOpenCase: false });
  });

  it.each([
    { name: "does not accumulate a not-found result before seven days", lastCheckedAt: "2026-08-06T00:00:00.001Z", expectedCount: 1, expectedStatus: "MONITORING" },
    { name: "accumulates a not-found result after seven days", lastCheckedAt: "2026-08-05T00:00:00.000Z", expectedCount: 2, expectedStatus: "SUSPECTED" },
  ])("$name", ({ lastCheckedAt, expectedCount, expectedStatus }) => {
    expect(decidePlaceLiveness({ ...baseInput, consecutiveNotFound: 1, firstNotFoundAt: "2026-08-01T00:00:00.000Z", lastCheckedAt }))
      .toMatchObject({ kakaoStatus: "NOT_FOUND", consecutiveNotFound: expectedCount, status: expectedStatus });
  });

  it.each([
    { name: "recent OPEN source", recentOpenSourceAt: "2026-08-01T00:00:00.000Z" },
    { name: "recent reviewer activity", recentReviewerActivityAt: "2026-08-01T00:00:00.000Z" },
    { name: "recent member activity", recentMemberActivityAt: "2026-08-01T00:00:00.000Z" },
  ])("does not hide after three not-found results with $name", (protection) => {
    expect(decidePlaceLiveness({ ...baseInput, consecutiveNotFound: 2, firstNotFoundAt: "2026-07-01T00:00:00.000Z", lastCheckedAt: "2026-08-01T00:00:00.000Z", ...protection }))
      .toMatchObject({ status: "SUSPECTED", consecutiveNotFound: 3, shouldHide: false });
  });

  it("keeps a manually protected place verified and recommendation-eligible after a not-found result", () => {
    expect(decidePlaceLiveness({
      ...baseInput,
      currentStatus: "VERIFIED",
      consecutiveNotFound: 2,
      firstNotFoundAt: "2026-07-01T00:00:00.000Z",
      lastCheckedAt: "2026-08-01T00:00:00.000Z",
      protectedUntil: "2026-09-01T00:00:00.000Z",
    })).toMatchObject({
      status: "VERIFIED",
      kakaoStatus: "NOT_FOUND",
      consecutiveNotFound: 0,
      recommendationExcluded: false,
      shouldHide: false,
      shouldOpenCase: false,
      nextCheckAt: "2026-09-01T00:00:00.000Z",
    });
  });

  it("hides after three valid not-found results when no protection applies", () => {
    expect(decidePlaceLiveness({
      ...baseInput,
      consecutiveNotFound: 2,
      firstNotFoundAt: "2026-07-01T00:00:00.000Z",
      lastCheckedAt: "2026-08-01T00:00:00.000Z",
    })).toMatchObject({ status: "HIDDEN", consecutiveNotFound: 3, shouldHide: true });
  });

  it("does not hide when a legacy state has no first not-found timestamp", () => {
    expect(decidePlaceLiveness({ ...baseInput, consecutiveNotFound: 2, lastCheckedAt: "2026-08-01T00:00:00.000Z" }))
      .toMatchObject({ status: "SUSPECTED", consecutiveNotFound: 3, shouldHide: false });
  });

  it.each([
    { mode: "OBSERVE" as const, expected: false },
    { mode: "RECOMMEND" as const, expected: true },
    { mode: "HIDE" as const, expected: true },
  ])("sets recommendation exclusion by $mode mode after two valid not-found results", ({ mode, expected }) => {
    expect(decidePlaceLiveness({ ...baseInput, mode, consecutiveNotFound: 1, firstNotFoundAt: "2026-08-01T00:00:00.000Z", lastCheckedAt: "2026-08-05T00:00:00.000Z" }))
      .toMatchObject({ status: "SUSPECTED", recommendationExcluded: expected, shouldOpenCase: true });
  });
});
