import { and, desc, eq, inArray, getTableColumns, sql } from "drizzle-orm";

import type { AppDb } from "../../db/client.server";
import {
  categories,
  places,
  reviewerProfiles,
  reviewerPhotoCleanupJobs,
  reviewerReviewTransitions,
  reviewerVisitPhotos,
  reviewerVisitReviews,
} from "../../db/schema";
import { cleanupUncommittedReviewerPhotoUpload } from "./reviewer-photo-deletion.server";
import { eligibleReviewCondition } from "./reviewer-publication.server";
import {
  reviewCursorCondition,
  type ReviewerHistoryCursor,
  requireActiveReviewer,
  requireReviewablePlace,
  requireReviewerCurrentSlot,
  reviewTransition,
  validateVisitDeclaration,
  validatePhotoMetadata,
  type ReviewerPhotoMetadata,
} from "./reviewer-moderation.server";
import {
  REVIEWER_BADGE_CATALOG,
  type ReviewerCategoryName,
  type ReviewerEvaluation,
} from "./reviewer-visit";
import {
  assertReviewerPhotoStorageInput,
  getReviewerPhotoObjectKey,
  storeReviewerPhotos,
  type PhotoObjectStore,
} from "./reviewer-photo.server";
import type { ValidatedReviewerPhoto } from "./reviewer-photo";

export type PublishReviewerVisitInput = {
  id: string;
  reviewerUserId: string;
  placeId: string;
  categoryId: string;
  categoryName: ReviewerCategoryName;
  evaluation: ReviewerEvaluation;
  badges: string[];
  golden: boolean;
  goldenReason: string | null;
  publishedPhotoCount: number;
  now: string;
  visitedOn?: string;
  visitNote?: string;
  disclosure?: "NONE" | "DECLARED" | "UNKNOWN";
  photoMetadata?: ReviewerPhotoMetadata[];
};

export type PublishReviewerVisitWithPhotosInput = Omit<
  PublishReviewerVisitInput,
  "publishedPhotoCount"
> & {
  photos: ValidatedReviewerPhoto[];
};

export type PublishedReviewerPhoto = {
  id: string;
  url: string;
};

async function readCommittedPhotoPublish(
  db: AppDb,
  input: PublishReviewerVisitWithPhotosInput,
  objectKeys: string[],
) {
  const review = await db
    .select({
      ...getTableColumns(reviewerVisitReviews),
      id: reviewerVisitReviews.id,
      placeId: reviewerVisitReviews.placeId,
      reviewerUserId: reviewerVisitReviews.reviewerUserId,
      categoryId: reviewerVisitReviews.categoryId,
      evaluation: reviewerVisitReviews.evaluation,
      badgesJson: reviewerVisitReviews.badgesJson,
      photoCount: reviewerVisitReviews.photoCount,
      goldenPickEventId: reviewerVisitReviews.goldenPickEventId,
      version: reviewerVisitReviews.version,
      publishedAt: reviewerVisitReviews.publishedAt,
      createdAt: reviewerVisitReviews.createdAt,
      updatedAt: reviewerVisitReviews.updatedAt,
    })
    .from(reviewerVisitReviews)
    .where(
      and(
        eq(reviewerVisitReviews.id, input.id),
        eq(reviewerVisitReviews.reviewerUserId, input.reviewerUserId),
        eq(reviewerVisitReviews.placeId, input.placeId),
      ),
    )
    .limit(1)
    .then((rows) => rows[0] ?? null);
  if (!review || review.photoCount !== input.photos.length) return null;

  const submission = await db.query.reviewerReviewTransitions.findFirst({
    where: and(
      eq(reviewerReviewTransitions.reviewId, input.id),
      eq(reviewerReviewTransitions.operation, "SUBMIT"),
      eq(reviewerReviewTransitions.actorUserId, input.reviewerUserId),
      eq(reviewerReviewTransitions.expectedVersion, 1),
      eq(reviewerReviewTransitions.toVersion, 1),
      eq(reviewerReviewTransitions.createdAt, input.now),
    ),
  });
  if (!submission || review.createdAt !== input.now) return null;
  const expected = new Map(
    input.photos.map((photo, index) => [
      photo.id,
      {
        objectKey: objectKeys[index],
        position: photo.position,
        byteSize: photo.byteSize,
      },
    ]),
  );
  const photos = await db
    .select({
      id: reviewerVisitPhotos.id,
      objectKey: reviewerVisitPhotos.objectKey,
      position: reviewerVisitPhotos.position,
      byteSize: reviewerVisitPhotos.byteSize,
    })
    .from(reviewerVisitPhotos)
    .where(
      and(
        eq(reviewerVisitPhotos.reviewId, input.id),
        inArray(reviewerVisitPhotos.id, [...expected.keys()]),
      ),
    );
  if (
    photos.length !== expected.size ||
    photos.some((photo) => {
      const expectedPhoto = expected.get(photo.id);
      return (
        !expectedPhoto ||
        expectedPhoto.objectKey !== photo.objectKey ||
        expectedPhoto.position !== photo.position ||
        expectedPhoto.byteSize !== photo.byteSize
      );
    })
  )
    return null;

  return {
    review,
    photos: input.photos.map((photo) => ({
      id: photo.id,
      url: `/review-photos/${photo.id}?preview=1`,
    })),
  };
}

