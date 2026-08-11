import { describe, expect, it } from "vitest";

import {
  decodeHomeRecommendationHistory,
  encodeHomeRecommendationHistory,
  readHomeRecommendationHistory,
  recordHomeRecommendation,
} from "../../app/features/places/home-curation-history.client";
import type { HomeCurationPage } from "../../app/features/places/home-curation";

describe("home recommendation history", () => {
  it("세션 이력을 정해진 최대 크기로 잘라 base64url로 왕복한다", () => {
    const history = decodeHomeRecommendationHistory(encodeHomeRecommendationHistory({
      sessionSeed: "seed-1",
      recentFirst: ["p1", "p2", "p3", "p4"],
      recentShown: Array.from({ length: 40 }, (_, index) => ({ placeId: `p${index}`, count: index + 1 })),
      previousMode: "taste",
      previousIds: ["p1", "p2", "p3", "p4", "p5", "p6"],
    }));
    expect(history.recentFirst).toHaveLength(3);
    expect(history.recentShown).toHaveLength(30);
    expect(history.previousIds).toHaveLength(5);
  });

  it("손상된 이력은 요청 실패 대신 빈 이력로 처리한다", () => {
    expect(decodeHomeRecommendationHistory("not-base64-json")).toEqual(expect.objectContaining({
      recentFirst: [], recentShown: [], previousIds: [], previousMode: null,
    }));
  });

  it("성공한 추천의 첫 장소와 노출 횟수를 세션에 기록한다", () => {
    const values = new Map<string, string>();
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
    } as Storage;
    const page = {
      mode: "golden",
      places: [{ id: "p1" }, { id: "p2" }],
    } as HomeCurationPage;

    recordHomeRecommendation(storage, page);

    expect(readHomeRecommendationHistory(storage)).toEqual(expect.objectContaining({
      recentFirst: ["p1"],
      recentShown: [{ placeId: "p1", count: 1 }, { placeId: "p2", count: 1 }],
      previousMode: "golden",
      previousIds: ["p1", "p2"],
    }));
  });
});
