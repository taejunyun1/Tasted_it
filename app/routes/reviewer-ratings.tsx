import { env } from "cloudflare:workers";
import { z } from "zod";
import { and, asc, eq } from "drizzle-orm";
import type { Route } from "./+types/reviewer-ratings";

import { ReviewerVisitFlow } from "../components/reviewer-visit-flow";
import { createDb } from "../db/client.server";
import { categories, placeCategories, places, reviewerProfiles } from "../db/schema";
import { requireUser } from "../features/auth/session.server";
import { isSameOriginMutation } from "../features/http/same-origin";
import { getGoldenPickQuota } from "../features/ratings/golden-pick.server";
import {
  REVIEWER_BADGE_CATALOG,
} from "../features/ratings/reviewer-visit";
import {
  listReviewerVisitHistory,
} from "../features/ratings/reviewer-visit.server";
import { eligibleReviewPlaceCondition } from "../features/ratings/reviewer-publication.server";
import { publishReviewerRatingRequest } from "../features/ratings/reviewer-visit-publish.server";

export const headers: Route.HeadersFunction = () => ({ "Cache-Control": "private, no-store", Vary: "Cookie" });

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
  const reviewer = await db.query.reviewerProfiles.findFirst({ where: eq(reviewerProfiles.userId, user.id) });
  const canSubmit = user.role === "REVIEWER" && reviewer?.status === "ACTIVE";
  const [placeRows, categoryRows, history, goldenQuota] = await Promise.all([
    canSubmit ? db.select({
      placeId: places.id,
      placeName: places.name,
      neighborhood: places.neighborhood,
      categoryId: categories.id,
      categoryName: categories.name,
      categoryEmoji: categories.emoji,
    }).from(places)
      .innerJoin(placeCategories, and(eq(placeCategories.placeId, places.id), eq(placeCategories.isPrimary, true)))
      .innerJoin(categories, eq(categories.id, placeCategories.categoryId))
      .where(eligibleReviewPlaceCondition(places.id))
      .orderBy(asc(places.name)) : [],
    canSubmit ? db.select({ id: categories.id, name: categories.name, emoji: categories.emoji })
      .from(categories)
      .where(eq(categories.isActive, true))
      .orderBy(asc(categories.sortOrder)) : [],
    listReviewerVisitHistory(db, user.id, 12, cursor),
    getGoldenPickQuota(db, user.id, now),
  ]);
  const reviewableNames = new Set(Object.keys(REVIEWER_BADGE_CATALOG));
  const reviewCategories = categoryRows.filter((category) => reviewableNames.has(category.name));
  const reviewCategoryIds = new Set(reviewCategories.map((category) => category.id));
  const reviewPlaces = placeRows.filter((place) => reviewCategoryIds.has(place.categoryId));
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
    places: canSubmit ? reviewPlaces : [],
    categories: reviewCategories,
    history,
    goldenQuota,
    publishedReviewId,
    notice,
    photoUploadEnabled: env.REVIEW_PHOTO_UPLOAD_ENABLED === "true",
  };
}

export async function action({ request }: Route.ActionArgs) {
  if (!isSameOriginMutation(request)) throw new Response("이 요청은 현재 서비스에서 다시 실행해 주세요.", { status: 403, statusText: "FORBIDDEN" });
  const user = await requireUser(request);
  return publishReviewerRatingRequest(request, {
    db: createDb(env.DB),
    photoBucket: env.REVIEW_PHOTOS,
    photoUploadEnabled: env.REVIEW_PHOTO_UPLOAD_ENABLED === "true",
    reviewerUserId: user.id,
  });
}

export function meta() {
  return [{ title: "방문 리뷰 제출 — Re:Taste" }];
}

export default function ReviewerRatings({ loaderData }: Route.ComponentProps) {
  return <ReviewerVisitFlow {...loaderData} />;
}
