import { distanceMeters, normalizePlaceIdentity, type PlaceIdentityInput } from "./place-duplicate-policy";

const NOT_FOUND_INTERVAL_MS = 7 * 24 * 60 * 60 * 1_000;
const FIRST_NOT_FOUND_HIDE_DELAY_MS = 14 * 24 * 60 * 60 * 1_000;
const ACTIVITY_PROTECTION_MS = 90 * 24 * 60 * 60 * 1_000;
const OPEN_SOURCE_GUARD_MS = 120 * 24 * 60 * 60 * 1_000;

export type LivenessStatus = "VERIFIED" | "MONITORING" | "SUSPECTED" | "HIDDEN";
export type KakaoLivenessStatus = "MATCHED" | "AMBIGUOUS" | "NOT_FOUND" | "ERROR" | "SKIPPED";
export type LivenessMode = "OBSERVE" | "RECOMMEND" | "HIDE";

export type LivenessPlace = PlaceIdentityInput & {
  kakaoPlaceId?: string | null;
};

export type LivenessCandidate = PlaceIdentityInput & {
  id: string;
  categoryGroupCode: string;
  roadAddress: string;
};

export type LivenessDecisionInput = {
  now: string;
  mode: LivenessMode;
  currentStatus: LivenessStatus;
  currentRecommendationExcluded: boolean;
  consecutiveNotFound: number;
  firstNotFoundAt: string | null;
  lastCheckedAt: string | null;
  protectedUntil: string | null;
  place: LivenessPlace;
  candidates: LivenessCandidate[];
  searchError?: boolean;
  recentReviewerActivityAt: string | null;
  recentMemberActivityAt: string | null;
  recentOpenSourceAt: string | null;
};

type ActivityEvidence = { active: boolean; at: string | null };

export type LivenessDecision = {
  status: LivenessStatus;
  kakaoStatus: KakaoLivenessStatus;
  consecutiveNotFound: number;
  recommendationExcluded: boolean;
  shouldHide: boolean;
  shouldOpenCase: boolean;
  nextCheckAt: string;
  evidence: {
    score: { name: number; address: number; distance: number; phone: number; total: number };
    recentReviewerActivity: ActivityEvidence;
    recentMemberActivity: ActivityEvidence;
    recentOpenSource: ActivityEvidence;
  };
};

export function decidePlaceLiveness(input: LivenessDecisionInput): LivenessDecision {
  const now = new Date(input.now);
  const recentReviewerActivity = activityEvidence(input.recentReviewerActivityAt, now, ACTIVITY_PROTECTION_MS);
  const recentMemberActivity = activityEvidence(input.recentMemberActivityAt, now, ACTIVITY_PROTECTION_MS);
  const recentOpenSource = activityEvidence(input.recentOpenSourceAt, now, OPEN_SOURCE_GUARD_MS);
  const evidence = {
    score: { name: 0, address: 0, distance: 0, phone: 0, total: 0 },
    recentReviewerActivity,
    recentMemberActivity,
    recentOpenSource,
  };
  const nextCheckAt = new Date(now.getTime() + NOT_FOUND_INTERVAL_MS).toISOString();

  if (input.searchError) {
    return {
      status: input.currentStatus,
      kakaoStatus: "ERROR",
      consecutiveNotFound: input.consecutiveNotFound,
      recommendationExcluded: input.currentRecommendationExcluded,
      shouldHide: false,
      shouldOpenCase: false,
      nextCheckAt,
      evidence,
    };
  }

  const match = chooseCandidate(input.place, input.candidates);
  if (match.status === "MATCHED") {
    return {
      status: "VERIFIED",
      kakaoStatus: "MATCHED",
      consecutiveNotFound: 0,
      recommendationExcluded: false,
      shouldHide: false,
      shouldOpenCase: false,
      nextCheckAt,
      evidence: { ...evidence, score: match.score },
    };
  }

  if (match.status === "AMBIGUOUS") {
    return {
      status: "MONITORING",
      kakaoStatus: "AMBIGUOUS",
      consecutiveNotFound: input.consecutiveNotFound,
      recommendationExcluded: false,
      shouldHide: false,
      shouldOpenCase: false,
      nextCheckAt,
      evidence: { ...evidence, score: match.score },
    };
  }

  const validNotFound = isAtLeast(input.lastCheckedAt, now, NOT_FOUND_INTERVAL_MS);
  const consecutiveNotFound = input.consecutiveNotFound + (validNotFound ? 1 : 0);
  const firstNotFoundAt = input.firstNotFoundAt ?? (validNotFound ? input.now : null);
  const protectedByManualReview = isFuture(input.protectedUntil, now);
  const canHide = consecutiveNotFound >= 3
    && hasElapsed(firstNotFoundAt, now, FIRST_NOT_FOUND_HIDE_DELAY_MS)
    && !recentReviewerActivity.active
    && !recentMemberActivity.active
    && !recentOpenSource.active
    && !protectedByManualReview;
  const shouldHide = input.mode === "HIDE" && canHide;
  const isSuspected = consecutiveNotFound >= 2;

  return {
    status: shouldHide ? "HIDDEN" : isSuspected ? "SUSPECTED" : "MONITORING",
    kakaoStatus: "NOT_FOUND",
    consecutiveNotFound,
    recommendationExcluded: input.mode !== "OBSERVE" && isSuspected,
    shouldHide,
    shouldOpenCase: isSuspected,
    nextCheckAt,
    evidence: { ...evidence, score: match.score },
  };
}

