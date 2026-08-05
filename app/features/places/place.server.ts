import { and, asc, eq, gte, like, lte, or, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/sqlite-core";
import type { BatchItem } from "drizzle-orm/batch";

import type { AppDb } from "../../db/client.server";
import {
  categories,
  currentVotes,
  placeCategories,
  places,
} from "../../db/schema";
import type {
  AdminPlaceSummary,
  PlaceDetail,
  PlaceFilters,
  PlaceImportRow,
  PlaceSummary,
} from "./place.types";

interface UpsertPlaceInput {
  id: string;
  row: PlaceImportRow;
  now: string;
}

export async function listAdminPlaces(
  db: AppDb,
): Promise<AdminPlaceSummary[]> {
  return db
    .select({
      id: places.id,
      slug: places.slug,
      name: places.name,
      status: places.status,
      categoryName: categories.name,
      updatedAt: places.updatedAt,
    })
    .from(places)
    .innerJoin(placeCategories, eq(placeCategories.placeId, places.id))
    .innerJoin(categories, eq(categories.id, placeCategories.categoryId))
    .where(eq(placeCategories.isPrimary, true))
    .orderBy(asc(places.name), asc(places.id));
}

export async function importPlaceRows(
  db: AppDb,
  input: { rows: PlaceImportRow[]; ids: string[]; now: string },
): Promise<void> {
  if (input.rows.length !== input.ids.length) {
    throw new Error("PLACE_IMPORT_ID_COUNT_MISMATCH");
  }

  const statements: BatchItem<"sqlite">[] = [];
  for (const [index, row] of input.rows.entries()) {
    const [existing, category] = await Promise.all([
      db.query.places.findFirst({ where: eq(places.slug, row.slug) }),
      db.query.categories.findFirst({
        where: eq(categories.slug, row.primaryCategory),
      }),
    ]);
    if (!category) throw new Error(`PRIMARY_CATEGORY_NOT_FOUND:${row.primaryCategory}`);

    const id = existing?.id ?? input.ids[index];
    const values = {
      id,
      slug: row.slug,
      name: row.name,
      status: row.status,
      address: row.address,
      neighborhood: row.neighborhood,
      latitude: row.latitude,
      longitude: row.longitude,
      phone: row.phone,
      parkingSummary: row.parkingSummary,
      heroImageUrl: row.heroImageUrl,
      kakaoPlaceId: row.kakaoPlaceId,
      searchText: row.searchText,
      createdAt: existing?.createdAt ?? input.now,
      updatedAt: input.now,
    };

    statements.push(
      db
        .insert(places)
        .values(values)
        .onConflictDoUpdate({
          target: places.slug,
          set: {
            name: values.name,
            status: values.status,
            address: values.address,
            neighborhood: values.neighborhood,
            latitude: values.latitude,
            longitude: values.longitude,
            phone: values.phone,
            parkingSummary: values.parkingSummary,
            heroImageUrl: values.heroImageUrl,
            kakaoPlaceId: values.kakaoPlaceId,
            searchText: values.searchText,
            updatedAt: values.updatedAt,
          },
        }),
      db
        .insert(placeCategories)
        .values({ placeId: id, categoryId: category.id, isPrimary: true })
        .onConflictDoUpdate({
          target: [placeCategories.placeId, placeCategories.categoryId],
          set: { isPrimary: true },
        }),
    );
  }

  const [first, ...rest] = statements;
  if (first) await db.batch([first, ...rest]);
}

function publicConditions(filters: PlaceFilters, slug?: string) {
  const conditions = [
    eq(places.status, "PUBLISHED"),
    eq(placeCategories.isPrimary, true),
  ];

  if (slug) conditions.push(eq(places.slug, slug));
  if (filters.categorySlug) {
    conditions.push(eq(categories.slug, filters.categorySlug));
  }
  if (filters.query?.trim()) {
    const value = `%${filters.query.trim().toLocaleLowerCase("ko-KR")}%`;
    conditions.push(or(like(places.searchText, value), like(places.name, value))!);
  }
  if (filters.bbox) {
    const [west, south, east, north] = filters.bbox;
    conditions.push(
      gte(places.longitude, west),
      lte(places.longitude, east),
      gte(places.latitude, south),
      lte(places.latitude, north),
    );
  }

  return and(...conditions);
}

async function selectPublicPlaces(
  db: AppDb,
  filters: PlaceFilters,
  slug?: string,
): Promise<PlaceDetail[]> {
  const rows = await db
    .select({
      id: places.id,
      slug: places.slug,
      name: places.name,
      address: places.address,
      neighborhood: places.neighborhood,
      latitude: places.latitude,
      longitude: places.longitude,
      phone: places.phone,
      parkingSummary: places.parkingSummary,
      heroImageUrl: places.heroImageUrl,
      kakaoPlaceId: places.kakaoPlaceId,
      categorySlug: categories.slug,
      categoryName: categories.name,
      categoryEmoji: categories.emoji,
      positive: sql<number>`coalesce(sum(case when ${currentVotes.value} = 1 then 1 else 0 end), 0)`,
      negative: sql<number>`coalesce(sum(case when ${currentVotes.value} = -1 then 1 else 0 end), 0)`,
    })
    .from(places)
    .innerJoin(placeCategories, eq(placeCategories.placeId, places.id))
    .innerJoin(categories, eq(categories.id, placeCategories.categoryId))
    .leftJoin(currentVotes, eq(currentVotes.placeId, places.id))
    .where(publicConditions(filters, slug))
    .groupBy(places.id, categories.id)
    .orderBy(asc(places.name), asc(places.id))
    .limit(slug ? 1 : Math.min(filters.limit ?? 100, 100));

  return rows.map((row) => ({
    id: row.id,
    slug: row.slug,
    name: row.name,
    address: row.address,
    neighborhood: row.neighborhood,
    latitude: row.latitude,
    longitude: row.longitude,
    phone: row.phone,
    parkingSummary: row.parkingSummary,
    heroImageUrl: row.heroImageUrl,
    kakaoPlaceId: row.kakaoPlaceId,
    primaryCategory: {
      slug: row.categorySlug,
      name: row.categoryName,
      emoji: row.categoryEmoji,
    },
    positive: Number(row.positive),
    negative: Number(row.negative),
  }));
}

export async function listPlaces(
  db: AppDb,
  filters: PlaceFilters = {},
): Promise<PlaceSummary[]> {
  return selectPublicPlaces(db, filters);
}

export async function listPublicCategoryGroups(db: AppDb) {
  const parents = alias(categories, "category_parents");
  const rows = await db.select({
    parentId: parents.id, parentSlug: parents.slug, parentName: parents.name, parentEmoji: parents.emoji, parentSort: parents.sortOrder,
    id: categories.id, slug: categories.slug, name: categories.name, emoji: categories.emoji, sortOrder: categories.sortOrder,
    count: sql<number>`count(distinct ${places.id})`,
  }).from(categories)
    .innerJoin(parents, eq(parents.id, categories.parentId))
    .innerJoin(placeCategories, and(eq(placeCategories.categoryId, categories.id), eq(placeCategories.isPrimary, true)))
    .innerJoin(places, and(eq(places.id, placeCategories.placeId), eq(places.status, "PUBLISHED")))
    .where(and(eq(categories.isActive, true), eq(parents.isActive, true)))
    .groupBy(categories.id, parents.id).orderBy(asc(parents.sortOrder), asc(categories.sortOrder));
  const groups = new Map<string, { id: string; slug: string; name: string; emoji: string; children: Array<{ id: string; slug: string; name: string; emoji: string; count: number }> }>();
  for (const row of rows) {
    if (!groups.has(row.parentId)) groups.set(row.parentId, { id: row.parentId, slug: row.parentSlug, name: row.parentName, emoji: row.parentEmoji, children: [] });
    groups.get(row.parentId)!.children.push({ id: row.id, slug: row.slug, name: row.name, emoji: row.emoji, count: Number(row.count) });
  }
  return [...groups.values()];
}

export async function getPlaceBySlug(
  db: AppDb,
  slug: string,
): Promise<PlaceDetail> {
  const [place] = await selectPublicPlaces(db, {}, slug);
  if (!place) {
    throw new Response("Place not found", {
      status: 404,
      statusText: "PLACE_NOT_FOUND",
    });
  }
  return place;
}

export async function upsertPlace(
  db: AppDb,
  input: UpsertPlaceInput,
): Promise<{ id: string }> {
  const existing = await db.query.places.findFirst({
    where: eq(places.slug, input.row.slug),
  });
  const category = await db.query.categories.findFirst({
    where: eq(categories.slug, input.row.primaryCategory),
  });
  if (!category) throw new Error("PRIMARY_CATEGORY_NOT_FOUND");

  const id = existing?.id ?? input.id;
  const values = {
    id,
    slug: input.row.slug,
    name: input.row.name,
    status: input.row.status,
    address: input.row.address,
    neighborhood: input.row.neighborhood,
    latitude: input.row.latitude,
    longitude: input.row.longitude,
    phone: input.row.phone,
    parkingSummary: input.row.parkingSummary,
    heroImageUrl: input.row.heroImageUrl,
    kakaoPlaceId: input.row.kakaoPlaceId,
    searchText: input.row.searchText,
    createdAt: existing?.createdAt ?? input.now,
    updatedAt: input.now,
  };

  await db.batch([
    db
      .insert(places)
      .values(values)
      .onConflictDoUpdate({
        target: places.slug,
        set: {
          name: values.name,
          status: values.status,
          address: values.address,
          neighborhood: values.neighborhood,
          latitude: values.latitude,
          longitude: values.longitude,
          phone: values.phone,
          parkingSummary: values.parkingSummary,
          heroImageUrl: values.heroImageUrl,
          kakaoPlaceId: values.kakaoPlaceId,
          searchText: values.searchText,
          updatedAt: values.updatedAt,
        },
      }),
    db
      .insert(placeCategories)
      .values({ placeId: id, categoryId: category.id, isPrimary: true })
      .onConflictDoUpdate({
        target: [placeCategories.placeId, placeCategories.categoryId],
        set: { isPrimary: true },
      }),
  ]);

  return { id };
}
