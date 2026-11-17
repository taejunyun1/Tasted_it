import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createDb } from "../../app/db/client.server";
import { recoverPendingReviewerPhotoCleanup } from "../../app/features/ratings/reviewer-photo-deletion.server";
import { getReviewerPhotoObjectKey } from "../../app/features/ratings/reviewer-photo.server";
import {
  listPublishedPlaceReviewPhotos,
  listReviewerVisitHistory,
  publishReviewerVisitWithPhotos,
} from "../../app/features/ratings/reviewer-visit.server";

const now = "2026-08-13T00:00:00.000Z";
const categoryId = "photo-publish-category";
const placeId = "photo-publish-place";
let reviewerUserId = "";

function photo(id: string, position = 0) {
  return {
    id,
    bytes: new Uint8Array([0xff, 0xd8, 0xff, 0xd9]),
    contentType: "image/jpeg" as const,
    byteSize: 4,
    position,
  };
}

function reviewInput(overrides: Record<string, unknown> = {}) {
  return {
    id: crypto.randomUUID(),
    reviewerUserId,
    placeId,
    categoryId,
    categoryName: "라멘" as const,
    visitedOn: "2026-08-12",
    visitNote: "현장 방문 식사",
    disclosure: "NONE" as const,
    photoMetadata: [
      {
        position: 0,
        takenOn: "2026-08-12",
        rightsBasis: "OWN_WORK" as const,
        rightsNote: "",
        caption: "음식 사진",
        privacyChecked: true as const,
      },
    ],
    evaluation: "RECOMMEND" as const,
    badges: [] as string[],
    golden: false,
    goldenReason: null,
    now,
    ...overrides,
  };
}

beforeEach(async () => {
  reviewerUserId = `photo-publish-reviewer-${crypto.randomUUID()}`;
  await env.DB.batch([
    env.DB.prepare(
      "INSERT OR IGNORE INTO users (id, email, display_name, role, created_at, updated_at) VALUES (?, ?, '사진 리뷰어', 'REVIEWER', ?, ?)",
    ).bind(reviewerUserId, `${reviewerUserId}@example.com`, now, now),
    env.DB.prepare(
      "INSERT OR IGNORE INTO reviewer_profiles (user_id, slug, status, occupation, taste_direction, region_code, specialty_slugs, last_activity_at, approved_at, created_at, updated_at) VALUES (?, ?, 'ACTIVE', '테스터', '균형', 'GWANGJU', '[]', ?, ?, ?, ?)",
    ).bind(reviewerUserId, reviewerUserId, now, now, now, now),
    env.DB.prepare(
      "INSERT OR IGNORE INTO categories (id, slug, name, emoji, sort_order, is_active, created_at, updated_at) VALUES (?, 'photo-publish-ramen', '라멘', '🍜', 999, 1, ?, ?)",
    ).bind(categoryId, now, now),
    env.DB.prepare(
      "INSERT OR IGNORE INTO places (id, slug, name, status, address, neighborhood, latitude, longitude, search_text, created_at, updated_at) VALUES (?, 'photo-publish-place', '사진 발행 라멘', 'PUBLISHED', '광주', '동명동', 35.149, 126.923, '사진 라멘', ?, ?)",
    ).bind(placeId, now, now),
  ]);
});