function chooseCandidate(place: LivenessPlace, candidates: LivenessCandidate[]) {
  const sameKakaoId = place.kakaoPlaceId ? candidates.find((candidate) => candidate.id === place.kakaoPlaceId) : undefined;
  if (sameKakaoId) return { status: "MATCHED" as const, score: { name: 0, address: 0, distance: 0, phone: 0, total: 100 } };

  const scored = candidates.map((candidate) => ({ candidate, score: scoreCandidate(place, candidate) }));
  const highest = scored.reduce<typeof scored[number] | null>((best, current) => !best || current.score.total > best.score.total ? current : best, null);
  if (!highest || highest.score.total < 50) return { status: "NOT_FOUND" as const, score: highest?.score ?? emptyScore() };

  const equallyStrong = scored.filter(({ score }) => score.total === highest.score.total).length > 1;
  if (equallyStrong || highest.score.total < 70 || !isFoodOrCafe(highest.candidate)) {
    return { status: "AMBIGUOUS" as const, score: highest.score };
  }
  return { status: "MATCHED" as const, score: highest.score };
}

function scoreCandidate(place: LivenessPlace, candidate: LivenessCandidate) {
  const placeIdentity = normalizePlaceIdentity(place);
  const candidateIdentity = normalizePlaceIdentity(candidate);
  const name = sameLivenessName(place.name, candidate.name) ? 40 : 0;
  const address = placeIdentity.address === candidateIdentity.address || placeIdentity.address === normalizePlaceIdentity({ ...candidate, address: candidate.roadAddress }).address ? 30 : 0;
  const distance = (distanceMeters(place, candidate) ?? Infinity) <= 150 ? 20 : 0;
  const phone = placeIdentity.phone && placeIdentity.phone === candidateIdentity.phone ? 10 : 0;
  return { name, address, distance, phone, total: name + address + distance + phone };
}

function normalizeLivenessName(value: string) {
  return value.normalize("NFKC").toLocaleLowerCase("ko-KR")
    .replace(/[\(\[\{][^\)\]\}]*[\)\]\}]/gu, "")
    .replace(/\s+/gu, "")
    .replace(/[\p{P}\p{S}]/gu, "");
}

function sameLivenessName(left: string, right: string) {
  const normalizedLeft = normalizeLivenessName(left);
  const normalizedRight = normalizeLivenessName(right);
  return normalizedLeft === normalizedRight
    || hasBranchSuffix(normalizedLeft, normalizedRight)
    || hasBranchSuffix(normalizedRight, normalizedLeft);
}

function hasBranchSuffix(value: string, base: string) {
  if (!base || !value.startsWith(base)) return false;
  const suffix = value.slice(base.length);
  return /^(?:본점|직영점|\d+호점|[\p{Script=Hangul}\p{N}]+지점|[\p{Script=Hangul}\p{N}]{2,}점)$/u.test(suffix);
}

function isFoodOrCafe(candidate: LivenessCandidate) {
  return candidate.categoryGroupCode === "FD6" || candidate.categoryGroupCode === "CE7";
}

function emptyScore() {
  return { name: 0, address: 0, distance: 0, phone: 0, total: 0 };
}

function activityEvidence(at: string | null, now: Date, windowMs: number): ActivityEvidence {
  return { active: isWithin(at, now, windowMs), at };
}

function isAtLeast(at: string | null, now: Date, durationMs: number) {
  if (!at) return true;
  const timestamp = Date.parse(at);
  return Number.isFinite(timestamp) && now.getTime() - timestamp >= durationMs;
}

function isWithin(at: string | null, now: Date, windowMs: number) {
  if (!at) return false;
  const timestamp = Date.parse(at);
  return Number.isFinite(timestamp) && timestamp <= now.getTime() && now.getTime() - timestamp <= windowMs;
}

function hasElapsed(at: string | null, now: Date, durationMs: number) {
  if (!at) return false;
  const timestamp = Date.parse(at);
  return Number.isFinite(timestamp) && now.getTime() - timestamp >= durationMs;
}

function isFuture(at: string | null, now: Date) {
  const timestamp = at ? Date.parse(at) : Number.NaN;
  return Number.isFinite(timestamp) && timestamp > now.getTime();
}
