import { and, eq, sql } from "drizzle-orm";

import type { AppDb } from "../../db/client.server";
import {
  reviewerVisitPhotos,
  reviewerVisitReviews,
  users,
} from "../../db/schema";
import { isWithdrawnEmail } from "../auth/withdraw";
import { eligibleReviewCondition } from "./reviewer-publication.server";

const photoFields = {
  id: reviewerVisitPhotos.id,
  reviewId: reviewerVisitPhotos.reviewId,
  contentVersion: reviewerVisitPhotos.contentVersion,
  objectKey: reviewerVisitPhotos.objectKey,
  contentType: reviewerVisitPhotos.contentType,
};

export async function getPublicReviewerPhoto(db: AppDb, photoId: string) {
  const [photo] = await db
    .select(photoFields)
    .from(reviewerVisitPhotos)
    .where(
      and(
        eq(reviewerVisitPhotos.id, photoId),
        eligibleReviewCondition(
          reviewerVisitPhotos.reviewId,
          reviewerVisitPhotos.contentVersion,
        ),
      ),
    )
    .limit(1);
  return photo ?? null;
}

/** Private preview requires the authenticated actor's current identity and ownership. */
export async function getReviewerPhotoPreview(
  db: AppDb,
  input: { photoId: string; actorUserId: string },
) {
  const actor = await db.query.users.findFirst({
    where: eq(users.id, input.actorUserId),
  });
  if (!actor || isWithdrawnEmail(actor.email)) return null;
  const [photo] = await db
    .select(photoFields)
    .from(reviewerVisitPhotos)
    .innerJoin(
      reviewerVisitReviews,
      eq(reviewerVisitReviews.id, reviewerVisitPhotos.reviewId),
    )
    .where(
      and(
        eq(reviewerVisitPhotos.id, input.photoId),
        sql`not exists(select 1 from reviewer_photo_cleanup_jobs where review_id=${reviewerVisitReviews.id} and purpose='DELETE')`,
        actor.role === "ADMIN"
          ? undefined
          : eq(reviewerVisitReviews.reviewerUserId, actor.id),
      ),
    )
    .limit(1);
  return photo ?? null;
}
