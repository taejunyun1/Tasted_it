import { and, eq } from "drizzle-orm";
import { categories, reviewerVisitReviews } from "../../db/schema";
import {
  editReviewerVisit,
  withdrawReviewerVisit,
  validatePhotoMetadata,
} from "./reviewer-moderation.server";
import type { AppDb } from "../../db/client.server";
import { isSameOriginMutation } from "../http/same-origin";
import {
  ReviewerPhotoValidationError,
  MAX_REVIEWER_PHOTO_TOTAL_BYTES,
  parseReviewerPhotoFiles,
} from "./reviewer-photo";
import {
  ReviewerPhotoStorageError,
  type PhotoObjectStore,
} from "./reviewer-photo.server";
import { parseReviewerVisitSubmission } from "./reviewer-visit";
import {
  publishReviewerVisit,
  publishReviewerVisitWithPhotos,
} from "./reviewer-visit.server";

type PublishRequestDependencies = {
  db: AppDb;
  photoBucket: PhotoObjectStore;
  photoUploadEnabled: boolean;
  reviewerUserId: string;
  now?: string;
};

// A small envelope gives multipart fields and boundaries room without allowing
// an unbounded body to be buffered before `formData()` validates image bytes.
export const MAX_REVIEWER_RATING_REQUEST_BYTES =
  MAX_REVIEWER_PHOTO_TOTAL_BYTES + 1024 * 1024;

const clientValidationCodes = new Set([
  "REVIEW_SUBMISSION_INVALID",
  "REVIEW_FIELD_UNKNOWN",
  "REVIEW_CATEGORY_INVALID",
  "REVIEW_BADGE_LIMIT",
  "REVIEW_BADGE_INVALID",
  "GOLDEN_PICK_BADGES_REQUIRED",
  "GOLDEN_PICK_REASON_LENGTH",
  "GOLDEN_PICK_PUBLISHED_PHOTO_REQUIRED",
  "REVIEW_PHOTO_UPLOAD_DISABLED",
  "REVIEW_VISIT_INVALID",
  "REVIEW_PHOTO_RIGHTS_INVALID",
  "REVIEW_REASON_REQUIRED",
  "REVIEW_EDIT_PHOTO_UPLOAD_UNSUPPORTED",
]);

function actionError(code: string, status: number) {
  return Response.json({ ok: false, error: code }, { status });
}

function safePublishError(error: unknown) {
  if (error instanceof ReviewerPhotoValidationError) {
    return actionError(
      error.code,
      error.code.includes("TOO_LARGE") ? 413 : 400,
    );
  }
  if (error instanceof ReviewerPhotoStorageError)
    return actionError(error.code, 503);
  const conflicts = [
    "REVIEW_VERSION_CONFLICT",
    "REVIEW_TRANSITION_INVALID",
    "REVIEW_CURRENT_EXISTS",
    "REVIEW_ID_EXISTS",
    "REVIEW_PHOTO_DELETE_PENDING",
  ];
  let cause: unknown = error;
  for (
    let depth = 0;
    depth < 4 && cause instanceof Error;
    depth++, cause = cause.cause
  ) {
    const code = conflicts.find((code) =>
      (cause as Error).message.includes(code),
    );
    if (code) return actionError(code, 409);
  }
  if (
    error instanceof Error &&
    ["REVIEW_OWNER_REQUIRED", "ACTIVE_REVIEWER_REQUIRED"].includes(
      error.message,
    )
  )
    return actionError(error.message, 403);
  if (error instanceof Error && clientValidationCodes.has(error.message)) {
    return actionError(error.message, 400);
  }
  return actionError("REVIEW_PUBLISH_FAILED", 503);
}

function preflightRequestSizeError(request: Request) {
  const value = request.headers.get("Content-Length");
  if (value == null) return null;
  if (!/^\d+$/.test(value)) return "REVIEW_SUBMISSION_INVALID";
  return Number(value) > MAX_REVIEWER_RATING_REQUEST_BYTES
    ? "PHOTO_TOTAL_TOO_LARGE"
    : null;
}