function assertBadgeContract(input: PublishReviewerVisitInput) {
  const allowed = REVIEWER_BADGE_CATALOG[input.categoryName];
  if (!allowed) throw new Error("REVIEW_CATEGORY_INVALID");
  if (
    input.badges.length > 2 ||
    new Set(input.badges).size !== input.badges.length
  ) {
    throw new Error("REVIEW_BADGE_LIMIT");
  }
  if (input.badges.some((badge) => !allowed.includes(badge as never))) {
    throw new Error("REVIEW_BADGE_INVALID");
  }
}

async function publishReviewerVisitInternal(
  db: AppDb,
  input: PublishReviewerVisitInput,
  photoRows: Array<{
    id: string;
    objectKey: string;
    contentType: "image/jpeg";
    byteSize: number;
    position: number;
  }> = [],
  cleanupJobReviewId: string | null = null,
) {
  assertBadgeContract(input);
  if (
    !Number.isInteger(input.publishedPhotoCount) ||
    input.publishedPhotoCount < 0 ||
    input.publishedPhotoCount > 5
  ) {
    throw new Error("REVIEW_PHOTO_COUNT_INVALID");
  }
  if (input.golden && input.publishedPhotoCount < 1) {
    throw new Error("GOLDEN_PICK_PUBLISHED_PHOTO_REQUIRED");
  }
  if (input.golden && input.badges.length !== 2)
    throw new Error("GOLDEN_PICK_BADGES_REQUIRED");
  if (
    input.golden &&
    (!input.goldenReason ||
      input.goldenReason.trim().length < 15 ||
      input.goldenReason.trim().length > 100)
  ) {
    throw new Error("GOLDEN_PICK_REASON_LENGTH");
  }

  const [reviewer, place, category] = await Promise.all([
    db.query.reviewerProfiles.findFirst({
      where: eq(reviewerProfiles.userId, input.reviewerUserId),
    }),
    db.query.places.findFirst({ where: eq(places.id, input.placeId) }),
    db.query.categories.findFirst({
      where: and(
        eq(categories.id, input.categoryId),
        eq(categories.isActive, true),
      ),
    }),
  ]);
  if (!reviewer || reviewer.status !== "ACTIVE")
    throw new Error("ACTIVE_REVIEWER_REQUIRED");
  if (!place || place.status !== "PUBLISHED")
    throw new Error("PUBLISHED_PLACE_REQUIRED");
  if (!category || category.name !== input.categoryName)
    throw new Error("REVIEW_CATEGORY_MISMATCH");

  const declaration = validateVisitDeclaration(input, input.now);
  const metadata = validatePhotoMetadata(input.photoMetadata ?? [], input.now);
  if (
    photoRows.length !== input.publishedPhotoCount ||
    metadata.length !== photoRows.length
  )
    throw new Error("REVIEW_PHOTO_RIGHTS_INVALID");
  if (photoRows.some((p) => !metadata.some((m) => m.position === p.position)))
    throw new Error("REVIEW_PHOTO_RIGHTS_INVALID");
  const previousVote = await db.get<{ id: string }>(
    sql`select id from vote_events where place_id=${input.placeId} and user_id=${input.reviewerUserId} order by rowid desc limit 1`,
  );
  await requireActiveReviewer(db, input.reviewerUserId);
  await requireReviewablePlace(db, input.placeId);
  await requireReviewerCurrentSlot(db, {
    reviewerUserId: input.reviewerUserId,
    placeId: input.placeId,
    reviewId: input.id,
  });
  const review: typeof reviewerVisitReviews.$inferSelect = {
    id: input.id,
    placeId: input.placeId,
    reviewerUserId: input.reviewerUserId,
    categoryId: input.categoryId,
    evaluation: input.evaluation,
    badgesJson: JSON.stringify(input.badges),
    photoCount: input.publishedPhotoCount,
    goldenPickEventId: null,
    goldenRequested: input.golden,
    goldenReason: input.goldenReason,
    submittedAt: input.now,
    status: "PENDING" as const,
    isCurrent: true,
    contentVersion: 1,
    approvedContentVersion: null,
    visitedOn: declaration.visitedOn,
    visitNote: declaration.visitNote,
    disclosure: declaration.disclosure,
    baseEventId: previousVote?.id ?? null,
    reviewedBy: null,
    reviewedAt: null,
    reviewReason: null,
    ruleVersion: null,
    version: 1,
    publishedAt: input.now,
    createdAt: input.now,
    updatedAt: input.now,
  };
  const photos = photoRows.map((photo) => {
    const meta = metadata.find((m) => m.position === photo.position)!;
    return db.insert(reviewerVisitPhotos).values({
      ...photo,
      reviewId: input.id,
      contentVersion: 1,
      takenOn: meta.takenOn,
      rightsBasis: meta.rightsBasis,
      rightsNote: meta.rightsNote,
      caption: meta.caption,
      privacyChecked: true,
      createdAt: input.now,
      updatedAt: input.now,
    });
  });
  await db.batch([
    db.insert(reviewerVisitReviews).values(review),
    ...photos,
    reviewTransition(db, {
      review,
      actorUserId: input.reviewerUserId,
      operation: "SUBMIT",
      reason: "SUBMITTED_FOR_REVIEW",
      after: { ...review, photos: metadata },
      now: input.now,
    }),
    db
      .update(reviewerProfiles)
      .set({ lastActivityAt: input.now, updatedAt: input.now })
      .where(eq(reviewerProfiles.userId, input.reviewerUserId)),
    ...(cleanupJobReviewId
      ? [
          db
            .delete(reviewerPhotoCleanupJobs)
            .where(eq(reviewerPhotoCleanupJobs.reviewId, cleanupJobReviewId)),
        ]
      : []),
  ]);
  return review;
}

