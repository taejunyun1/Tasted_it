import { env } from "cloudflare:workers";
import { and, asc, eq } from "drizzle-orm";
import type { Route } from "./+types/reviewer-ratings";

import { ReviewerVisitFlow } from "../components/reviewer-visit-flow";
import { createDb } from "../db/client.server";
import { categories, placeCategories, places } from "../db/schema";
import { assertRole } from "../features/auth/guards.server";
import { requireUser } from "../features/auth/session.server";
import { getGoldenPickQuota } from "../features/ratings/golden-pick.server";
import {
  REVIEWER_BADGE_CATALOG,
} from "../features/ratings/reviewer-visit";
import {
  listReviewerVisitHistory,
} from "../features/ratings/reviewer-visit.server";
import { publishReviewerRatingRequest } from "../features/ratings/reviewer-visit-publish.server";

export async function loader({ request }: Route.LoaderArgs) {
  const user = await requireUser(request);
  assertRole(user.role, ["REVIEWER"]);
  const db = createDb(env.DB);
  const now = new Date().toISOString();
  const [placeRows, categoryRows, history, goldenQuota] = await Promise.all([
    db.select({
      placeId: places.id,
      placeName: places.name,
      neighborhood: places.neighborhood,
      categoryId: categories.id,
      categoryName: categories.name,
      categoryEmoji: categories.emoji,
    }).from(places)
      .innerJoin(placeCategories, and(eq(placeCategories.placeId, places.id), eq(placeCategories.isPrimary, true)))
      .innerJoin(categories, eq(categories.id, placeCategories.categoryId))
      .where(eq(places.status, "PUBLISHED"))
      .orderBy(asc(places.name)),
    db.select({ id: categories.id, name: categories.name, emoji: categories.emoji })
      .from(categories)
      .where(eq(categories.isActive, true))
      .orderBy(asc(categories.sortOrder)),
    listReviewerVisitHistory(db, user.id, 12),
    getGoldenPickQuota(db, user.id, now),
  ]);
  const reviewableNames = new Set(Object.keys(REVIEWER_BADGE_CATALOG));
  const reviewCategories = categoryRows.filter((category) => reviewableNames.has(category.name));
  const reviewCategoryIds = new Set(reviewCategories.map((category) => category.id));
  const reviewPlaces = placeRows.filter((place) => reviewCategoryIds.has(place.categoryId));
  const requestedPublishedId = new URL(request.url).searchParams.get("published");
  const publishedReviewId = history.some((review) => review.id === requestedPublishedId) ? requestedPublishedId : null;
  const requestedNotice = new URL(request.url).searchParams.get("notice");
  const notice: "review-published" | "review-with-photos-published" | null = publishedReviewId
    && (requestedNotice === "review-published" || requestedNotice === "review-with-photos-published")
    ? requestedNotice
    : null;
  return {
    places: reviewPlaces,
    categories: reviewCategories,
    history,
    goldenQuota,
    publishedReviewId,
    notice,
    photoUploadEnabled: env.REVIEW_PHOTO_UPLOAD_ENABLED === "true",
  };
}

export async function action({ request }: Route.ActionArgs) {
  const user = await requireUser(request);
  assertRole(user.role, ["REVIEWER"]);
  return publishReviewerRatingRequest(request, {
    db: createDb(env.DB),
    photoBucket: env.REVIEW_PHOTOS,
    photoUploadEnabled: env.REVIEW_PHOTO_UPLOAD_ENABLED === "true",
    reviewerUserId: user.id,
  });
}

export function meta() {
  return [{ title: "방문 리뷰 발행 — Re:Taste" }];
}

export default function ReviewerRatings({ loaderData }: Route.ComponentProps) {
  return <ReviewerVisitFlow {...loaderData} />;
}
