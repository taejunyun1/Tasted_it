import { and, desc, eq, lt, or, sql } from "drizzle-orm";
import { z } from "zod";
import type { AppDb } from "../../db/client.server";
import {
  categories,
  currentVotes,
  goldenPickEvents,
  places,
  reviewerProfiles,
  reviewerPhotoCleanupJobs,
  reviewerReviewTransitions,
  reviewerVisitPhotos,
  reviewerVisitReviews,
  users,
  voteEvents,
} from "../../db/schema";
import {
  eligibleReviewCondition,
  reviewerSubmissionPlaceCondition,
  REVIEWER_PUBLICATION_RULE,
} from "./reviewer-publication.server";
import { prepareGoldenPickGrant } from "./golden-pick.server";
import { reviewerEvaluationToVoteValue } from "./reviewer-visit";
import {
  buildReviewerPhotoDeletionPlan,
  recoverPendingReviewerPhotoCleanup,
} from "./reviewer-photo-deletion.server";
import type { PhotoObjectStore } from "./reviewer-photo.server";

export type ReviewerHistoryCursor = { updatedAt: string; id: string };
export function reviewCursorCondition(cursor?: ReviewerHistoryCursor) {
  if (!cursor) return undefined;
  if (
    !Number.isFinite(Date.parse(cursor.updatedAt)) ||
    !cursor.id ||
    cursor.id.length > 128
  )
    throw new Error("REVIEW_CURSOR_INVALID");
  return or(
    lt(reviewerVisitReviews.updatedAt, cursor.updatedAt),
    and(
      eq(reviewerVisitReviews.updatedAt, cursor.updatedAt),
      lt(reviewerVisitReviews.id, cursor.id),
    ),
  );
}

export type ReviewerVisitStatus =
  typeof reviewerVisitReviews.$inferSelect.status;
export type ReviewerVisitRow = typeof reviewerVisitReviews.$inferSelect;
export type ReviewerPhotoMetadata = {
  photoId?: string;
  position: number;
  takenOn: string;
  rightsBasis: "OWN_WORK" | "PERMISSION";
  rightsNote: string;
  caption: string;
  privacyChecked: true;
};

const visitSchema = z.object({
  visitedOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  visitNote: z.string().trim().min(1).max(1000),
  disclosure: z.enum(["NONE", "DECLARED", "UNKNOWN"]),
});
const metadataSchema = z
  .object({
    photoId: z.string().min(1).max(128).optional(),
    position: z.number().int().min(0).max(4),
    takenOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    rightsBasis: z.enum(["OWN_WORK", "PERMISSION"]),
    rightsNote: z.string().trim().max(1000).default(""),
    caption: z.string().trim().min(1).max(300),
    privacyChecked: z.literal(true),
  })
  .strict();

