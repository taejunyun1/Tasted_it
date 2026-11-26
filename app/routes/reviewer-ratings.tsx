import { env } from "cloudflare:workers";
import { z } from "zod";
import { asc, eq } from "drizzle-orm";
import type { Route } from "./+types/reviewer-ratings";

import { ReviewerVisitFlow } from "../components/reviewer-visit-flow";
import { createDb, type AppDb } from "../db/client.server";
import { categories, reviewerProfiles } from "../db/schema";
import { requireUser, type SessionUser } from "../features/auth/session.server";
import { isSameOriginMutation } from "../features/http/same-origin";
import { getGoldenPickQuota } from "../features/ratings/golden-pick.server";
import {
  REVIEWER_BADGE_CATALOG,
} from "../features/ratings/reviewer-visit";
import {
  listReviewerVisitHistory,
} from "../features/ratings/reviewer-visit.server";
import { publishReviewerRatingRequest } from "../features/ratings/reviewer-visit-publish.server";
import { listReviewerPlacePage } from "../features/ratings/reviewer-place-search.server";
import { parseReviewerPlaceSearch, ReviewerPlaceSearchInputError } from "../features/ratings/reviewer-place-search";
import { canUploadReviewerPhotos } from "../features/students/reviewer-photo-pilot.server";

export const headers: Route.HeadersFunction = () => ({ "Cache-Control": "private, no-store", Vary: "Cookie" });

function photoUploadAvailable(db: AppDb, user: SessionUser, now: string) {
  return canUploadReviewerPhotos(db, {
    user,
    now,
    globalEnabled: env.REVIEW_PHOTO_UPLOAD_ENABLED,
    studentWorkspaceEnabled: env.STUDENT_WORKSPACE_ENABLED,
    pilotSeats: env.STUDENT_REVIEWER_PHOTO_PILOT_SEATS,
  });
}

export async function loader({ request }: Route.LoaderArgs) {
  const user = await requireUser(request);
  const db = createDb(env.DB);
  const search = new URL(request.url).searchParams;
  const before = search.has("beforeUpdatedAt") || search.has("beforeId") ? z.object({
    updatedAt: z.string().datetime({ offset: true }).max(40), id: z.string().min(1).max(128),
  }).safeParse({ updatedAt: search.get("beforeUpdatedAt"), id: search.get("beforeId") }) : null;
  if (before && !before.success) throw new Response("기록 페이지 주소를 다시 확인해 주세요.", { status: 400 });
  const cursor = before?.success ? before.data : undefined;
  const now = new Date().toISOString();
  const reviewer = await db.query.reviewerProfiles.findFirst({
    where: eq(reviewerProfiles.userId, user.id),
    columns: { status: true },
  });
  const canSubmit = user.role === "REVIEWER" && reviewer?.status === "ACTIVE";
  let placeInput;
  try { placeInput = parseReviewerPlaceSearch(search); } catch (error) { if (error instanceof ReviewerPlaceSearchInputError) throw new Response("장소 검색 조건을 확인해 주세요.", { status: 400 }); throw error; }
  const [placeResult, categoryRows, history, goldenQuota, photoUploadEnabled] = await Promise.all([
    canSubmit ? listReviewerPlacePage(db, user.id, placeInput) : { page: { query: "", places: [], nextCursor: null }, selectedPlace: null },
    canSubmit ? db.select({ id: categories.id, name: categories.name, emoji: categories.emoji })
      .from(categories)
      .where(eq(categories.isActive, true))
      .orderBy(asc(categories.sortOrder)) : [],
    listReviewerVisitHistory(db, user.id, 12, cursor),
    getGoldenPickQuota(db, user.id, now),
    canSubmit && photoUploadAvailable(db, user, now),
  ]);
  const reviewableNames = new Set(Object.keys(REVIEWER_BADGE_CATALOG));
  const reviewCategories = categoryRows.filter((category) => reviewableNames.has(category.name));
  const requestedPublishedId = new URL(request.url).searchParams.get("submitted");
  const publishedReviewId = history.some((review) => review.id === requestedPublishedId) ? requestedPublishedId : null;
  const requestedNotice = new URL(request.url).searchParams.get("notice");
  const notice: "review-submitted" | "review-with-photos-submitted" | "review-updated" | "review-withdrawn" | null = publishedReviewId
    && (requestedNotice === "review-submitted" || requestedNotice === "review-with-photos-submitted" || requestedNotice === "review-updated" || requestedNotice === "review-withdrawn")
    ? requestedNotice
    : null;
  const lastReview = history.at(-1);
  const historyNextHref = history.length === 12 && lastReview ? `/reviewer/ratings?${new URLSearchParams({ beforeUpdatedAt: lastReview.updatedAt, beforeId: lastReview.id })}` : null;
  return {
    canSubmit,
    historyNextHref,
    historyHasCursor: Boolean(cursor),
    places: placeResult.page.places,
    placePage: placeResult.page,
    categories: reviewCategories,
    history,
    goldenQuota,
    publishedReviewId,
    notice,
    photoUploadEnabled,
  };
}

export async function action({ request }: Route.ActionArgs) {
  if (!isSameOriginMutation(request)) throw new Response("이 요청은 현재 서비스에서 다시 실행해 주세요.", { status: 403, statusText: "FORBIDDEN" });
  const user = await requireUser(request);
  const db = createDb(env.DB);
  const now = new Date().toISOString();
  return publishReviewerRatingRequest(request, {
    db,
    photoBucket: env.REVIEW_PHOTOS,
    photoUploadEnabled: await photoUploadAvailable(db, user, now),
    reviewerUserId: user.id,
    now,
  });
}

export function meta() {
  return [{ title: "방문 리뷰 제출 — Re:Taste" }];
}

export default function ReviewerRatings({ loaderData }: Route.ComponentProps) {
  return <ReviewerVisitFlow {...loaderData} />;
}
