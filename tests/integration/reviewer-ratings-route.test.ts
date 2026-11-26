import { env, withEnv } from "cloudflare:workers";
import { describe, expect, it, vi } from "vitest";

import { createDb } from "../../app/db/client.server";
import { MAX_REVIEWER_RATING_REQUEST_BYTES } from "../../app/features/ratings/reviewer-visit-publish.server";
import { getReviewerPhotoObjectKey } from "../../app/features/ratings/reviewer-photo.server";
import { publishReviewerRatingRequest } from "../../app/features/ratings/reviewer-visit-publish.server";
import { action as submitRating, loader as loadRating } from "../../app/routes/reviewer-ratings";

const now = "2026-08-13T00:00:00.000Z";

async function seedReviewerRouteData(prefix: string) {
  const reviewerId = `${prefix}-reviewer-${crypto.randomUUID()}`;
  const sessionId = `${prefix}-session-${crypto.randomUUID()}`;
  const categoryId = `${prefix}-category-${crypto.randomUUID()}`;
  const placeId = `${prefix}-place-${crypto.randomUUID()}`;
  await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO users (id, email, display_name, role, created_at, updated_at) VALUES (?, ?, '리뷰어', 'REVIEWER', ?, ?)",
    ).bind(reviewerId, `${reviewerId}@example.com`, now, now),
    env.DB.prepare(
      "INSERT INTO sessions (id, user_id, expires_at, created_at) VALUES (?, ?, '2099-01-01T00:00:00.000Z', ?)",
    ).bind(sessionId, reviewerId, now),
    env.DB.prepare(
      "INSERT INTO reviewer_profiles (user_id, slug, status, occupation, taste_direction, region_code, specialty_slugs, last_activity_at, approved_at, created_at, updated_at) VALUES (?, ?, 'ACTIVE', '테스터', '균형', 'GWANGJU', '[]', ?, ?, ?, ?)",
    ).bind(reviewerId, `${prefix}-${crypto.randomUUID()}`, now, now, now, now),
    env.DB.prepare(
      "INSERT INTO categories (id, slug, name, emoji, sort_order, is_active, created_at, updated_at) VALUES (?, ?, '라멘', '🍜', 999, 1, ?, ?)",
    ).bind(categoryId, `${prefix}-${crypto.randomUUID()}`, now, now),
    env.DB.prepare(
      "INSERT INTO places (id, slug, name, status, address, neighborhood, latitude, longitude, search_text, created_at, updated_at) VALUES (?, ?, '발행 경로 라멘', 'PUBLISHED', '광주', '동명동', 35.149, 126.923, '발행 경로 라멘', ?, ?)",
    ).bind(placeId, `${prefix}-${crypto.randomUUID()}`, now, now),
  ]);
  return { reviewerId, sessionId, categoryId, placeId };
}

function reviewPhotoForm(
  input: { placeId: string; categoryId: string },
  withPhoto = true,
) {
  const form = new FormData();
  form.set("intent", "publish-review");
  form.set("visitedOn", "2026-08-12");
  form.set("visitNote", "현장 방문 식사");
  form.set("disclosure", "NONE");
  form.set(
    "photoMetadata",
    JSON.stringify(
      withPhoto
        ? [
            {
              position: 0,
              takenOn: "2026-08-12",
              rightsBasis: "OWN_WORK",
              rightsNote: "",
              caption: "음식 사진",
              privacyChecked: true,
            },
          ]
        : [],
    ),
  );
  form.set("placeId", input.placeId);
  form.set("categoryId", input.categoryId);
  form.set("categoryName", "라멘");
  form.set("evaluation", "RECOMMEND");
  form.set("golden", "0");
  form.set("goldenReason", "");
  if (withPhoto)
    form.append(
      "photos",
      new File([new Uint8Array([0xff, 0xd8, 0xff, 0xd9])], "camera.jpg", {
        type: "image/jpeg",
      }),
    );
  return form;
}