function validDay(value: string, now: string) {
  return (
    Number.isFinite(Date.parse(value)) &&
    new Date(`${value}T00:00:00.000Z`).toISOString().slice(0, 10) === value &&
    value <=
      new Date(Date.parse(now) + 9 * 60 * 60 * 1000).toISOString().slice(0, 10)
  );
}
export function validateVisitDeclaration(input: unknown, now: string) {
  const result = visitSchema.safeParse(input);
  if (!result.success || !validDay(result.data.visitedOn, now))
    throw new Error("REVIEW_VISIT_INVALID");
  return result.data;
}
export function validatePhotoMetadata(
  input: unknown,
  now: string,
): ReviewerPhotoMetadata[] {
  const parsed = z.array(metadataSchema).max(5).safeParse(input);
  if (!parsed.success) throw new Error("REVIEW_PHOTO_RIGHTS_INVALID");
  const rows = parsed.data;
  if (
    new Set(rows.map((r) => r.position)).size !== rows.length ||
    rows.some(
      (r) =>
        !validDay(r.takenOn, now) ||
        (r.rightsBasis === "PERMISSION" && !r.rightsNote),
    )
  )
    throw new Error("REVIEW_PHOTO_RIGHTS_INVALID");
  return rows;
}
function reason(input: string) {
  const value = input.trim();
  if (!value || value.length > 1000) throw new Error("REVIEW_REASON_REQUIRED");
  return value;
}
function assertVersion(version: number) {
  if (!Number.isSafeInteger(version) || version < 1)
    throw new Error("REVIEW_VERSION_CONFLICT");
}
export async function requireActiveReviewer(db: AppDb, userId: string) {
  const [row] = await db
    .select({ id: users.id })
    .from(users)
    .innerJoin(reviewerProfiles, eq(reviewerProfiles.userId, users.id))
    .where(
      and(
        eq(users.id, userId),
        eq(users.role, "REVIEWER"),
        eq(reviewerProfiles.status, "ACTIVE"),
        sql`not (lower(${users.email}) like 'withdrawn.%@invalid.local')`,
      ),
    )
    .limit(1);
  if (!row) throw new Error("ACTIVE_REVIEWER_REQUIRED");
}
export async function requireReviewablePlace(db: AppDb, placeId: string) {
  const [row] = await db
    .select({ id: places.id })
    .from(places)
    .where(and(eq(places.id, placeId), reviewerSubmissionPlaceCondition()))
    .limit(1);
  if (!row) throw new Error("PUBLISHED_PLACE_REQUIRED");
}
export function reviewTransition(
  db: AppDb,
  input: {
    review: ReviewerVisitRow;
    actorUserId: string;
    operation: "SUBMIT" | "EDIT" | "MODERATE" | "WITHDRAW";
    reason: string;
    after: unknown;
    before?: unknown;
    now: string;
  },
) {
  return db.insert(reviewerReviewTransitions).values({
    id: crypto.randomUUID(),
    reviewId: input.review.id,
    expectedVersion: input.review.version,
    toVersion:
      input.operation === "SUBMIT"
        ? input.review.version
        : input.review.version + 1,
    operation: input.operation,
    actorUserId: input.actorUserId,
    reason: reason(input.reason),
    beforeState:
      input.operation === "SUBMIT"
        ? null
        : JSON.stringify(input.before ?? input.review),
    afterState: JSON.stringify(input.after),
    ruleVersion: REVIEWER_PUBLICATION_RULE,
    createdAt: input.now,
  });
}
async function readReview(db: AppDb, id: string) {
  const row = await db.query.reviewerVisitReviews.findFirst({
    where: eq(reviewerVisitReviews.id, id),
  });
  if (!row) throw new Error("REVIEW_NOT_FOUND");
  return row;
}
async function ownerReview(
  db: AppDb,
  id: string,
  userId: string,
  expectedVersion: number,
) {
  assertVersion(expectedVersion);
  const row = await readReview(db, id);
  if (row.reviewerUserId !== userId) throw new Error("REVIEW_OWNER_REQUIRED");
  if (row.version !== expectedVersion)
    throw new Error("REVIEW_VERSION_CONFLICT");
  return row;
}

export async function requireReviewerCurrentSlot(
  db: AppDb,
  input: { reviewerUserId: string; placeId: string; reviewId?: string },
) {
  const existing = await db.query.reviewerVisitReviews.findFirst({
    where: and(
      eq(reviewerVisitReviews.reviewerUserId, input.reviewerUserId),
      eq(reviewerVisitReviews.placeId, input.placeId),
      eq(reviewerVisitReviews.isCurrent, true),
      input.reviewId
        ? sql`${reviewerVisitReviews.id}<>${input.reviewId}`
        : undefined,
    ),
  });
  if (existing) throw new Error("REVIEW_CURRENT_EXISTS");
}

