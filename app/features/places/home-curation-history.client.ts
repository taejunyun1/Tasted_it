import type { HomeCurationMode } from "../maps/home-curation-options";
import type { HomeCurationPage } from "./home-curation";

const HISTORY_KEY = "retaste:home-curation-v2";
const MAX_ENCODED_HISTORY_LENGTH = 8_192;
const MAX_TOKEN_LENGTH = 128;

export type HomeLocationSource = "gps" | "map_center";

export type HomeRecommendationHistory = {
  sessionSeed: string;
  recentFirst: string[];
  recentShown: Array<{ placeId: string; count: number }>;
  previousMode: HomeCurationMode | null;
  previousIds: string[];
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isHomeCurationMode(value: unknown): value is HomeCurationMode {
  return value === "now" || value === "taste" || value === "time" || value === "golden" || value === "discovery";
}

function safeToken(value: unknown) {
  return typeof value === "string" && value.length > 0 && value.length <= MAX_TOKEN_LENGTH ? value : null;
}

function safeIds(value: unknown, limit: number) {
  return Array.isArray(value)
    ? value.flatMap((item) => {
      const token = safeToken(item);
      return token ? [token] : [];
    }).slice(0, limit)
    : [];
}

function safeShown(value: unknown) {
  return Array.isArray(value)
    ? value.flatMap((item) => {
      if (!isRecord(item)) return [];
      const placeId = safeToken(item.placeId);
      const count = item.count;
      return placeId && typeof count === "number" && Number.isFinite(count) && count >= 1
        ? [{ placeId, count: Math.min(9, Math.floor(count)) }]
        : [];
    })
    : [];
}

function randomSeed() {
  return crypto.randomUUID();
}

function encodeBase64Url(value: string) {
  const bytes = new TextEncoder().encode(value);
  const binary = Array.from(bytes, (byte) => String.fromCharCode(byte)).join("");
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

function decodeBase64Url(value: string) {
  if (!value || value.length > MAX_ENCODED_HISTORY_LENGTH || !/^[A-Za-z0-9_-]+$/.test(value)) throw new Error("INVALID_HISTORY");
  const padded = value.replaceAll("-", "+").replaceAll("_", "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  const binary = atob(padded);
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
}

export function normalizeHomeRecommendationHistory(input: unknown): HomeRecommendationHistory {
  const value = isRecord(input) ? input : {};
  return {
    sessionSeed: safeToken(value.sessionSeed) ?? randomSeed(),
    recentFirst: safeIds(value.recentFirst, 3),
    recentShown: safeShown(value.recentShown).slice(0, 30),
    previousMode: isHomeCurationMode(value.previousMode) ? value.previousMode : null,
    previousIds: safeIds(value.previousIds, 5),
  };
}

export function emptyHomeRecommendationHistory(): HomeRecommendationHistory {
  return normalizeHomeRecommendationHistory({});
}

export function encodeHomeRecommendationHistory(history: HomeRecommendationHistory) {
  return encodeBase64Url(JSON.stringify(normalizeHomeRecommendationHistory(history)));
}

export function decodeHomeRecommendationHistory(raw: string | null | undefined): HomeRecommendationHistory {
  try {
    return normalizeHomeRecommendationHistory(JSON.parse(decodeBase64Url(raw ?? "")));
  } catch {
    return emptyHomeRecommendationHistory();
  }
}

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
    recentFirst: ids[0] ? [ids[0], ...current.recentFirst.filter((id) => id !== ids[0])].slice(0, 3) : current.recentFirst,
    recentShown: [...counts].map(([placeId, count]) => ({ placeId, count })).slice(-30),
    previousMode: page.mode,
    previousIds: ids,
  });
}