describe("reviewer ratings publish action", () => {
  it("stores selected photos and redirects with an allowlisted success notice", async () => {
    const seeded = await seedReviewerRouteData("reviewer-route-photo");
    const response = await publishReviewerRatingRequest(
      new Request("https://retaste.test/reviewer/ratings", {
        method: "POST",
        headers: {
          Cookie: `retaste_session=${seeded.sessionId}`,
          Origin: "https://retaste.test",
        },
        body: reviewPhotoForm(seeded),
      }),
      {
        db: createDb(env.DB),
        photoBucket: env.REVIEW_PHOTOS,
        photoUploadEnabled: true,
        reviewerUserId: seeded.reviewerId,
        now,
      },
    );

    expect(response.headers.get("location")).toMatch(
      /^\/reviewer\/ratings\?submitted=[A-Za-z0-9-]+&notice=review-with-photos-submitted$/,
    );
    const review = await env.DB.prepare(
      "SELECT id, photo_count AS photoCount FROM reviewer_visit_reviews WHERE reviewer_user_id = ? ORDER BY created_at DESC LIMIT 1",
    )
      .bind(seeded.reviewerId)
      .first<{ id: string; photoCount: number }>();
    expect(review).toMatchObject({ photoCount: 1 });
    const photo = await env.DB.prepare(
      "SELECT id FROM reviewer_visit_photos WHERE review_id = ?",
    )
      .bind(review!.id)
      .first<{ id: string }>();
    expect(photo?.id).toBeTruthy();
    await expect(
      env.REVIEW_PHOTOS.head(getReviewerPhotoObjectKey(review!.id, photo!.id)),
    ).resolves.toBeTruthy();
  });

  it("rejects cross-origin publish requests without writing a review", async () => {
    const seeded = await seedReviewerRouteData("reviewer-route-origin");
    const response = await publishReviewerRatingRequest(
      new Request("https://retaste.test/reviewer/ratings", {
        method: "POST",
        headers: {
          Cookie: `retaste_session=${seeded.sessionId}`,
          Origin: "https://elsewhere.invalid",
        },
        body: reviewPhotoForm(seeded, false),
      }),
      {
        db: createDb(env.DB),
        photoBucket: env.REVIEW_PHOTOS,
        photoUploadEnabled: true,
        reviewerUserId: seeded.reviewerId,
        now,
      },
    );

    expect(response.status).toBe(403);
    await expect(
      env.DB.prepare(
        "SELECT id FROM reviewer_visit_reviews WHERE reviewer_user_id = ?",
      )
        .bind(seeded.reviewerId)
        .first(),
    ).resolves.toBeNull();
  });

  it("rejects an origin-less publish request without writing a review", async () => {
    const seeded = await seedReviewerRouteData("reviewer-route-missing-origin");
    const response = await publishReviewerRatingRequest(
      new Request("https://retaste.test/reviewer/ratings", {
        method: "POST",
        headers: { Cookie: `retaste_session=${seeded.sessionId}` },
        body: reviewPhotoForm(seeded, false),
      }),
      {
        db: createDb(env.DB),
        photoBucket: env.REVIEW_PHOTOS,
        photoUploadEnabled: true,
        reviewerUserId: seeded.reviewerId,
        now,
      },
    );

    expect(response.status).toBe(403);
    await expect(
      env.DB.prepare(
        "SELECT id FROM reviewer_visit_reviews WHERE reviewer_user_id = ?",
      )
        .bind(seeded.reviewerId)
        .first(),
    ).resolves.toBeNull();
  });

  it("rejects an oversized multipart request before it is parsed", async () => {
    const seeded = await seedReviewerRouteData("reviewer-route-content-length");
    const response = await publishReviewerRatingRequest(
      new Request("https://retaste.test/reviewer/ratings", {
        method: "POST",
        headers: {
          Cookie: `retaste_session=${seeded.sessionId}`,
          Origin: "https://retaste.test",
          "Content-Length": String(MAX_REVIEWER_RATING_REQUEST_BYTES + 1),
        },
        body: reviewPhotoForm(seeded, false),
      }),
      {
        db: createDb(env.DB),
        photoBucket: env.REVIEW_PHOTOS,
        photoUploadEnabled: true,
        reviewerUserId: seeded.reviewerId,
        now,
      },
    );

    expect(response.status).toBe(413);
    await expect(
      env.DB.prepare(
        "SELECT id FROM reviewer_visit_reviews WHERE reviewer_user_id = ?",
      )
        .bind(seeded.reviewerId)
        .first(),
    ).resolves.toBeNull();
  });
});