describe("publishReviewerVisitWithPhotos", () => {
  it("publishes review and photo metadata together after durable R2 storage", async () => {
    const reviewId = "photo-publish-success";
    const result = await publishReviewerVisitWithPhotos(
      createDb(env.DB),
      env.REVIEW_PHOTOS,
      {
        ...reviewInput({ id: reviewId }),
        photos: [photo("photo-publish-1")],
      },
    );

    expect(result.review).toMatchObject({ id: reviewId, photoCount: 1 });
    expect(result.photos).toEqual([
      {
        id: "photo-publish-1",
        url: "/review-photos/photo-publish-1?preview=1",
      },
    ]);
    await expect(
      env.DB.prepare(
        "SELECT review_id AS reviewId, position FROM reviewer_visit_photos WHERE id = ?",
      )
        .bind("photo-publish-1")
        .first(),
    ).resolves.toEqual({ reviewId, position: 0 });
    await expect(
      env.REVIEW_PHOTOS.head(
        getReviewerPhotoObjectKey(reviewId, "photo-publish-1"),
      ),
    ).resolves.toBeTruthy();
  });

  it("does not persist a review when photo storage fails", async () => {
    const reviewId = "photo-publish-storage-failure";
    const failingStore = {
      put: async () => {
        throw new Error("R2_DOWN");
      },
      delete: async () => {},
    };

    await expect(
      publishReviewerVisitWithPhotos(createDb(env.DB), failingStore, {
        ...reviewInput({ id: reviewId }),
        photos: [photo("photo-storage-failure")],
      }),
    ).rejects.toThrow("PHOTO_STORAGE_FAILED");

    await expect(
      env.DB.prepare("SELECT id FROM reviewer_visit_reviews WHERE id = ?")
        .bind(reviewId)
        .first(),
    ).resolves.toBeNull();
  });

  it("compensates stored R2 photos if the D1 publish batch fails", async () => {
    const reviewId = "photo-publish-d1-failure";
    const photoId = "photo-d1-failure";
    await env.DB.exec(
      "CREATE TRIGGER reviewer_photo_publish_failure BEFORE INSERT ON reviewer_visit_photos BEGIN SELECT RAISE(FAIL, 'REVIEW_PHOTO_TEST_TRIGGER'); END",
    );
    try {
      await expect(
        publishReviewerVisitWithPhotos(createDb(env.DB), env.REVIEW_PHOTOS, {
          ...reviewInput({ id: reviewId }),
          photos: [photo(photoId)],
        }),
      ).rejects.toThrow("REVIEW_PHOTO_TEST_TRIGGER");

      await expect(
        env.DB.prepare("SELECT id FROM reviewer_visit_reviews WHERE id = ?")
          .bind(reviewId)
          .first(),
      ).resolves.toBeNull();
      await expect(
        env.REVIEW_PHOTOS.head(getReviewerPhotoObjectKey(reviewId, photoId)),
      ).resolves.toBeNull();
    } finally {
      await env.DB.exec("DROP TRIGGER reviewer_photo_publish_failure");
    }
  });

  it("keeps the public object when D1 committed but its response was lost", async () => {
    const reviewId = "photo-publish-committed-response-lost";
    const photoId = "photo-committed-response-lost";
    const db = createDb(env.DB);
    const originalBatch = db.batch.bind(db);
    const batch = vi
      .spyOn(db, "batch")
      .mockImplementationOnce(async (...statements) => {
        await originalBatch(...statements);
        throw new Error("D1_RESPONSE_LOST");
      });

    try {
      const result = await publishReviewerVisitWithPhotos(
        db,
        env.REVIEW_PHOTOS,
        {
          ...reviewInput({ id: reviewId }),
          photos: [photo(photoId)],
        },
      );

      expect(result).toMatchObject({
        review: { id: reviewId },
        photos: [{ id: photoId }],
      });
      await expect(
        env.REVIEW_PHOTOS.head(getReviewerPhotoObjectKey(reviewId, photoId)),
      ).resolves.toBeTruthy();
      await expect(
        env.DB.prepare(
          "SELECT review_id AS reviewId FROM reviewer_photo_cleanup_jobs WHERE review_id = ?",
        )
          .bind(reviewId)
          .first(),
      ).resolves.toBeNull();
    } finally {
      batch.mockRestore();
    }
  });

  it("keeps a bounded cleanup job when D1 publish and immediate R2 compensation both fail", async () => {
    const reviewId = "photo-publish-compensation-retry";
    const photoId = "photo-compensation-retry";
    await env.DB.exec(
      "CREATE TRIGGER reviewer_photo_compensation_failure BEFORE INSERT ON reviewer_visit_photos BEGIN SELECT RAISE(FAIL, 'REVIEW_PHOTO_COMPENSATION_TRIGGER'); END",
    );
    const failingDeleteStore = {
      put: (
        key: string,
        value: Uint8Array,
        options: { httpMetadata: { contentType: "image/jpeg" } },
      ) => env.REVIEW_PHOTOS.put(key, value, options),
      delete: async () => {
        throw new Error("R2_DELETE_FAILED");
      },
    };

    try {
      await expect(
        publishReviewerVisitWithPhotos(createDb(env.DB), failingDeleteStore, {
          ...reviewInput({ id: reviewId }),
          photos: [photo(photoId)],
        }),
      ).rejects.toThrow("REVIEW_PHOTO_COMPENSATION_TRIGGER");

      await expect(
        env.DB.prepare(
          "SELECT review_id AS reviewId FROM reviewer_photo_cleanup_jobs WHERE review_id = ?",
        )
          .bind(reviewId)
          .first(),
      ).resolves.toEqual({ reviewId });
      await expect(
        env.REVIEW_PHOTOS.head(getReviewerPhotoObjectKey(reviewId, photoId)),
      ).resolves.toBeTruthy();
      await expect(
        recoverPendingReviewerPhotoCleanup(
          createDb(env.DB),
          env.REVIEW_PHOTOS,
          { now: "2026-08-13T01:00:00.000Z" },
        ),
      ).resolves.toEqual({ deleted: 1, pending: 0, failed: 0 });
      await expect(
        env.DB.prepare(
          "SELECT review_id AS reviewId FROM reviewer_photo_cleanup_jobs WHERE review_id = ?",
        )
          .bind(reviewId)
          .first(),
      ).resolves.toBeNull();
    } finally {
      await env.DB.exec("DROP TRIGGER reviewer_photo_compensation_failure");
    }
  });

  it("keeps a cleanup job when an R2 put may have stored an object before failing", async () => {
    const reviewId = "photo-publish-ambiguous-put";
    const photoId = "photo-ambiguous-put";
    const ambiguousStore = {
      put: async (
        key: string,
        value: Uint8Array,
        options: { httpMetadata: { contentType: "image/jpeg" } },
      ) => {
        await env.REVIEW_PHOTOS.put(key, value, options);
        throw new Error("R2_RESPONSE_LOST");
      },
      delete: async () => {
        throw new Error("R2_DELETE_FAILED");
      },
    };

    await expect(
      publishReviewerVisitWithPhotos(createDb(env.DB), ambiguousStore, {
        ...reviewInput({ id: reviewId }),
        photos: [photo(photoId)],
      }),
    ).rejects.toThrow("PHOTO_STORAGE_FAILED");

    await expect(
      env.DB.prepare(
        "SELECT review_id AS reviewId FROM reviewer_photo_cleanup_jobs WHERE review_id = ?",
      )
        .bind(reviewId)
        .first(),
    ).resolves.toEqual({ reviewId });
    await expect(
      env.REVIEW_PHOTOS.head(getReviewerPhotoObjectKey(reviewId, photoId)),
    ).resolves.toBeTruthy();
    await expect(
      recoverPendingReviewerPhotoCleanup(createDb(env.DB), env.REVIEW_PHOTOS, {
        now: "2026-08-13T01:00:00.000Z",
      }),
    ).resolves.toEqual({ deleted: 1, pending: 0, failed: 0 });
  });

  it("requires a durable uploaded photo for Golden Pick", async () => {
    await expect(
      publishReviewerVisitWithPhotos(createDb(env.DB), env.REVIEW_PHOTOS, {
        ...reviewInput({
          id: "golden-no-photo",
          golden: true,
          badges: ["육수 농도 선명", "면 익힘 알맞음"],
          goldenReason:
            "육수와 면의 조화가 안정적이라 다시 찾고 싶은 라멘입니다.",
        }),
        photos: [],
        photoMetadata: [],
      }),
    ).rejects.toThrow("GOLDEN_PICK_PUBLISHED_PHOTO_REQUIRED");
  });

  it("does not persist photo rows when the photo count invariant is removed", async () => {
    const reviewId = "photo-count-invariant";
    const result = await publishReviewerVisitWithPhotos(
      createDb(env.DB),
      env.REVIEW_PHOTOS,
      {
        ...reviewInput({ id: reviewId }),
        photos: [photo("photo-count-invariant")],
      },
    );

    expect(result.review.photoCount).toBe(1);
    await expect(
      env.DB.prepare(
        "SELECT count(*) AS count FROM reviewer_visit_photos WHERE review_id = ?",
      )
        .bind(reviewId)
        .first<{ count: number }>(),
    ).resolves.toEqual({ count: 1 });
  });

  it("projects only approved opaque public photo URLs and preserves unapproved rows privately", async () => {
    const db = createDb(env.DB);
    const result = await publishReviewerVisitWithPhotos(db, env.REVIEW_PHOTOS, {
      ...reviewInput({ id: "public-photo-new" }),
      photoMetadata: [0, 1].map((position) => ({
        position,
        takenOn: "2026-08-12",
        rightsBasis: "OWN_WORK" as const,
        rightsNote: "",
        caption: "음식 사진",
        privacyChecked: true as const,
      })),
      photos: [photo("public-photo-new-1"), photo("public-photo-new-2", 1)],
    });
    expect(await listPublishedPlaceReviewPhotos(db, placeId, 12)).toEqual([]);
    const admin = "photo-moderation-admin";
    await env.DB.prepare(
      "INSERT OR IGNORE INTO users(id,email,display_name,role,created_at,updated_at) VALUES (?,?,'관리자','ADMIN',?,?)",
    )
      .bind(admin, `${admin}@example.com`, now, now)
      .run();
    const { moderateReviewerVisit } =
      await import("../../app/features/ratings/reviewer-moderation.server");
    await moderateReviewerVisit(db, {
      reviewId: result.review.id,
      actorUserId: admin,
      expectedVersion: 1,
      status: "APPROVED",
      reason: "사진과 권리 확인",
      checks: {
        visitVerified: true,
        rightsVerified: true,
        privacyVerified: true,
        placeVerified: true,
      },
      now,
    });
    const photos = await listPublishedPlaceReviewPhotos(db, placeId, 12);
    expect(photos).toEqual([
      expect.objectContaining({
        id: "public-photo-new-1",
        url: "/review-photos/public-photo-new-1",
        position: 0,
      }),
      expect.objectContaining({
        id: "public-photo-new-2",
        url: "/review-photos/public-photo-new-2",
        position: 1,
      }),
    ]);
    expect(photos.some((p) => "objectKey" in p)).toBe(false);
  });

  it("includes only opaque photo URLs in the reviewer’s own history", async () => {
    const db = createDb(env.DB);
    await publishReviewerVisitWithPhotos(db, env.REVIEW_PHOTOS, {
      ...reviewInput({ id: "history-photo-review" }),
      photos: [photo("history-photo-1")],
    });

    const history = await listReviewerVisitHistory(db, reviewerUserId, 12);
    const review = history.find((item) => item.id === "history-photo-review");
    expect(review).toMatchObject({
      photos: [
        {
          id: "history-photo-1",
          url: "/review-photos/history-photo-1?preview=1",
        },
      ],
    });
    expect("objectKey" in (review?.photos[0] ?? {})).toBe(false);
  });
});

