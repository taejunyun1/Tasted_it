import { and, desc, eq } from "drizzle-orm";
import type { AppDb } from "../../db/client.server";
import { categories, currentVotes, placeCategories, places, savedPlaces } from "../../db/schema";

const fields = {
  id: places.id, slug: places.slug, name: places.name, neighborhood: places.neighborhood,
  categoryName: categories.name, categoryEmoji: categories.emoji,
};

export async function listMemberTaste(db: AppDb, userId: string) {
  const saved = await db.select({ ...fields, savedAt: savedPlaces.createdAt }).from(savedPlaces)
    .innerJoin(places, eq(places.id, savedPlaces.placeId))
    .innerJoin(placeCategories, and(eq(placeCategories.placeId, places.id), eq(placeCategories.isPrimary, true)))
    .innerJoin(categories, eq(categories.id, placeCategories.categoryId))
    .where(and(eq(savedPlaces.userId, userId), eq(places.status, "PUBLISHED"))).orderBy(desc(savedPlaces.createdAt));
  const rated = await db.select({ ...fields, value: currentVotes.value, ratedAt: currentVotes.updatedAt }).from(currentVotes)
    .innerJoin(places, eq(places.id, currentVotes.placeId))
    .innerJoin(placeCategories, and(eq(placeCategories.placeId, places.id), eq(placeCategories.isPrimary, true)))
    .innerJoin(categories, eq(categories.id, placeCategories.categoryId))
    .where(and(eq(currentVotes.userId, userId), eq(places.status, "PUBLISHED"))).orderBy(desc(currentVotes.updatedAt));
  return { saved, rated };
}