type RouteFixture = Awaited<ReturnType<typeof seedReviewerRouteData>>;

function ratingsRequest(sessionId: string, body?: FormData) {
  return new Request("https://retaste.test/reviewer/ratings", {
    method: body ? "POST" : "GET",
    headers: {
      Cookie: `retaste_session=${sessionId}`,
      Origin: "https://retaste.test",
    },
    body,
  });
}

async function linkPilotSeat(fixture: RouteFixture, code: "A" | "B" | "C") {
  await env.DB.batch([
    env.DB.prepare("UPDATE users SET email_verified_at = ? WHERE id = ?").bind(now, fixture.reviewerId),
    env.DB.prepare("UPDATE student_seats SET user_id = ?, is_active = 1, expires_at = '2099-01-01T00:00:00.000Z' WHERE code = ?")
      .bind(fixture.reviewerId, code),
  ]);
}

function useUploadConfig<T>(input: { seats?: string; global?: string; workspace?: string }, run: () => Promise<T>) {
  return withEnv({
    DB: env.DB,
    REVIEW_PHOTOS: env.REVIEW_PHOTOS,
    REVIEW_PHOTO_UPLOAD_ENABLED: input.global ?? "false",
    STUDENT_WORKSPACE_ENABLED: input.workspace ?? "true",
    STUDENT_REVIEWER_PHOTO_PILOT_SEATS: input.seats,
  }, run) as Promise<T>;
}