for (const status of ["APPROVED","CHANGES_REQUESTED"] as const) {
  it(`preserves committed photos when ${status} moderation precedes recovery from a lost response`,async()=>{
    const db=createDb(env.DB);const reviewId=crypto.randomUUID();const photoId=crypto.randomUUID();const actorId=crypto.randomUUID();
    await env.DB.prepare("INSERT INTO users(id,email,display_name,role,created_at,updated_at) VALUES(?,?,?,'ADMIN',?,?)").bind(actorId,`${actorId}@example.test`,"합성 검수자",now,now).run();
    const originalBatch=db.batch.bind(db);
    const batch=vi.spyOn(db,"batch").mockImplementationOnce(async(...statements)=>{
      await originalBatch(...statements);
      const {moderateReviewerVisit}=await import("../../app/features/ratings/reviewer-moderation.server");
      await moderateReviewerVisit(db,{reviewId,actorUserId:actorId,expectedVersion:1,status,reason:"방문과 사진 권리 확인",checks:{visitVerified:true,rightsVerified:true,privacyVerified:true,placeVerified:true},now});
      throw new Error("D1_RESPONSE_LOST");
    });
    try {
      const result=await publishReviewerVisitWithPhotos(db,env.REVIEW_PHOTOS,{...reviewInput({id:reviewId}),photos:[photo(photoId)]});
      expect(result.review.status).toBe(status);
      expect(await env.REVIEW_PHOTOS.head(getReviewerPhotoObjectKey(reviewId,photoId))).toBeTruthy();
      expect(await env.DB.prepare("SELECT count(*) n FROM reviewer_visit_photos WHERE review_id=?").bind(reviewId).first()).toEqual({n:1});
    } finally {batch.mockRestore();}
  });
}