export async function editReviewerVisit(
  db: AppDb,
  input: {
    reviewId: string;
    reviewerUserId: string;
    expectedVersion: number;
    evaluation: "RECOMMEND" | "HOLD" | "NOT_RECOMMEND";
    badges: string[];
    golden: boolean;
    goldenReason: string | null;
    visitedOn: string;
    visitNote: string;
    disclosure: "NONE" | "DECLARED" | "UNKNOWN";
    photoMetadata: ReviewerPhotoMetadata[];
    reason: string;
    now: string;
  },
) {
  const row = await ownerReview(
    db,
    input.reviewId,
    input.reviewerUserId,
    input.expectedVersion,
  );
  if (
    !["RECOMMEND", "HOLD", "NOT_RECOMMEND"].includes(input.evaluation) ||
    typeof input.golden !== "boolean"
  )
    throw new Error("REVIEW_SUBMISSION_INVALID");
  await requireActiveReviewer(db, input.reviewerUserId);
  await requireReviewablePlace(db, row.placeId);
  await requireReviewerCurrentSlot(db, {
    reviewerUserId: row.reviewerUserId,
    placeId: row.placeId,
    reviewId: row.id,
  });
  const deletion = await db.query.reviewerPhotoCleanupJobs.findFirst({
    where: and(
      eq(reviewerPhotoCleanupJobs.reviewId, row.id),
      eq(reviewerPhotoCleanupJobs.purpose, "DELETE"),
    ),
  });
  if (deletion) throw new Error("REVIEW_PHOTO_DELETE_PENDING");
  const declaration = validateVisitDeclaration(input, input.now);
  const metadata = validatePhotoMetadata(input.photoMetadata, input.now);
  const photos = await db
    .select()
    .from(reviewerVisitPhotos)
    .where(
      and(
        eq(reviewerVisitPhotos.reviewId, row.id),
        eq(reviewerVisitPhotos.contentVersion, row.contentVersion),
      ),
    );
  if (
    photos.length !== metadata.length ||
    photos.some(
      (p) =>
        !metadata.some((m) => m.photoId === p.id && m.position === p.position),
    )
  )
    throw new Error("REVIEW_PHOTO_RIGHTS_INVALID");
  const [category] = await db
    .select({ name: categories.name })
    .from(categories)
    .where(eq(categories.id, row.categoryId))
    .limit(1);
  const { REVIEWER_BADGE_CATALOG } = await import("./reviewer-visit");
  const allowed =
    REVIEWER_BADGE_CATALOG[
      category?.name as keyof typeof REVIEWER_BADGE_CATALOG
    ];
  if (
    !allowed ||
    input.badges.length > 2 ||
    new Set(input.badges).size !== input.badges.length ||
    input.badges.some((b) => !allowed.includes(b as never))
  )
    throw new Error("REVIEW_BADGE_INVALID");
  if (
    input.golden &&
    (input.badges.length !== 2 ||
      !input.goldenReason ||
      input.goldenReason.trim().length < 15 ||
      input.goldenReason.trim().length > 100 ||
      photos.length === 0)
  )
    throw new Error("GOLDEN_PICK_PUBLISHED_PHOTO_REQUIRED");
  const base = await db.get<{ id: string }>(
    sql`select id from vote_events where place_id=${row.placeId} and user_id=${row.reviewerUserId} order by rowid desc limit 1`,
  );
  const next = {
    ...declaration,
    evaluation: input.evaluation,
    badgesJson: JSON.stringify(input.badges),
    goldenRequested: input.golden,
    goldenReason: input.golden ? input.goldenReason : null,
    submittedAt: input.now,
    status: "PENDING" as const,
    isCurrent: true,
    contentVersion: row.contentVersion + 1,
    version: row.version + 1,
    approvedContentVersion: null,
    baseEventId: base?.id ?? null,
    reviewedBy: null,
    reviewedAt: null,
    reviewReason: null,
    ruleVersion: null,
    photoCount: photos.length,
    updatedAt: input.now,
  };
  await db.batch([
    reviewTransition(db, {
      review: row,
      actorUserId: input.reviewerUserId,
      operation: "EDIT",
      reason: input.reason,
      before: { ...row, photos },
      after: { ...next, photos: metadata },
      now: input.now,
    }),
    db
      .update(reviewerVisitReviews)
      .set(next)
      .where(eq(reviewerVisitReviews.id, row.id)),
    ...photos.map((p) => {
      const m = metadata.find((m) => m.photoId === p.id)!;
      return db
        .update(reviewerVisitPhotos)
        .set({
          contentVersion: next.contentVersion,
          takenOn: m.takenOn,
          rightsBasis: m.rightsBasis,
          rightsNote: m.rightsNote,
          caption: m.caption,
          privacyChecked: true,
          updatedAt: input.now,
        })
        .where(eq(reviewerVisitPhotos.id, p.id));
    }),
  ]);
  return readReview(db, row.id);
}

