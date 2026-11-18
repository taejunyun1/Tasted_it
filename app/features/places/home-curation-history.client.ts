import type { HomeCurationPage } from "./home-curation";
import {
  emptyHomeRecommendationHistory,
  normalizeHomeRecommendationHistory,
  type HomeRecommendationHistory,
} from "./home-curation-history-codec";

export {
  decodeHomeRecommendationHistory,
  emptyHomeRecommendationHistory,
  encodeHomeRecommendationHistory,
  normalizeHomeRecommendationHistory,
} from "./home-curation-history-codec";
export type {
  HomeLocationSource,
  HomeRecommendationHistory,
} from "./home-curation-history-codec";

const HISTORY_KEY = "retaste:home-curation-v2";
const MAX_RECENT_RECOMMENDATIONS = 10;

type StoredRecommendation = {
  mode: HomeCurationPage["mode"];
  placeIds: string[];
  firstPlaceId: string | null;
  shownAt: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isHomeCurationMode(value: unknown): value is HomeCurationPage["mode"] {
  return value === "now" || value === "taste" || value === "time" || value === "golden" || value === "discovery";
}

function storedRecommendationsFrom(value: unknown): StoredRecommendation[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!isRecord(item) || !isHomeCurationMode(item.mode) || !Array.isArray(item.placeIds)) return [];
    const placeIds = [...new Set(item.placeIds.filter((id): id is string => (
      typeof id === "string" && id.length > 0 && id.length <= 128
    )))].slice(0, 5);
    const firstPlaceId = placeIds[0] ?? null;
    return [{
      mode: item.mode,
      placeIds,
      firstPlaceId,
      shownAt: typeof item.shownAt === "string" && item.shownAt.length <= 64 ? item.shownAt : "",
    }];
  }).slice(-MAX_RECENT_RECOMMENDATIONS);
}

function readStoredSession(storage: Storage) {
  try {
    const raw = storage.getItem(HISTORY_KEY);
    if (!raw) return {
      history: emptyHomeRecommendationHistory(),
      recentRecommendations: [] as StoredRecommendation[],
    };
    const parsed: unknown = JSON.parse(raw);
    return {
      history: normalizeHomeRecommendationHistory(parsed),
      recentRecommendations: storedRecommendationsFrom(isRecord(parsed) ? parsed.recentRecommendations : null),
    };
  } catch {
    return {
      history: emptyHomeRecommendationHistory(),
      recentRecommendations: [] as StoredRecommendation[],
    };
  }
}

function write(
  storage: Storage,
  history: HomeRecommendationHistory,
  recentRecommendations: StoredRecommendation[],
) {
  try {
    storage.setItem(HISTORY_KEY, JSON.stringify({
      ...normalizeHomeRecommendationHistory(history),
      recentRecommendations: storedRecommendationsFrom(recentRecommendations),
    }));
  } catch {
    // Session storage can be unavailable in private browsing contexts.
  }
}

export function readHomeRecommendationHistory(storage: Storage): HomeRecommendationHistory {
  return readStoredSession(storage).history;
}

export function recordHomeRecommendation(storage: Storage, page: HomeCurationPage) {
  if (page.status === "UNAVAILABLE") return;
  const stored = readStoredSession(storage);
  const current = stored.history;
  const ids = page.places.slice(0, 5).map((place) => place.id);
  const recentRecommendations = [...stored.recentRecommendations, {
    mode: page.mode,
    placeIds: ids,
    firstPlaceId: ids[0] ?? null,
    shownAt: new Date().toISOString(),
  }].slice(-MAX_RECENT_RECOMMENDATIONS);
  const sightings = new Map<string, { count: number; lastSeen: number; lastRank: number }>();
  recentRecommendations.forEach((recommendation, recommendationIndex) => {
    recommendation.placeIds.forEach((placeId, rank) => {
      const previous = sightings.get(placeId);
      sightings.set(placeId, {
        count: Math.min(9, (previous?.count ?? 0) + 1),
        lastSeen: recommendationIndex,
        lastRank: rank,
      });
    });
  });
  const recentShown = [...sightings.entries()]
    .sort(([leftId, left], [rightId, right]) => (
      right.lastSeen - left.lastSeen
      || left.lastRank - right.lastRank
      || leftId.localeCompare(rightId)
    ))
    .slice(0, 30)
    .map(([placeId, { count }]) => ({ placeId, count }));
  write(storage, {
    ...current,
    recentFirst: recentRecommendations.slice(-3).reverse()
      .flatMap((recommendation) => recommendation.firstPlaceId ? [recommendation.firstPlaceId] : []),
    recentShown,
    previousMode: page.mode,
    previousIds: ids,
  }, recentRecommendations);
}