it("preserves referenced objects when both the commit response and confirmation read fail",async()=>{
  const db=createDb(env.DB);const reviewId=crypto.randomUUID();const photoId=crypto.randomUUID();const originalBatch=db.batch.bind(db);let selectSpy:ReturnType<typeof vi.spyOn>|undefined;
  const batch=vi.spyOn(db,"batch").mockImplementationOnce(async(...statements)=>{await originalBatch(...statements);selectSpy=vi.spyOn(db,"select").mockImplementationOnce(()=>{throw new Error("D1_CONFIRMATION_UNAVAILABLE");});throw new Error("D1_RESPONSE_LOST");});
  try {
    await expect(publishReviewerVisitWithPhotos(db,env.REVIEW_PHOTOS,{...reviewInput({id:reviewId}),photos:[photo(photoId)]})).rejects.toThrow("D1_RESPONSE_LOST");
    expect(await env.REVIEW_PHOTOS.head(getReviewerPhotoObjectKey(reviewId,photoId))).toBeTruthy();
    expect(await env.DB.prepare("SELECT count(*) n FROM reviewer_visit_photos WHERE review_id=?").bind(reviewId).first()).toEqual({n:1});
  } finally {selectSpy?.mockRestore();batch.mockRestore();}
});

it("checks the current reviewer role before any object write or cleanup plan",async()=>{
  const db=createDb(env.DB);const reviewId=crypto.randomUUID();const put=vi.fn();
  await env.DB.prepare("UPDATE users SET role='USER' WHERE id=?").bind(reviewerUserId).run();
  await expect(publishReviewerVisitWithPhotos(db,{put,delete:async()=>{}},{...reviewInput({id:reviewId}),photos:[photo(crypto.randomUUID())]})).rejects.toThrow("ACTIVE_REVIEWER_REQUIRED");
  expect(put).not.toHaveBeenCalled();
  expect(await env.DB.prepare("SELECT count(*) n FROM reviewer_photo_cleanup_jobs WHERE review_id=?").bind(reviewId).first()).toEqual({n:0});
});