export async function withdrawReviewerVisit(
  db: AppDb,
  input: {
    reviewId: string;
    reviewerUserId: string;
    expectedVersion: number;
    reason: string;
    now: string;
    bucket?: Pick<PhotoObjectStore, "delete">;
  },
) {
  const row = await ownerReview(
    db,
    input.reviewId,
    input.reviewerUserId,
    input.expectedVersion,
  );
  const photos = await db
    .select()
    .from(reviewerVisitPhotos)
    .where(eq(reviewerVisitPhotos.reviewId, row.id));
  const next = {
    status: "WITHDRAWN" as const,
    isCurrent: false,
    approvedContentVersion: null,
    version: row.version + 1,
    reviewReason: reason(input.reason),
    updatedAt: input.now,
  };
  const plan = buildReviewerPhotoDeletionPlan(db, {
    reviewId: row.id,
    now: input.now,
  });
  await db.batch([
    reviewTransition(db, {
      review: row,
      actorUserId: input.reviewerUserId,
      operation: "WITHDRAW",
      reason: input.reason,
      before: { ...row, photos },
      after: next,
      now: input.now,
    }),
    db
      .update(reviewerVisitReviews)
      .set(next)
      .where(eq(reviewerVisitReviews.id, row.id)),
    plan,
  ]);
  if (input.bucket)
    await recoverPendingReviewerPhotoCleanup(db, input.bucket, {
      now: input.now,
      reviewId: row.id,
    }).catch(() => undefined);
  return readReview(db, row.id);
}

