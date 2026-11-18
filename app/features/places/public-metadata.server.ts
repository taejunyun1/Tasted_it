import { and, asc, eq, sql } from "drizzle-orm";
import type { AppDb } from "../../db/client.server";
import { categories, placeCategories, places } from "../../db/schema";
import { publicConditions } from "./place.server";
import { MAX_SITEMAP_PAGES, SITEMAP_PAGE_SIZE } from "./public-metadata";

function sitemapConditions() {
  return and(publicConditions({}), sql`not exists (
    select 1 from temp_catalog_entries t join temp_catalog_batches b on b.id=t.batch_id
    where t.place_id=${places.id} and b.status='PUBLISHED'
  )`);
}

export async function getPublicSitemapCounts(db: AppDb) {
  const [row] = await db.select({ places: sql<number>`count(distinct ${places.id})`, categories: sql<number>`count(distinct ${categories.id})` })
    .from(places).innerJoin(placeCategories, eq(placeCategories.placeId, places.id)).innerJoin(categories, eq(categories.id, placeCategories.categoryId))
    .where(sitemapConditions());
  return { places: Number(row?.places ?? 0), categories: Number(row?.categories ?? 0) };
}

export async function listPublicSitemapPage(db: AppDb, section: "places" | "categories", page: number): Promise<string[]> {
  if (!Number.isSafeInteger(page) || page < 1 || page > MAX_SITEMAP_PAGES) throw new Error("SITEMAP_PAGE_INVALID");
  const column = section === "places" ? places.slug : categories.slug;
  const rows = await db.selectDistinct({ slug: column })
    .from(places).innerJoin(placeCategories, eq(placeCategories.placeId, places.id)).innerJoin(categories, eq(categories.id, placeCategories.categoryId))
    .where(sitemapConditions()).orderBy(asc(column)).limit(SITEMAP_PAGE_SIZE).offset((page - 1) * SITEMAP_PAGE_SIZE);
  return rows.map(({ slug }) => `/${section === "places" ? "places" : "maps"}/${encodeURIComponent(slug)}`);
}