it("does not commit photo references after the orphan cleanup has claimed and removed the upload", async () => {
  const db = createDb(env.DB), reviewId = "cleanup-claimed-before-publish", photoId = "cleanup-claimed-photo";
  const store = {
    put: async (key: string, bytes: Uint8Array, options: { httpMetadata: { contentType: "image/jpeg" } }) => {
      await env.REVIEW_PHOTOS.put(key, bytes, options);
      expect(await recoverPendingReviewerPhotoCleanup(db, env.REVIEW_PHOTOS, { now: "2026-08-13T01:00:00.000Z" })).toEqual({ deleted: 1, pending: 0, failed: 0 });
    },
    delete: (keys: string | string[]) => env.REVIEW_PHOTOS.delete(keys),
  };
  await expect(publishReviewerVisitWithPhotos(db, store, { ...reviewInput({ id: reviewId }), photos: [photo(photoId)] })).rejects.toThrow();
  expect(await env.REVIEW_PHOTOS.head(getReviewerPhotoObjectKey(reviewId, photoId))).toBeNull();
  expect(await env.DB.prepare("SELECT id FROM reviewer_visit_reviews WHERE id=?").bind(reviewId).first()).toBeNull();
  expect(await env.DB.prepare("SELECT count(*) AS n FROM reviewer_photo_cleanup_guards").first()).toEqual({ n: 0 });
});

it("recovers a late PUT that stores the object after cron removed the original orphan plan", async () => {
  const db = createDb(env.DB), reviewId = "late-put-after-cleanup", photoId = "late-photo";
  const store = {
    put: async (key: string, bytes: Uint8Array, options: { httpMetadata: { contentType: "image/jpeg" } }) => {
      expect(await recoverPendingReviewerPhotoCleanup(db, env.REVIEW_PHOTOS, { now: "2026-08-13T01:00:00.000Z" })).toEqual({ deleted: 1, pending: 0, failed: 0 });
      await env.REVIEW_PHOTOS.put(key, bytes, options);
    },
    delete: (keys: string | string[]) => env.REVIEW_PHOTOS.delete(keys),
  };
  await expect(publishReviewerVisitWithPhotos(db, store, { ...reviewInput({ id: reviewId }), photos: [photo(photoId)] })).rejects.toThrow();
  expect(await env.REVIEW_PHOTOS.head(getReviewerPhotoObjectKey(reviewId, photoId))).toBeNull();
  expect(await env.DB.prepare("SELECT id FROM reviewer_visit_reviews WHERE id=?").bind(reviewId).first()).toBeNull();
  expect(await env.DB.prepare("SELECT review_id FROM reviewer_photo_cleanup_jobs WHERE review_id=?").bind(reviewId).first()).toBeNull();
});
