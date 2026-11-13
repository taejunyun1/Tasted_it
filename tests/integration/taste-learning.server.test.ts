import { env } from "cloudflare:workers";
import { and, eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createDb } from "../../app/db/client.server";
import {
  categories,
  placeCategories,
  places,
  productEvents,
  recommendationFeedback,
  savedPlaces,
  userTasteBadges,
  users,
} from "../../app/db/schema";
import {
  recordRecommendationFeedback,
  refreshInferredTasteSignals,
  type FeedbackReason,
} from "../../app/features/members/taste-learning.server";
import { getMemberTasteProfile } from "../../app/features/members/profile-taste.server";
import { getPublicationEpoch } from "../../app/features/ratings/reviewer-publication.server";
import { getSaved, setSaved, setSavedAndRefreshTaste } from "../../app/features/saves/save.server";

const now = "2026-08-10T00:00:00Z";
let suffix: string;
let userId: string;
let categoryId: string;

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

async function createPlace(name: string) {
  const db = createDb(env.DB);
  const placeId = `${suffix}-${name}`;
  await db.insert(places).values({
    id: placeId,
    slug: placeId,
    name,
    status: "PUBLISHED",
    address: "광주광역시 동구",
    neighborhood: "동명동",
    latitude: 35.149,
    longitude: 126.9232,
    searchText: name,
    createdAt: now,
    updatedAt: now,
  });
  await db.insert(placeCategories).values({ placeId, categoryId, isPrimary: true });
  return placeId;
}

async function feedback(placeId: string, value: -1 | 1, reason: FeedbackReason | null) {
  await recordRecommendationFeedback(createDb(env.DB), {
    userId,
    placeId,
    value,
    reason,
    now,
  });
}

async function inferredGukbapScore() {
  const row = await createDb(env.DB).query.userTasteBadges.findFirst({
    where: and(
      eq(userTasteBadges.userId, userId),
      eq(userTasteBadges.badgeId, "food-gukbap"),
      eq(userTasteBadges.source, "INFERRED"),
    ),
  });
  return row?.score;
}

beforeEach(async () => {
  const db = createDb(env.DB);
  suffix = crypto.randomUUID();
  userId = `learning-user-${suffix}`;
  categoryId = `learning-category-${suffix}`;
  await db.insert(users).values({
    id: userId,
    email: `${suffix}@example.com`,
    displayName: "학습 사용자",
    role: "USER",
    createdAt: now,
    updatedAt: now,
  });
  await db.insert(categories).values({
    id: categoryId,
    slug: categoryId,
    name: "국밥·해장국",
    emoji: "🍲",
    sortOrder: 1,
    createdAt: now,
    updatedAt: now,
  });
});

