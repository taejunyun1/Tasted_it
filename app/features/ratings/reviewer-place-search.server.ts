import { and, asc, eq, gt, inArray, or, sql, type SQL } from "drizzle-orm";
import type { AppDb } from "../../db/client.server";
import { categories, placeCategories, places } from "../../db/schema";
import { REVIEWER_BADGE_CATALOG } from "./reviewer-visit";
import { reviewerSubmissionPlaceCondition } from "./reviewer-publication.server";
import { encodeReviewerPlaceCursor, REVIEWER_PLACE_PAGE_SIZE, ReviewerPlaceSearchInputError, type ReviewerPlaceSearchInput, type ReviewerPlaceOption } from "./reviewer-place-search";

export async function listReviewerPlacePage(db: AppDb, userId: string, input: ReviewerPlaceSearchInput) {
  const reviewed = sql<0 | 1>`case when exists(select 1 from reviewer_visit_reviews own_review where own_review.place_id=${places.id} and own_review.reviewer_user_id=${userId}) then 1 else 0 end`;
  const fields = { placeId: places.id, placeName: places.name, address: places.address, neighborhood: places.neighborhood, categoryId: categories.id, categoryName: categories.name, categoryEmoji: categories.emoji, reviewed };
  const base = and(reviewerSubmissionPlaceCondition(), eq(categories.isActive, true), inArray(categories.name, Object.keys(REVIEWER_BADGE_CATALOG)))!;
  // Literal substring matching also handles long Korean queries without D1's
  // LIKE-pattern byte ceiling. User '%' and '_' are ordinary search text.
  const matches = input.query ? sql`(instr(lower(${places.name}),lower(${input.query}))>0 or instr(lower(${places.address}),lower(${input.query}))>0 or instr(lower(coalesce(${places.neighborhood},'')),lower(${input.query}))>0 or instr(lower(${categories.name}),lower(${input.query}))>0)` : undefined;
  const select = (condition?: SQL) => db.select(fields).from(places)
    .innerJoin(placeCategories, and(eq(placeCategories.placeId, places.id), eq(placeCategories.isPrimary, true)))
    .innerJoin(categories, eq(categories.id, placeCategories.categoryId)).where(and(base, condition));
  let after: SQL | undefined;
  if (input.after) {
    const [anchor] = await select(and(matches, eq(places.id, input.after.id))).limit(1);
    if (!anchor || anchor.reviewed !== input.after.reviewed) throw new ReviewerPlaceSearchInputError();
    after = or(gt(reviewed, anchor.reviewed), and(eq(reviewed, anchor.reviewed), or(gt(places.name, anchor.placeName), and(eq(places.name, anchor.placeName), gt(places.id, anchor.placeId)))))!;
  }
  const rows = await select(and(matches, after)).orderBy(asc(reviewed), asc(places.name), asc(places.id)).limit(REVIEWER_PLACE_PAGE_SIZE + 1);
  const pageRows = rows.slice(0, REVIEWER_PLACE_PAGE_SIZE), last = pageRows.at(-1);
  const option = ({ reviewed: _reviewed, ...row }: (typeof rows)[number]): ReviewerPlaceOption => row;
  const selected = input.selectedId ? pageRows.find((row) => row.placeId === input.selectedId) ?? (await select(eq(places.id, input.selectedId)).limit(1))[0] : undefined;
  return {
    page: { query: input.query, places: pageRows.map(option), nextCursor: rows.length > REVIEWER_PLACE_PAGE_SIZE && last ? encodeReviewerPlaceCursor({ query: input.query, id: last.placeId, reviewed: last.reviewed }) : null },
    selectedPlace: selected ? option(selected) : null,
  };
}