export async function moderateReviewerVisit(
  db: AppDb,
  input: {
    reviewId: string;
    actorUserId: string;
    expectedVersion: number;
    status: "APPROVED" | "CHANGES_REQUESTED" | "REJECTED" | "WITHDRAWN";
    reason: string;
    checks: {
      visitVerified: boolean;
      rightsVerified: boolean;
      privacyVerified: boolean;
      placeVerified: boolean;
    };
    now: string;
  },
) {
  const actor = await db.query.users.findFirst({
    where: eq(users.id, input.actorUserId),
  });
  if (actor?.role !== "ADMIN") throw new Error("ADMIN_REQUIRED");
  assertVersion(input.expectedVersion);
  const row = await readReview(db, input.reviewId);
  if (row.version !== input.expectedVersion)
    throw new Error("REVIEW_VERSION_CONFLICT");
  if (
    row.status === "APPROVED"
      ? input.status !== "WITHDRAWN"
      : row.status !== "PENDING"
  )
    throw new Error("REVIEW_TRANSITION_INVALID");
  if (
    !["APPROVED", "CHANGES_REQUESTED", "REJECTED", "WITHDRAWN"].includes(
      input.status,
    )
  )
    throw new Error("REVIEW_TRANSITION_INVALID");
  const approval = input.status === "APPROVED";
  let golden: Awaited<ReturnType<typeof prepareGoldenPickGrant>> | null = null;
  let goldenContinuationId: string | null = null;
  if (approval) {
    if (!row.isCurrent) throw new Error("REVIEW_NOT_CURRENT");
    const deletion = await db.query.reviewerPhotoCleanupJobs.findFirst({
      where: and(
        eq(reviewerPhotoCleanupJobs.reviewId, row.id),
        eq(reviewerPhotoCleanupJobs.purpose, "DELETE"),
      ),
    });
    if (deletion) throw new Error("REVIEW_PHOTO_DELETE_PENDING");
    if (
      !z
        .object({
          visitVerified: z.literal(true),
          rightsVerified: z.literal(true),
          privacyVerified: z.literal(true),
          placeVerified: z.literal(true),
        })
        .strict()
        .safeParse(input.checks).success
    )
      throw new Error("REVIEW_CHECKS_REQUIRED");
    validateVisitDeclaration(row, input.now);
    if (row.disclosure !== "NONE")
      throw new Error("REVIEW_DISCLOSURE_UNRESOLVED");
    await requireActiveReviewer(db, row.reviewerUserId);
    await requireReviewablePlace(db, row.placeId);
    const photos = await db
      .select()
      .from(reviewerVisitPhotos)
      .where(
        and(
          eq(reviewerVisitPhotos.reviewId, row.id),
          eq(reviewerVisitPhotos.contentVersion, row.contentVersion),
        ),
      );
    if (photos.length !== row.photoCount)
      throw new Error("REVIEW_PHOTO_RIGHTS_INVALID");
    validatePhotoMetadata(
      photos.map((p) => ({
        photoId: p.id,
        position: p.position,
        takenOn: p.takenOn,
        rightsBasis: p.rightsBasis,
        rightsNote: p.rightsNote ?? "",
        caption: p.caption,
        privacyChecked: p.privacyChecked,
      })),
      input.now,
    );
    if (row.goldenRequested) {
      if (!photos.length)
        throw new Error("GOLDEN_PICK_PUBLISHED_PHOTO_REQUIRED");
      const existing = row.goldenPickEventId
        ? await db.query.goldenPickEvents.findFirst({
            where: eq(goldenPickEvents.id, row.goldenPickEventId),
          })
        : null;
      const closure = existing
        ? await db.query.goldenPickEvents.findFirst({
            where: and(
              eq(goldenPickEvents.previousEventId, existing.id),
              sql`${goldenPickEvents.eventType}<>'GRANT'`,
              sql`${goldenPickEvents.effectiveAt}<=${input.now}`,
            ),
          })
        : null;
      if (
        existing &&
        existing.eventType === "GRANT" &&
        existing.reviewId === row.id &&
        existing.reviewerUserId === row.reviewerUserId &&
        existing.placeId === row.placeId &&
        existing.expiresAt &&
        existing.expiresAt > input.now &&
        existing.effectiveAt <= input.now &&
        !closure
      ) {
        // Re-review the same finite grant without extending it or consuming quota.
        goldenContinuationId = existing.id;
      } else {
        golden = await prepareGoldenPickGrant(db, {
          id: crypto.randomUUID(),
          reviewerUserId: row.reviewerUserId,
          placeId: row.placeId,
          reason: row.goldenReason ?? "",
          now: input.now,
        });
      }
    }
  }
  const next = {
    status: input.status,
    approvedContentVersion: approval ? row.contentVersion : null,
    reviewedBy: input.actorUserId,
    reviewedAt: input.now,
    reviewReason: reason(input.reason),
    ruleVersion: REVIEWER_PUBLICATION_RULE,
    version: row.version + 1,
    updatedAt: input.now,
    ...(approval
      ? { publishedAt: input.now, goldenPickEventId: goldenContinuationId }
      : {}),
  };
  const signal = reviewerEvaluationToVoteValue(row.evaluation);
  const eventId = crypto.randomUUID();
  const adoption = sql`coalesce((select id from vote_events where place_id=${row.placeId} and user_id=${row.reviewerUserId} order by rowid desc limit 1),'')=${row.baseEventId ?? ""}`;
  const insertedVote = db.insert(voteEvents).select(
    db
      .select({
        id: sql<string>`${eventId}`.as("id"),
        placeId: reviewerVisitReviews.placeId,
        userId: reviewerVisitReviews.reviewerUserId,
        value:
          sql<number>`${signal ?? sql`(select value from current_votes where place_id=${row.placeId} and user_id=${row.reviewerUserId})`}`.as(
            "value",
          ),
        source: sql<"REVIEWER">`'REVIEWER'`.as("source"),
        reviewId: reviewerVisitReviews.id,
        reviewVersion: reviewerVisitReviews.contentVersion,
        eventType: sql<
          "CREATE" | "CHANGE" | "WITHDRAW"
        >`${signal == null ? "WITHDRAW" : row.baseEventId ? "CHANGE" : "CREATE"}`.as(
          "event_type",
        ),
        previousEventId: sql<string | null>`${row.baseEventId}`.as(
          "previous_event_id",
        ),
        createdAt: sql<string>`${input.now}`.as("created_at"),
      })
      .from(reviewerVisitReviews)
      .where(
        and(
          eq(reviewerVisitReviews.id, row.id),
          adoption,
          signal === null
            ? sql`exists(select 1 from current_votes where place_id=${row.placeId} and user_id=${row.reviewerUserId})`
            : undefined,
        ),
      ),
  );
  const adoptedVote =
    signal === null
      ? db
          .delete(currentVotes)
          .where(
            and(
              eq(currentVotes.placeId, row.placeId),
              eq(currentVotes.userId, row.reviewerUserId),
              sql`exists(select 1 from vote_events where id=${eventId})`,
            ),
          )
      : db
          .insert(currentVotes)
          .select(
            db
              .select({
                placeId: voteEvents.placeId,
                userId: voteEvents.userId,
                eventId: voteEvents.id,
                value: voteEvents.value,
                updatedAt: voteEvents.createdAt,
              })
              .from(voteEvents)
              .where(eq(voteEvents.id, eventId)),
          )
          .onConflictDoUpdate({
            target: [currentVotes.placeId, currentVotes.userId],
            set: {
              eventId: sql`excluded.event_id`,
              value: sql`excluded.value`,
              updatedAt: sql`excluded.updated_at`,
            },
          });
  const effect = approval
    ? [
        insertedVote,
        adoptedVote,
        ...(golden
          ? [
              db.insert(goldenPickEvents).values({
                ...golden,
                reviewId: row.id,
                reviewVersion: row.contentVersion,
              }),
              db
                .update(reviewerVisitReviews)
                .set({ goldenPickEventId: golden.id })
                .where(eq(reviewerVisitReviews.id, row.id)),
            ]
          : []),
      ]
    : [];
  await db.batch([
    reviewTransition(db, {
      review: row,
      actorUserId: input.actorUserId,
      operation: "MODERATE",
      reason: input.reason,
      after: {
        ...next,
        goldenPickEventId:
          golden?.id ?? next.goldenPickEventId ?? row.goldenPickEventId,
        checks: input.checks,
      },
      now: input.now,
    }),
    db
      .update(reviewerVisitReviews)
      .set(next)
      .where(eq(reviewerVisitReviews.id, row.id)),
    ...effect,
  ]);
  return readReview(db, row.id);
}