describe("recommendation feedback learning", () => {
  it("keeps one current feedback row and preserves its original creation time", async () => {
    const db = createDb(env.DB);
    const placeId = await createPlace("현재 상태 국밥");
    await recordRecommendationFeedback(db, {
      userId,
      placeId,
      value: 1,
      reason: null,
      now,
    });
    await recordRecommendationFeedback(db, {
      userId,
      placeId,
      value: -1,
      reason: "MENU",
      now: "2026-08-10T01:00:00Z",
    });

    const rows = await db.select().from(recommendationFeedback).where(and(
      eq(recommendationFeedback.userId, userId),
      eq(recommendationFeedback.placeId, placeId),
    ));
    expect(rows).toEqual([expect.objectContaining({
      value: -1,
      reason: "MENU",
      createdAt: now,
      updatedAt: "2026-08-10T01:00:00Z",
    })]);
  });

  it("learns a positive food signal from the current feedback row", async () => {
    const placeId = await createPlace("행동 학습 국밥");
    await feedback(placeId, 1, null);

    await refreshInferredTasteSignals(createDb(env.DB), userId, now);

    expect(await inferredGukbapScore()).toBeGreaterThan(0);
  });

  it("replaces only inferred rows and leaves USER, NAVER, and GOOGLE rows untouched", async () => {
    const db = createDb(env.DB);
    const placeId = await createPlace("출처 보존 국밥");
    await feedback(placeId, 1, null);
    await db.insert(userTasteBadges).values([
      { userId, badgeId: "food-gukbap", source: "USER", score: 0.91, evidenceJson: "{\"selected\":true}", createdAt: now, updatedAt: now },
      { userId, badgeId: "food-gukbap", source: "NAVER", score: 0.72, evidenceJson: "{\"provider\":true}", createdAt: now, updatedAt: now },
      { userId, badgeId: "food-gukbap", source: "GOOGLE", score: 0.63, evidenceJson: "{\"provider\":true}", createdAt: now, updatedAt: now },
      { userId, badgeId: "food-pizza", source: "INFERRED", score: 0.88, evidenceJson: "{\"stale\":true}", createdAt: now, updatedAt: now },
    ]);

    await refreshInferredTasteSignals(db, userId, "2026-08-10T02:00:00Z");

    const rows = await db.select().from(userTasteBadges).where(eq(userTasteBadges.userId, userId));
    expect(rows.filter((row) => row.source !== "INFERRED")).toEqual(expect.arrayContaining([
      expect.objectContaining({ source: "USER", score: 0.91, evidenceJson: "{\"selected\":true}", updatedAt: now }),
      expect.objectContaining({ source: "NAVER", score: 0.72, evidenceJson: "{\"provider\":true}", updatedAt: now }),
      expect.objectContaining({ source: "GOOGLE", score: 0.63, evidenceJson: "{\"provider\":true}", updatedAt: now }),
    ]));
    expect(rows.some((row) => row.source === "INFERRED" && row.badgeId === "food-pizza")).toBe(false);
    expect(rows.some((row) => row.source === "INFERRED" && row.badgeId === "food-gukbap")).toBe(true);
  });

  it("penalizes only MENU or missing reasons, accumulates across places, and floors at zero", async () => {
    const db = createDb(env.DB);
    const likedPlaceId = await createPlace("기준 국밥");
    await feedback(likedPlaceId, 1, null);
    await refreshInferredTasteSignals(db, userId, now);
    const baseline = await inferredGukbapScore();
    expect(baseline).toBeGreaterThan(0.36);

    for (const [index, reason] of ["DISTANCE", "PRICE", "ATMOSPHERE", "ALREADY_VISITED"].entries()) {
      await feedback(await createPlace(`무관 이유 ${index} 국밥`), -1, reason as FeedbackReason);
    }
    await refreshInferredTasteSignals(db, userId, "2026-08-10T01:00:00Z");
    expect(await inferredGukbapScore()).toBeCloseTo(baseline!, 8);

    await feedback(await createPlace("메뉴 이유 국밥"), -1, "MENU");
    await feedback(await createPlace("이유 없음 국밥"), -1, null);
    await refreshInferredTasteSignals(db, userId, "2026-08-10T02:00:00Z");
    expect(await inferredGukbapScore()).toBeCloseTo(baseline! - 0.36, 8);

    await feedback(await createPlace("반복 메뉴 국밥"), -1, "MENU");
    await refreshInferredTasteSignals(db, userId, "2026-08-10T03:00:00Z");
    expect(await inferredGukbapScore()).toBe(0);
  });

  it("deletes inferred rows that disappear from the current calculation", async () => {
    const db = createDb(env.DB);
    const placeId = await createPlace("사라질 국밥");
    await feedback(placeId, 1, null);
    await refreshInferredTasteSignals(db, userId, now);
    expect(await inferredGukbapScore()).toBeGreaterThan(0);

    await feedback(placeId, -1, "DISTANCE");
    await refreshInferredTasteSignals(db, userId, "2026-08-10T01:00:00Z");

    expect(await inferredGukbapScore()).toBeUndefined();
  });

  it("also learns from saved places without writing a feedback row", async () => {
    const db = createDb(env.DB);
    const placeId = await createPlace("저장 학습 국밥");
    await db.insert(savedPlaces).values({ userId, placeId, createdAt: now });

    await refreshInferredTasteSignals(db, userId, now);

    expect(await inferredGukbapScore()).toBeGreaterThan(0);
    expect(await db.select().from(recommendationFeedback).where(eq(recommendationFeedback.userId, userId))).toEqual([]);
  });

  it("keeps a committed unsave when taste refresh fails and logs no failure detail", async () => {
    const db = createDb(env.DB);
    const placeId = await createPlace("실패 격리 국밥");
    await setSaved(db, { userId, placeId, saved: true, now });
    const refreshTaste = vi.fn().mockRejectedValue(new Error("private@example.com"));
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);

    try {
      await setSavedAndRefreshTaste(db, {
        userId,
        placeId,
        saved: false,
        now: "2026-08-10T01:00:00Z",
      }, { refreshTaste });

      expect(await getSaved(db, { userId, placeId })).toBe(false);
      expect(refreshTaste).toHaveBeenCalledOnce();
      expect(consoleError).toHaveBeenCalledWith("TASTE_LEARNING_REFRESH_FAILED");
      expect(consoleError).not.toHaveBeenCalledWith("TASTE_LEARNING_REFRESH_FAILED", expect.anything());
    } finally {
      consoleError.mockRestore();
    }
  });

  it("keeps a committed save when the dedicated version write fails", async () => {
    const db = createDb(env.DB);
    const placeId = await createPlace("버전 실패 격리 국밥");
    const advanceVersion = vi.fn().mockRejectedValue(new Error("VERSION_WRITE_FAILED"));
    const refreshTaste = vi.fn();
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);

    try {
      await setSavedAndRefreshTaste(db, {
        userId,
        placeId,
        saved: true,
        now,
      }, { advanceVersion, refreshTaste });

      expect(await getSaved(db, { userId, placeId })).toBe(true);
      expect(advanceVersion).toHaveBeenCalledOnce();
      expect(refreshTaste).not.toHaveBeenCalled();
      expect(consoleError).toHaveBeenCalledWith("TASTE_LEARNING_REFRESH_FAILED");
    } finally {
      consoleError.mockRestore();
    }
  });

  it("does not create or mutate product events while recording or refreshing taste", async () => {
    const db = createDb(env.DB);
    const placeId = await createPlace("이벤트 격리 국밥");
    const existingEvent = {
      id: `analytics-event-${suffix}`,
      userId,
      guestSessionId: null,
      eventName: "ONBOARDING_STARTED",
      metadataJson: "{\"source\":\"test\"}",
      occurredAt: "2026-08-09T00:00:00Z",
    };
    await db.insert(productEvents).values(existingEvent);

    await feedback(placeId, 1, null);
    await refreshInferredTasteSignals(db, userId, now);

    expect(await db.select().from(productEvents).where(eq(productEvents.userId, userId))).toEqual([
      existingEvent,
    ]);
  });

  it("does not infer the same activity again when a stored inferred vector exists", async () => {
    const db = createDb(env.DB);
    await env.DB.prepare("INSERT INTO taste_learning_states(user_id,version_token,created_at,updated_at) VALUES(?,?,?,?)").bind(userId,"valid-inference-token",now,now).run();
    await db.insert(userTasteBadges).values({
      userId,
      badgeId: "food-gukbap",
      source: "INFERRED",
      score: 0.4,
      evidenceJson: JSON.stringify({ algorithm: "activity-v1", moderationEpoch: await getPublicationEpoch(db),versionToken:"valid-inference-token" }),
      createdAt: now,
      updatedAt: now,
    });

    const profile = await getMemberTasteProfile(db, {
      userId,
      displayName: "학습 사용자",
      saved: [{ name: "중복 방지 국밥", categoryName: "국밥·해장국" }],
      rated: [],
      tasteGraph: { status: "LEARNING", placeCount: 0, dimensions: [] },
    });

    expect(profile.vector.find((badge) => badge.id === "food-gukbap")?.score).toBeCloseTo(0.3, 8);
  });

  it("refreshes inferred taste when a saved place is removed", async () => {
    const db = createDb(env.DB);
    const placeId = await createPlace("프로필 저장 해제 국밥");
    await setSavedAndRefreshTaste(db, { userId, placeId, saved: true, now });
    expect(await inferredGukbapScore()).toBeGreaterThan(0);
    await setSavedAndRefreshTaste(db, {
      userId,
      placeId,
      saved: false,
      now: "2026-08-10T01:00:00Z",
    });

    expect(await getSaved(db, { userId, placeId })).toBe(false);
    expect(await inferredGukbapScore()).toBeUndefined();
  });

  it("does not let an older refresh overwrite a newer unsave refresh", async () => {
    const db = createDb(env.DB);
    const placeId = await createPlace("동시성 국밥");
    await setSavedAndRefreshTaste(db, { userId, placeId, saved: true, now });
    const snapshotRead = deferred();
    const releaseOlder = deferred();

    const olderRefresh = refreshInferredTasteSignals(
      db,
      userId,
      "2026-08-10T01:00:00Z",
      {
        afterSnapshot: async () => {
          snapshotRead.resolve();
          await releaseOlder.promise;
        },
      },
    );
    await Promise.race([
      snapshotRead.promise,
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error("REFRESH_SNAPSHOT_HOOK_NOT_CALLED")), 250)),
    ]);

    await setSavedAndRefreshTaste(db, {
      userId,
      placeId,
      saved: false,
      now: "2026-08-10T02:00:00Z",
    });
    expect(await inferredGukbapScore()).toBeUndefined();

    releaseOlder.resolve();
    await olderRefresh;
    expect(await inferredGukbapScore()).toBeUndefined();
  });

  it("preserves createdAt for retained inferred rows while deleting only stale ids", async () => {
    const db = createDb(env.DB);
    const placeId = await createPlace("생성 시각 보존 국밥");
    await feedback(placeId, 1, null);
    await refreshInferredTasteSignals(db, userId, now);
    const initial = await db.query.userTasteBadges.findFirst({
      where: and(
        eq(userTasteBadges.userId, userId),
        eq(userTasteBadges.badgeId, "food-gukbap"),
        eq(userTasteBadges.source, "INFERRED"),
      ),
    });
    await db.insert(userTasteBadges).values({
      userId,
      badgeId: "food-pizza",
      source: "INFERRED",
      score: 0.5,
      evidenceJson: "{\"stale\":true}",
      createdAt: "2026-08-09T00:00:00Z",
      updatedAt: "2026-08-09T00:00:00Z",
    });

    await refreshInferredTasteSignals(db, userId, "2026-08-10T03:00:00Z");

    const retained = await db.query.userTasteBadges.findFirst({
      where: and(
        eq(userTasteBadges.userId, userId),
        eq(userTasteBadges.badgeId, "food-gukbap"),
        eq(userTasteBadges.source, "INFERRED"),
      ),
    });
    expect(retained?.createdAt).toBe(initial?.createdAt);
    expect(retained?.updatedAt).toBe("2026-08-10T03:00:00Z");
    expect(await db.query.userTasteBadges.findFirst({
      where: and(
        eq(userTasteBadges.userId, userId),
        eq(userTasteBadges.badgeId, "food-pizza"),
        eq(userTasteBadges.source, "INFERRED"),
      ),
    })).toBeUndefined();
  });
});
