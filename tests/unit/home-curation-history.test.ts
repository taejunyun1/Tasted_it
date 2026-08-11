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

  it("같은 첫 추천이 연속되면 최근 1위 관측을 중복으로 보존한다", () => {
    const values = new Map<string, string>();
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
    } as Storage;
    const page = { mode: "now", places: [{ id: "p1" }] } as HomeCurationPage;

    recordHomeRecommendation(storage, page);
    recordHomeRecommendation(storage, page);
    recordHomeRecommendation(storage, page);

    expect(readHomeRecommendationHistory(storage).recentFirst).toEqual(["p1", "p1", "p1"]);
  });

  it("최근 10회 창에는 빈 결과도 포함해 오래된 노출과 1위를 제거한다", () => {
    const values = new Map<string, string>();
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
    } as Storage;

    recordHomeRecommendation(storage, { mode: "now", places: [{ id: "old" }] } as HomeCurationPage);
    for (let index = 0; index < 10; index += 1) {
      recordHomeRecommendation(storage, { mode: "taste", places: [] } as HomeCurationPage);
    }

    expect(readHomeRecommendationHistory(storage)).toEqual(expect.objectContaining({
      recentFirst: [],
      recentShown: [],
      previousMode: "taste",
      previousIds: [],
    }));
  });

  it("30곳 경계에서 방금 다시 노출한 오래된 장소를 유지한다", () => {
    const values = new Map<string, string>();
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
    } as Storage;

    for (let page = 0; page < 6; page += 1) {
      recordHomeRecommendation(storage, {
        mode: "now",
        places: Array.from({ length: 5 }, (_, index) => ({ id: `p${page * 5 + index}` })),
      } as HomeCurationPage);
    }
    recordHomeRecommendation(storage, {
      mode: "taste",
      places: [{ id: "p0" }, { id: "p30" }],
    } as HomeCurationPage);

    const history = readHomeRecommendationHistory(storage);
    expect(history.recentShown).toHaveLength(30);
    expect(history.recentShown).toContainEqual({ placeId: "p0", count: 2 });
    expect(history.recentShown).toContainEqual({ placeId: "p30", count: 1 });
  });
});