export async function publishReviewerRatingRequest(
  request: Request,
  dependencies: PublishRequestDependencies,
): Promise<Response> {
  if (!isSameOriginMutation(request))
    return actionError("REVIEW_ORIGIN_INVALID", 403);
  const requestSizeError = preflightRequestSizeError(request);
  if (requestSizeError)
    return actionError(
      requestSizeError,
      requestSizeError.includes("TOO_LARGE") ? 413 : 400,
    );

  try {
    const form = await request.formData();
    const intent = String(form.get("intent") ?? "");
    const now = dependencies.now ?? new Date().toISOString();
    const expectedVersion = Number(form.get("expectedVersion"));
    if (intent === "withdraw-review") {
      if (
        [...form.keys()].some(
          (k) =>
            !["intent", "reviewId", "expectedVersion", "reason"].includes(k),
        )
      )
        throw new Error("REVIEW_FIELD_UNKNOWN");
      const id = String(form.get("reviewId") ?? "");
      await withdrawReviewerVisit(dependencies.db, {
        reviewId: id,
        reviewerUserId: dependencies.reviewerUserId,
        expectedVersion,
        reason: String(form.get("reason") ?? ""),
        now,
        bucket: dependencies.photoBucket,
      });
      return new Response(null, {
        status: 303,
        headers: {
          Location: `/reviewer/ratings?submitted=${encodeURIComponent(id)}&notice=review-withdrawn`,
        },
      });
    }
    let canonicalForm = form;
    let editingReviewId: string | null = null;
    if (intent === "edit-review") {
      editingReviewId = String(form.get("reviewId") ?? "");
      const [existing] = await dependencies.db
        .select({ review: reviewerVisitReviews, categoryName: categories.name })
        .from(reviewerVisitReviews)
        .innerJoin(
          categories,
          eq(categories.id, reviewerVisitReviews.categoryId),
        )
        .where(
          and(
            eq(reviewerVisitReviews.id, editingReviewId),
            eq(
              reviewerVisitReviews.reviewerUserId,
              dependencies.reviewerUserId,
            ),
          ),
        )
        .limit(1);
      if (!existing) throw new Error("REVIEW_OWNER_REQUIRED");
      canonicalForm = new FormData();
      for (const [k, v] of form.entries())
        if (!["reviewId", "expectedVersion", "reason"].includes(k))
          canonicalForm.append(k, v);
      canonicalForm.set("intent", "publish-review");
      canonicalForm.set("placeId", existing.review.placeId);
      canonicalForm.set("categoryId", existing.review.categoryId);
      canonicalForm.set("categoryName", existing.categoryName);
    }
    const submission = parseReviewerVisitSubmission(canonicalForm);
    const photos = await parseReviewerPhotoFiles(form);
    if (photos.length > 0 && !dependencies.photoUploadEnabled) {
      return actionError("REVIEW_PHOTO_UPLOAD_DISABLED", 409);
    }
    const id = crypto.randomUUID();
    const metadataText = String(form.get("photoMetadata") ?? "[]");
    if (metadataText.length > 10000)
      throw new Error("REVIEW_PHOTO_RIGHTS_INVALID");
    let rawMetadata: unknown;
    try {
      rawMetadata = JSON.parse(metadataText);
    } catch {
      throw new Error("REVIEW_PHOTO_RIGHTS_INVALID");
    }
    const photoMetadata = validatePhotoMetadata(rawMetadata, now);
    if (editingReviewId) {
      if (photos.length)
        throw new Error("REVIEW_EDIT_PHOTO_UPLOAD_UNSUPPORTED");
      await editReviewerVisit(dependencies.db, {
        reviewId: editingReviewId,
        reviewerUserId: dependencies.reviewerUserId,
        expectedVersion,
        ...submission,
        photoMetadata,
        reason: String(form.get("reason") ?? ""),
        now,
      });
      return new Response(null, {
        status: 303,
        headers: {
          Location: `/reviewer/ratings?submitted=${encodeURIComponent(editingReviewId)}&notice=review-updated`,
        },
      });
    }
    if (photos.length > 0) {
      await publishReviewerVisitWithPhotos(
        dependencies.db,
        dependencies.photoBucket,
        {
          id,
          reviewerUserId: dependencies.reviewerUserId,
          ...submission,
          photoMetadata,
          photos,
          now,
        },
      );
    } else {
      await publishReviewerVisit(dependencies.db, {
        id,
        reviewerUserId: dependencies.reviewerUserId,
        ...submission,
        photoMetadata,
        publishedPhotoCount: 0,
        now,
      });
    }
    const notice =
      photos.length > 0 ? "review-with-photos-submitted" : "review-submitted";
    return new Response(null, {
      status: 303,
      headers: {
        Location: `/reviewer/ratings?submitted=${encodeURIComponent(id)}&notice=${notice}`,
      },
    });
  } catch (error) {
    return safePublishError(error);
  }
}