describe("student reviewer photo pilot", () => {
  it("lets two selected active students submit photos for the same place", async () => {
    const first = await seedReviewerRouteData("pilot-first");
    const second = await seedReviewerRouteData("pilot-second");
    await linkPilotSeat(first, "A");
    await linkPilotSeat(second, "B");

    await useUploadConfig({ seats: "A,B" }, async () => {
      for (const author of [first, second]) {
        const data = await loadRating({ request: ratingsRequest(author.sessionId) } as never);
        expect(data).toMatchObject({ canSubmit: true, photoUploadEnabled: true });
        const response = await submitRating({ request: ratingsRequest(author.sessionId, reviewPhotoForm(first)) } as never);
        expect(response.status).toBe(303);
        expect(response.headers.get("location")).toContain("notice=review-with-photos-submitted");
      }
    });

    const reviews = await env.DB.prepare(
      "SELECT id, reviewer_user_id AS author, status, photo_count AS photoCount FROM reviewer_visit_reviews WHERE place_id = ?",
    ).bind(first.placeId).all<{ id: string; author: string; status: string; photoCount: number }>();
    expect(reviews.results).toHaveLength(2);
    expect(new Set(reviews.results.map((review) => review.author))).toEqual(new Set([first.reviewerId, second.reviewerId]));
    for (const review of reviews.results) {
      expect(review).toMatchObject({ status: "PENDING", photoCount: 1 });
      const photo = await env.DB.prepare("SELECT id FROM reviewer_visit_photos WHERE review_id = ?").bind(review.id).first<{ id: string }>();
      expect(photo?.id).toBeTruthy();
      await expect(env.REVIEW_PHOTOS.head(getReviewerPhotoObjectKey(review.id, photo!.id))).resolves.toBeTruthy();
    }
  });

  it("fails closed for malformed settings and ineligible students while preserving photo-free reviews", async () => {
    const author = await seedReviewerRouteData("pilot-ineligible");
    await linkPilotSeat(author, "C");
    const put = vi.spyOn(env.REVIEW_PHOTOS, "put");
    const probe = async (input: Parameters<typeof useUploadConfig>[0]) => {
      await useUploadConfig(input, async () => {
        expect(await loadRating({ request: ratingsRequest(author.sessionId) } as never))
          .toMatchObject({ canSubmit: true, photoUploadEnabled: false });
        const response = await submitRating({ request: ratingsRequest(author.sessionId, reviewPhotoForm(author)) } as never);
        expect(response.status).toBe(409);
        await expect(response.json()).resolves.toMatchObject({ error: "REVIEW_PHOTO_UPLOAD_DISABLED" });
      });
    };
    try {
      for (const seats of [undefined, "", "A,B", "C,C", "A,B,C", "C,invalid", "C,"]) {
        await probe({ seats });
      }
      await probe({ seats: "C", workspace: "false" });
      await env.DB.prepare("UPDATE student_seats SET is_active = 0 WHERE code = 'C'").run();
      await probe({ seats: "C" });
      await env.DB.prepare("UPDATE student_seats SET is_active = 1, expires_at = '2020-01-01T00:00:00.000Z' WHERE code = 'C'").run();
      await probe({ seats: "C" });
      await env.DB.prepare("UPDATE student_seats SET expires_at = '2099-01-01T00:00:00.000Z' WHERE code = 'C'").run();
      await env.DB.prepare("UPDATE users SET email_verified_at = NULL WHERE id = ?").bind(author.reviewerId).run();
      await probe({ seats: "C" });
      expect(put).not.toHaveBeenCalled();
      await expect(env.DB.prepare("SELECT id FROM reviewer_visit_reviews WHERE reviewer_user_id = ?")
        .bind(author.reviewerId).first()).resolves.toBeNull();

      await useUploadConfig({ seats: "C" }, async () => {
        const response = await submitRating({ request: ratingsRequest(author.sessionId, reviewPhotoForm(author, false)) } as never);
        expect(response.status).toBe(303);
        expect(response.headers.get("location")).toContain("notice=review-submitted");
      });
      expect(put).not.toHaveBeenCalled();
    } finally {
      put.mockRestore();
    }
  });

  it("rejects the next request when a selected reviewer loses member access", async () => {
    const author = await seedReviewerRouteData("pilot-restricted");
    await linkPilotSeat(author, "A");
    await useUploadConfig({ seats: "A" }, async () => {
      expect(await loadRating({ request: ratingsRequest(author.sessionId) } as never))
        .toMatchObject({ photoUploadEnabled: true });
    });

    const at = Date.now();
    await env.DB.prepare(`INSERT INTO member_access_restrictions
      (user_id, version, reason, starts_at, expires_at, updated_at)
      VALUES (?, 1, '합성 계정 검증', ?, ?, ?)`)
      .bind(author.reviewerId, new Date(at - 1000).toISOString(), new Date(at + 60_000).toISOString(), new Date(at).toISOString())
      .run();
    const put = vi.spyOn(env.REVIEW_PHOTOS, "put");
    try {
      await useUploadConfig({ seats: "A" }, async () => {
        await expect(loadRating({ request: ratingsRequest(author.sessionId) } as never)).rejects.toMatchObject({ status: 302 });
        await expect(submitRating({
          request: ratingsRequest(author.sessionId, reviewPhotoForm(author)),
        } as never)).rejects.toMatchObject({ status: 302 });
      });
      expect(put).not.toHaveBeenCalled();
    } finally {
      put.mockRestore();
    }
  });

  it("requires an active reviewer and preserves the explicit global setting", async () => {
    const author = await seedReviewerRouteData("pilot-reviewer-state");
    await linkPilotSeat(author, "A");
    await env.DB.prepare("UPDATE reviewer_profiles SET status = 'DORMANT' WHERE user_id = ?").bind(author.reviewerId).run();
    await useUploadConfig({ seats: "A" }, async () => {
      expect(await loadRating({ request: ratingsRequest(author.sessionId) } as never))
        .toMatchObject({ canSubmit: false, photoUploadEnabled: false });
      const response = await submitRating({ request: ratingsRequest(author.sessionId, reviewPhotoForm(author)) } as never);
      expect(response.status).toBe(403);
      await expect(response.json()).resolves.toMatchObject({ error: "ACTIVE_REVIEWER_REQUIRED" });
    });

    await env.DB.prepare("UPDATE reviewer_profiles SET status = 'ACTIVE' WHERE user_id = ?").bind(author.reviewerId).run();
    await useUploadConfig({ global: "true", workspace: "false" }, async () => {
      expect(await loadRating({ request: ratingsRequest(author.sessionId) } as never))
        .toMatchObject({ canSubmit: true, photoUploadEnabled: true });
      const response = await submitRating({ request: ratingsRequest(author.sessionId, reviewPhotoForm(author)) } as never);
      expect(response.status).toBe(303);
      expect(response.headers.get("location")).toContain("notice=review-with-photos-submitted");
    });
  });
});