export async function listReviewerModerationQueue(
  db: AppDb,
  input: {
    actorUserId: string;
    status?: ReviewerVisitStatus;
    limit?: number;
    before?: ReviewerHistoryCursor;
  },
) {
  const actor = await db.query.users.findFirst({
    where: eq(users.id, input.actorUserId),
  });
  if (actor?.role !== "ADMIN") throw new Error("ADMIN_REQUIRED");
  const rows = await db
    .select({
      review: reviewerVisitReviews,
      reviewerDisplayName: users.displayName,
      placeName: places.name,
      placeSlug: places.slug,
      categoryName: categories.name,
    })
    .from(reviewerVisitReviews)
    .innerJoin(users, eq(users.id, reviewerVisitReviews.reviewerUserId))
    .innerJoin(places, eq(places.id, reviewerVisitReviews.placeId))
    .innerJoin(categories, eq(categories.id, reviewerVisitReviews.categoryId))
    .where(
      and(
        input.status
          ? eq(reviewerVisitReviews.status, input.status)
          : undefined,
        reviewCursorCondition(input.before),
      ),
    )
    .orderBy(
      desc(reviewerVisitReviews.updatedAt),
      desc(reviewerVisitReviews.id),
    )
    .limit(Math.max(1, Math.min(input.limit ?? 50, 100)));
  return Promise.all(
    rows.map(async ({ review, ...context }) => ({
      ...review,
      ...context,
      photos: await db
        .select()
        .from(reviewerVisitPhotos)
        .where(
          and(
            eq(reviewerVisitPhotos.reviewId, review.id),
            eq(reviewerVisitPhotos.contentVersion, review.contentVersion),
          ),
        )
        .then((ps) =>
          ps.map((p) => ({ ...p, url: `/review-photos/${p.id}?preview=1` })),
        ),
    })),
  );
}

export async function getPublicReviewerVisits(
  db: AppDb,
  reviewerUserId: string,
  limit = 12,
) {
  const rows = await db
    .select({
      id: reviewerVisitReviews.id,
      placeId: places.id,
      placeSlug: places.slug,
      placeName: places.name,
      evaluation: reviewerVisitReviews.evaluation,
      badgesJson: reviewerVisitReviews.badgesJson,
      visitedOn: reviewerVisitReviews.visitedOn,
      publishedAt: reviewerVisitReviews.publishedAt,
      contentVersion: reviewerVisitReviews.contentVersion,
    })
    .from(reviewerVisitReviews)
    .innerJoin(places, eq(places.id, reviewerVisitReviews.placeId))
    .where(
      and(
        eq(reviewerVisitReviews.reviewerUserId, reviewerUserId),
        eligibleReviewCondition(reviewerVisitReviews.id),
      ),
    )
    .orderBy(desc(reviewerVisitReviews.publishedAt))
    .limit(Math.max(1, Math.min(limit, 50)));
  return Promise.all(
    rows.map(async (r) => ({
      ...r,
      photos: await db
        .select({
          id: reviewerVisitPhotos.id,
          caption: reviewerVisitPhotos.caption,
        })
        .from(reviewerVisitPhotos)
        .where(
          and(
            eq(reviewerVisitPhotos.reviewId, r.id),
            eq(reviewerVisitPhotos.contentVersion, r.contentVersion),
          ),
        )
        .then((ps) => ps.map((p) => ({ ...p, url: `/review-photos/${p.id}` }))),
    })),
  );
}
