import { and, desc, eq, inArray } from "drizzle-orm";

import type { AppDb } from "../../db/client.server";
import { loadInD1Chunks } from "../../db/d1-query-chunks";
import { currentVotes, userTasteBadges } from "../../db/schema";
import { currentTasteSignalCondition } from "../members/taste-publication.server";
import { eligibleVoteCondition } from "../ratings/reviewer-publication.server";
import {
  loadGoldenPickContextForPlaces,
  type GoldenPlaceSummary,
} from "../ratings/golden-pick.server";
import {
  GUEST_TASTE_SIGNAL_SCORE,
  type DiscoveryPlace,
  type RankingTasteSignal,
} from "./place-discovery";
import { listRecommendationCandidates } from "./place.server";
import { evaluateAppEligibility } from "./recommendation-eligibility";

export type RecommendationCandidateContext = {
  candidates: DiscoveryPlace[];
  dislikedPlaceIds: string[];
  goldenPicks: Awaited<ReturnType<typeof loadGoldenPickContextForPlaces>>["activePicks"];
  goldenSummaries: GoldenPlaceSummary[];
  tasteSignals: RankingTasteSignal[];
  goldenContextStatus: "NOT_REQUESTED" | "AVAILABLE" | "UNAVAILABLE";
};

type GoldenContextPolicy = "omit" | "required" | "empty-on-error";

async function loadStoredTasteSignals(db: AppDb, userId?: string | null) {
  if (!userId) return [];

  return db.select({
    badgeId: userTasteBadges.badgeId,
    score: userTasteBadges.score,
    source: userTasteBadges.source,
  })
    .from(userTasteBadges)
    .where(and(eq(userTasteBadges.userId, userId), currentTasteSignalCondition()))
    .orderBy(desc(userTasteBadges.score));
}

async function loadDislikedPlaceIds(db: AppDb, userId: string | null | undefined, placeIds: string[]) {
  if (!userId) return [];

  const rows = await loadInD1Chunks(placeIds, (placeIdChunk) => db.select({ placeId: currentVotes.placeId })
    .from(currentVotes)
    .where(and(
      eq(currentVotes.userId, userId),
      eq(currentVotes.value, -1),
      inArray(currentVotes.placeId, placeIdChunk),
      eligibleVoteCondition(),
    )), { reservedBindings: 3 });
  const disliked = new Set(rows.map((row) => row.placeId));
  return placeIds.filter((placeId) => disliked.has(placeId));
}

function mergeTasteSignals(
  storedTaste: RankingTasteSignal[],
  guestTasteBadgeIds: string[],
) {
  const signals = new Map<string, RankingTasteSignal>();
  storedTaste.forEach((signal) => signals.set(signal.badgeId, signal));
  guestTasteBadgeIds.forEach((badgeId) => {
    if (!signals.has(badgeId)) {
      signals.set(badgeId, {
        badgeId,
        score: GUEST_TASTE_SIGNAL_SCORE,
        source: "USER",
      });
    }
  });
  return [...signals.values()];
}

export async function loadRecommendationCandidateContext(db: AppDb, input: {
  userId?: string | null;
  tasteBadgeIds?: string[];
  bbox: [number, number, number, number];
  categorySlug?: string;
  now: string;
  goldenContext?: GoldenContextPolicy;
}): Promise<RecommendationCandidateContext> {
  const [places, storedTaste] = await Promise.all([
    listRecommendationCandidates(db, {
      bbox: input.bbox,
      categorySlug: input.categorySlug,
      limit: 500,
    }),
    loadStoredTasteSignals(db, input.userId),
  ]);
  const placeIds = places.map((place) => place.id);
  const dislikedPlaceIds = await loadDislikedPlaceIds(db, input.userId, placeIds);
  const disliked = new Set(dislikedPlaceIds);
  const candidates = places.filter((place) => evaluateAppEligibility({
    // 이 공통 후보 계층은 기존 계약대로 현재 비추천 장소만 제외한다.
    // 홈 품질 하한은 home-curation의 모드별 랭킹 단계에서 별도로 적용한다.
    sampleCount: 0,
    visibleScore: 100,
    currentlyDisliked: disliked.has(place.id),
  }).decision === "ALLOW");
  const goldenPolicy = input.goldenContext ?? "required";
  let goldenContext: Awaited<ReturnType<typeof loadGoldenPickContextForPlaces>> | null = null;
  if (goldenPolicy !== "omit") {
    try {
      goldenContext = await loadGoldenPickContextForPlaces(db, candidates.map((place) => place.id), input.now);
    } catch (error) {
      if (goldenPolicy === "required") throw error;
    }
  }

  return {
    candidates,
    dislikedPlaceIds,
    goldenPicks: goldenContext?.activePicks ?? [],
    goldenSummaries: goldenContext ? [...goldenContext.summaries.values()] : [],
    tasteSignals: mergeTasteSignals(storedTaste, input.tasteBadgeIds ?? []),
    goldenContextStatus: goldenPolicy === "omit"
      ? "NOT_REQUESTED"
      : goldenContext ? "AVAILABLE" : "UNAVAILABLE",
  };
}