export async function publishReviewerVisit(
  db: AppDb,
  input: PublishReviewerVisitInput,
) {
  return publishReviewerVisitInternal(db, input);
}

export async function publishReviewerVisitWithPhotos(
  db: AppDb,
  photoBucket: PhotoObjectStore,
  input: PublishReviewerVisitWithPhotosInput,
): Promise<{
  review: Awaited<ReturnType<typeof publishReviewerVisit>>;
  photos: PublishedReviewerPhoto[];
}> {
  // Authentication and content contracts precede cleanup plans and R2 writes.
  await requireActiveReviewer(db, input.reviewerUserId);
  await requireReviewablePlace(db, input.placeId);
  await requireReviewerCurrentSlot(db, {
    reviewerUserId: input.reviewerUserId,
    placeId: input.placeId,
    reviewId: input.id,
  });
  validateVisitDeclaration(input, input.now);
  const metadata = validatePhotoMetadata(input.photoMetadata ?? [], input.now);
  if (
    metadata.length !== input.photos.length ||
    input.photos.some((p) => !metadata.some((m) => m.position === p.position))
  )
    throw new Error("REVIEW_PHOTO_RIGHTS_INVALID");
  assertBadgeContract({ ...input, publishedPhotoCount: input.photos.length });
  if (input.photos.length === 0) {
    const review = await publishReviewerVisitInternal(db, {
      ...input,
      publishedPhotoCount: 0,
    });
    return { review, photos: [] };
  }

  if (
    await db.query.reviewerVisitReviews.findFirst({
      where: eq(reviewerVisitReviews.id, input.id),
      columns: { id: true },
    })
  )
    throw new Error("REVIEW_ID_EXISTS");
  assertReviewerPhotoStorageInput({ reviewId: input.id, photos: input.photos });
  const objectKeys = input.photos.map((photo) =>
    getReviewerPhotoObjectKey(input.id, photo.id),
  );
  const nextAttemptAt = new Date(
    Date.parse(input.now) + 15 * 60 * 1000,
  ).toISOString();
  // Persist planned keys before the first R2 call. Some provider failures are
  // ambiguous: an object may have been written even though `put` rejects.
  await db.insert(reviewerPhotoCleanupJobs).values({
    reviewId: input.id,
    objectKeysJson: JSON.stringify(objectKeys),
    nextAttemptAt,
    attemptCount: 0,
    createdAt: input.now,
    updatedAt: input.now,
  });

  try {
    const storedPhotos = await storeReviewerPhotos(photoBucket, {
      reviewId: input.id,
      photos: input.photos,
    });
    const review = await publishReviewerVisitInternal(
      db,
      {
        ...input,
        publishedPhotoCount: storedPhotos.length,
      },
      storedPhotos,
      input.id,
    );
    return {
      review,
      photos: storedPhotos.map((photo) => ({
        id: photo.id,
        url: `/review-photos/${photo.id}?preview=1`,
      })),
    };
  } catch (error) {
    // A D1 request can lose its response after the atomic batch committed. In
    // Confirm immutable submission identity and exact photo metadata, independently
    // of later moderation. Compensation may delete only unreferenced ORPHAN keys.
    const committed = await readCommittedPhotoPublish(
      db,
      input,
      objectKeys,
    ).catch(() => null);
    if (committed) return committed;
    try {
      await cleanupUncommittedReviewerPhotoUpload(db, photoBucket, input.id);
    } catch {
      // Do not log keys, names, or user data. The job is the recovery source.
      console.error("REVIEW_PHOTO_COMPENSATION_PENDING", {
        photoCount: objectKeys.length,
      });
    }
    throw error;
  }
}

