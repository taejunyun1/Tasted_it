import type { AppDb } from "../../db/client.server";
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
export const MAX_REVIEWER_RATING_REQUEST_BYTES = MAX_REVIEWER_PHOTO_TOTAL_BYTES + 1024 * 1024;

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
]);

function actionError(code: string, status: number) {
  return Response.json({ ok: false, error: code }, { status });
}

function safePublishError(error: unknown) {
  if (error instanceof ReviewerPhotoValidationError) {
    return actionError(error.code, error.code.includes("TOO_LARGE") ? 413 : 400);
  }
  if (error instanceof ReviewerPhotoStorageError) return actionError(error.code, 503);
  if (error instanceof Error && clientValidationCodes.has(error.message)) {
    return actionError(error.message, 400);
  }
  return actionError("REVIEW_PUBLISH_FAILED", 503);
}

function hasSameOrigin(request: Request) {
  const origin = request.headers.get("Origin");
  return origin === new URL(request.url).origin;
}

function preflightRequestSizeError(request: Request) {
  const value = request.headers.get("Content-Length");
  if (value == null) return null;
  if (!/^\d+$/.test(value)) return "REVIEW_SUBMISSION_INVALID";
  return Number(value) > MAX_REVIEWER_RATING_REQUEST_BYTES ? "PHOTO_TOTAL_TOO_LARGE" : null;
}

export async function publishReviewerRatingRequest(
  request: Request,
  dependencies: PublishRequestDependencies,
): Promise<Response> {
  if (!hasSameOrigin(request)) return actionError("REVIEW_ORIGIN_INVALID", 403);
  const requestSizeError = preflightRequestSizeError(request);
  if (requestSizeError) return actionError(requestSizeError, requestSizeError.includes("TOO_LARGE") ? 413 : 400);

  try {
    const form = await request.formData();
    const submission = parseReviewerVisitSubmission(form);
    const photos = await parseReviewerPhotoFiles(form);
    if (photos.length > 0 && !dependencies.photoUploadEnabled) {
      return actionError("REVIEW_PHOTO_UPLOAD_DISABLED", 409);
    }
    const id = crypto.randomUUID();
    const now = dependencies.now ?? new Date().toISOString();
    if (photos.length > 0) {
      await publishReviewerVisitWithPhotos(dependencies.db, dependencies.photoBucket, {
        id,
        reviewerUserId: dependencies.reviewerUserId,
        ...submission,
        photos,
        now,
      });
    } else {
      await publishReviewerVisit(dependencies.db, {
        id,
        reviewerUserId: dependencies.reviewerUserId,
        ...submission,
        publishedPhotoCount: 0,
        now,
      });
    }
    const notice = photos.length > 0 ? "review-with-photos-published" : "review-published";
    return new Response(null, {
      status: 303,
      headers: { Location: `/reviewer/ratings?published=${encodeURIComponent(id)}&notice=${notice}` },
    });
  } catch (error) {
    return safePublishError(error);
  }
}
