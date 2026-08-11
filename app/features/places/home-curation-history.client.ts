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

function write(storage: Storage, history: HomeRecommendationHistory) {
  try {
    storage.setItem(HISTORY_KEY, JSON.stringify(normalizeHomeRecommendationHistory(history)));
  } catch {
    // Session storage can be unavailable in private browsing contexts.
  }
}

export function readHomeRecommendationHistory(storage: Storage): HomeRecommendationHistory {
  try {
    const raw = storage.getItem(HISTORY_KEY);
    return raw ? normalizeHomeRecommendationHistory(JSON.parse(raw)) : emptyHomeRecommendationHistory();
  } catch {
    return emptyHomeRecommendationHistory();
  }
}

export function recordHomeRecommendation(storage: Storage, page: HomeCurationPage) {
  const current = readHomeRecommendationHistory(storage);
  const ids = page.places.slice(0, 5).map((place) => place.id);
  const counts = new Map(current.recentShown.map((item) => [item.placeId, item.count]));
  ids.forEach((id) => counts.set(id, Math.min(9, (counts.get(id) ?? 0) + 1)));
  write(storage, {
    ...current,
    recentFirst: ids[0] ? [ids[0], ...current.recentFirst].slice(0, 3) : current.recentFirst,
    recentShown: [...counts].map(([placeId, count]) => ({ placeId, count })).slice(-30),
    previousMode: page.mode,
    previousIds: ids,
  });
}