export async function listReviewerVisitHistory(
  db: AppDb,
  reviewerUserId: string,
  limit = 8,
  before?: ReviewerHistoryCursor,
) {
  const reviews = await db
    .select({
      ...getTableColumns(reviewerVisitReviews),
      id: reviewerVisitReviews.id,
      placeId: reviewerVisitReviews.placeId,
      placeSlug: places.slug,
      placeName: places.name,
      categoryId: reviewerVisitReviews.categoryId,
      categoryName: categories.name,
      evaluation: reviewerVisitReviews.evaluation,
      badgesJson: reviewerVisitReviews.badgesJson,
      photoCount: reviewerVisitReviews.photoCount,
      goldenPickEventId: reviewerVisitReviews.goldenPickEventId,
      version: reviewerVisitReviews.version,
      publishedAt: reviewerVisitReviews.publishedAt,
    })
    .from(reviewerVisitReviews)
    .innerJoin(places, eq(places.id, reviewerVisitReviews.placeId))
    .innerJoin(categories, eq(categories.id, reviewerVisitReviews.categoryId))
    .where(
      and(
        eq(reviewerVisitReviews.reviewerUserId, reviewerUserId),
        reviewCursorCondition(before),
      ),
    )
    .orderBy(
      desc(reviewerVisitReviews.updatedAt),
      desc(reviewerVisitReviews.id),
    )
    .limit(Math.max(1, Math.min(limit, 50)));
  if (reviews.length === 0) return [];

  const photos = await db
    .select({
      contentVersion: reviewerVisitPhotos.contentVersion,
      takenOn: reviewerVisitPhotos.takenOn,
      rightsBasis: reviewerVisitPhotos.rightsBasis,
      rightsNote: reviewerVisitPhotos.rightsNote,
      caption: reviewerVisitPhotos.caption,
      privacyChecked: reviewerVisitPhotos.privacyChecked,
      id: reviewerVisitPhotos.id,
      reviewId: reviewerVisitPhotos.reviewId,
      position: reviewerVisitPhotos.position,
    })
    .from(reviewerVisitPhotos)
    .where(
      inArray(
        reviewerVisitPhotos.reviewId,
        reviews.map((review) => review.id),
      ),
    )
    .orderBy(reviewerVisitPhotos.position);
  const photosByReviewId = new Map<
    string,
    Array<(typeof photos)[number] & { url: string }>
  >();
  for (const photo of photos) {
    const current = photosByReviewId.get(photo.reviewId) ?? [];
    current.push({ ...photo, url: `/review-photos/${photo.id}?preview=1` });
    photosByReviewId.set(photo.reviewId, current);
  }
  const deletions = await db
    .select({ reviewId: reviewerPhotoCleanupJobs.reviewId })
    .from(reviewerPhotoCleanupJobs)
    .where(
      and(
        inArray(
          reviewerPhotoCleanupJobs.reviewId,
          reviews.map((r) => r.id),
        ),
        eq(reviewerPhotoCleanupJobs.purpose, "DELETE"),
      ),
    );
  return reviews.map((review) => ({
    ...review,
    cleanupPending: deletions.some((d) => d.reviewId === review.id),
    photos: photosByReviewId.get(review.id) ?? [],
  }));
}

export async function listPublishedPlaceReviewPhotos(
  db: AppDb,
  placeId: string,
  limit = 12,
) {
  const rows = await db
    .select({
      id: reviewerVisitPhotos.id,
      reviewId: reviewerVisitPhotos.reviewId,
      position: reviewerVisitPhotos.position,
      publishedAt: reviewerVisitReviews.publishedAt,
    })
    .from(reviewerVisitPhotos)
    .innerJoin(
      reviewerVisitReviews,
      eq(reviewerVisitReviews.id, reviewerVisitPhotos.reviewId),
    )
    .where(
      and(
        eq(reviewerVisitReviews.placeId, placeId),
        eligibleReviewCondition(
          reviewerVisitReviews.id,
          reviewerVisitPhotos.contentVersion,
        ),
      ),
    )
    .orderBy(
      desc(reviewerVisitReviews.publishedAt),
      desc(reviewerVisitReviews.id),
      reviewerVisitPhotos.position,
    )
    .limit(Math.max(1, Math.min(limit, 24)));

  return rows.map((photo) => ({
    ...photo,
    url: `/review-photos/${photo.id}`,
  }));
}
