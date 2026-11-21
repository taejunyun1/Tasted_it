import { and, asc, eq, gt, isNull, or, sql, type SQL } from "drizzle-orm";
import type { AppDb } from "../../db/client.server";
import { categories, placeCategories, places } from "../../db/schema";
import { publicConditions } from "./place.server";
import { CORRECTION_PLACE_PAGE_SIZE, CorrectionPlaceSearchInputError, correctionPlaceIdSchema, encodeCorrectionPlaceCursor, type CorrectionPlacePage, type CorrectionPlaceSearchInput } from "./correction-place-search";

function eligiblePlaces(db: AppDb, condition?: SQL) {
  // Match the existing correction list and direct-target policy. DISTINCT keeps
  // legacy places with multiple primary categories from occupying several slots.
  return db.selectDistinct({ id: places.id, name: places.name, address: places.address }).from(places)
    .innerJoin(placeCategories, eq(placeCategories.placeId, places.id))
    .innerJoin(categories, eq(categories.id, placeCategories.categoryId))
    .where(and(publicConditions({}), isNull(places.closedAt), condition));
}

export async function readCorrectionPlaceTarget(db: AppDb, rawId: unknown) {
  const parsed = correctionPlaceIdSchema.safeParse(rawId);
  if (!parsed.success) throw new Response("Invalid place", { status: 400 });
  const [place] = await eligiblePlaces(db, eq(places.id, parsed.data)).limit(1);
  if (!place) throw new Response("Place not found", { status: 404 });
  return place;
}

export async function listCorrectionPlacePage(db: AppDb, input: CorrectionPlaceSearchInput): Promise<CorrectionPlacePage> {
  const matches = input.query ? sql`(instr(lower(${places.name}),lower(${input.query}))>0 or instr(lower(${places.address}),lower(${input.query}))>0)` : undefined;
  let after: SQL | undefined;
  if (input.after) {
    const [anchor] = await eligiblePlaces(db, and(matches, eq(places.id, input.after.id))).limit(1);
    if (!anchor) throw new CorrectionPlaceSearchInputError();
    after = or(gt(places.name, anchor.name), and(eq(places.name, anchor.name), gt(places.id, anchor.id)))!;
  }
  const rows = await eligiblePlaces(db, and(matches, after)).orderBy(asc(places.name), asc(places.id)).limit(CORRECTION_PLACE_PAGE_SIZE + 1);
  const page = rows.slice(0, CORRECTION_PLACE_PAGE_SIZE), last = page.at(-1);
  return { query: input.query, places: page, nextCursor: rows.length > CORRECTION_PLACE_PAGE_SIZE && last ? encodeCorrectionPlaceCursor({ query: input.query, id: last.id }) : null };
}
