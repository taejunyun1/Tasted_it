import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";

import { createDb } from "../../app/db/client.server";
import { reviewerVisitReviews } from "../../app/db/schema";
import {
  listReviewerVisitHistory,
  publishReviewerVisit,
} from "../../app/features/ratings/reviewer-visit.server";

const now = "2026-08-12T01:00:00.000Z";
let reviewerUserId = "";
const placeId = "reviewer-visit-place";
const categoryId = "reviewer-visit-category";

beforeEach(async () => {
  reviewerUserId = `reviewer-visit-${crypto.randomUUID()}`;
  await env.DB.batch([
    env.DB.prepare(
      `INSERT OR IGNORE INTO users
       (id, email, display_name, role, created_at, updated_at)
       VALUES (?, ?, ?, 'REVIEWER', ?, ?)`,
    ).bind(reviewerUserId, `${reviewerUserId}@example.com`, "방문 리뷰어", now, now),
    env.DB.prepare(
      `INSERT OR IGNORE INTO reviewer_profiles
       (user_id, slug, status, occupation, taste_direction, region_code,
        specialty_slugs, last_activity_at, approved_at, created_at, updated_at)
       VALUES (?, ?, 'ACTIVE', '테스터', '균형', 'GWANGJU', '[]', ?, ?, ?, ?)`,
    ).bind(reviewerUserId, reviewerUserId, now, now, now, now),
    env.DB.prepare(
      `INSERT OR IGNORE INTO categories
       (id, slug, name, emoji, sort_order, is_active, created_at, updated_at)
       VALUES (?, 'reviewer-ramen', '라멘', '🍜', 999, 1, ?, ?)`,
    ).bind(categoryId, now, now),
    env.DB.prepare(
      `INSERT OR IGNORE INTO places
       (id, slug, name, status, address, neighborhood, latitude, longitude,
        search_text, created_at, updated_at)
       VALUES (?, 'reviewer-visit-place', '리뷰어 방문 라멘', 'PUBLISHED',
        '광주광역시 동구', '동명동', 35.149, 126.923, '라멘 동명동', ?, ?)`,
    ).bind(placeId, now, now),
  ]);
});

function input(overrides: Partial<Parameters<typeof publishReviewerVisit>[1]> = {}) {
  return {
    id: crypto.randomUUID(),
    reviewerUserId,
    placeId,
    categoryId,
    categoryName: "라멘" as const,
    evaluation: "RECOMMEND" as const,
    badges: [] as string[],
    golden: false,
    goldenReason: null,
    publishedPhotoCount: 0,
    now,
    ...overrides,
  };
}

describe("publishReviewerVisit", () => {
  it("publishes a normal review without photos, badges, or prose and creates a positive signal", async () => {
    const db = createDb(env.DB);
    const review = await publishReviewerVisit(db, input());

    expect(review).toMatchObject({ evaluation: "RECOMMEND", badgesJson: "[]", photoCount: 0, version: 1 });
    expect(await env.DB.prepare(
      "SELECT value FROM current_votes WHERE place_id = ? AND user_id = ?",
    ).bind(placeId, reviewerUserId).first()).toEqual({ value: 1 });
  });

  it("stores at most two category badges as an immutable snapshot", async () => {
    const db = createDb(env.DB);
    const review = await publishReviewerVisit(db, input({
      badges: ["육수 농도 선명", "면 익힘 알맞음"],
    }));

    const stored = await db.query.reviewerVisitReviews.findFirst({
      where: (table, { eq }) => eq(table.id, review.id),
    });
    expect(JSON.parse(stored!.badgesJson)).toEqual(["육수 농도 선명", "면 익힘 알맞음"]);
  });

  it("turns HOLD into a current-vote withdrawal without inventing a neutral vote", async () => {
    const db = createDb(env.DB);
    await publishReviewerVisit(db, input({ id: crypto.randomUUID() }));
    await publishReviewerVisit(db, input({
      id: crypto.randomUUID(),
      evaluation: "HOLD",
      now: "2026-08-12T01:10:00.000Z",
    }));

    expect(await env.DB.prepare(
      "SELECT value FROM current_votes WHERE place_id = ? AND user_id = ?",
    ).bind(placeId, reviewerUserId).first()).toBeNull();
  });

  it("rejects Golden Pick until at least one photo is durably published", async () => {
    const db = createDb(env.DB);
    await expect(publishReviewerVisit(db, input({
      badges: ["육수 농도 선명", "면 익힘 알맞음"],
      golden: true,
      goldenReason: "육수의 밀도와 면 익힘이 안정적이라 다시 추천하고 싶은 곳입니다.",
    }))).rejects.toThrow("GOLDEN_PICK_PUBLISHED_PHOTO_REQUIRED");
    expect(await env.DB.prepare(
      "SELECT id FROM reviewer_visit_reviews WHERE reviewer_user_id = ?",
    ).bind(reviewerUserId).all()).toMatchObject({ results: [] });
  });

  it("lists only the current reviewer's published history newest first", async () => {
    const db = createDb(env.DB);
    await publishReviewerVisit(db, input({ id: "visit-old", now: "2026-08-12T01:00:00.000Z" }));
    await publishReviewerVisit(db, input({ id: "visit-new", evaluation: "NOT_RECOMMEND", now: "2026-08-12T02:00:00.000Z" }));

    const history = await listReviewerVisitHistory(db, reviewerUserId, 10);
    expect(history.map((row) => row.id)).toEqual(["visit-new", "visit-old"]);
    expect(history[0]).toMatchObject({ placeName: "리뷰어 방문 라멘", categoryName: "라멘", evaluation: "NOT_RECOMMEND" });
  });

  it("does not change the recommendation signal when the immutable review write fails", async () => {
    const db = createDb(env.DB);
    await publishReviewerVisit(db, input({ id: "duplicate-review" }));

    await expect(publishReviewerVisit(db, input({
      id: "duplicate-review",
      evaluation: "NOT_RECOMMEND",
      now: "2026-08-12T03:00:00.000Z",
    }))).rejects.toThrow();

    expect(await env.DB.prepare(
      "SELECT value FROM current_votes WHERE place_id = ? AND user_id = ?",
    ).bind(placeId, reviewerUserId).first()).toEqual({ value: 1 });
  });
});
