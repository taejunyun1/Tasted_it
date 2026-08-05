import { and, eq, inArray } from "drizzle-orm";

import type { AppDb } from "../../db/client.server";
import { currentVotes, flavorRatings, flavorTemplates, places, reviewerProfiles } from "../../db/schema";

export interface FlavorDimensionResult { key: string; median: number; q1: number; q3: number }

function validateDimensions(dimensions: string[]) {
  if (dimensions.length < 5 || dimensions.length > 7) throw new Error("FLAVOR_DIMENSION_COUNT");
  const normalized = dimensions.map((dimension) => dimension.trim());
  if (normalized.some((dimension) => !dimension) || new Set(normalized).size !== normalized.length) throw new Error("FLAVOR_DIMENSIONS_INVALID");
  return normalized;
}

export async function saveFlavorTemplate(db: AppDb, input: {
  id: string; categoryId: string; version: string; dimensions: string[]; actorUserId: string | null; now: string; activate: boolean;
}) {
  const dimensions = validateDimensions(input.dimensions);
  if (input.activate) await db.update(flavorTemplates).set({ status: "ARCHIVED", updatedAt: input.now }).where(and(eq(flavorTemplates.categoryId, input.categoryId), eq(flavorTemplates.status, "ACTIVE")));
  const template = { id: input.id, categoryId: input.categoryId, version: input.version, dimensionsJson: JSON.stringify(dimensions), status: input.activate ? "ACTIVE" as const : "DRAFT" as const, approvedBy: input.activate ? input.actorUserId : null, approvedAt: input.activate ? input.now : null, createdAt: input.now, updatedAt: input.now };
  await db.insert(flavorTemplates).values(template);
  return template;
}

export async function submitFlavorRating(db: AppDb, input: {
  id: string; reviewerUserId: string; placeId: string; templateId: string; values: Record<string, number>; confidence: "LOW" | "MEDIUM" | "HIGH"; now: string;
}) {
  const reviewer = await db.query.reviewerProfiles.findFirst({ where: eq(reviewerProfiles.userId, input.reviewerUserId) });
  if (!reviewer || reviewer.status !== "ACTIVE") throw new Error("ACTIVE_REVIEWER_REQUIRED");
  const place = await db.query.places.findFirst({ where: eq(places.id, input.placeId) });
  if (!place || place.status !== "PUBLISHED") throw new Error("PUBLISHED_PLACE_REQUIRED");
  const template = await db.query.flavorTemplates.findFirst({ where: eq(flavorTemplates.id, input.templateId) });
  if (!template || template.status !== "ACTIVE") throw new Error("ACTIVE_FLAVOR_TEMPLATE_REQUIRED");
  const dimensions = JSON.parse(template.dimensionsJson) as string[];
  if (Object.keys(input.values).sort().join("|") !== [...dimensions].sort().join("|") || dimensions.some((dimension) => !Number.isInteger(input.values[dimension]) || input.values[dimension] < 1 || input.values[dimension] > 5)) throw new Error("FLAVOR_VALUES_INVALID");
  const rating = { id: input.id, reviewerUserId: input.reviewerUserId, placeId: input.placeId, templateId: input.templateId, valuesJson: JSON.stringify(input.values), confidence: input.confidence, status: "ACTIVE" as const, createdAt: input.now, updatedAt: input.now };
  await db.batch([
    db.insert(flavorRatings).values(rating).onConflictDoUpdate({ target: [flavorRatings.placeId, flavorRatings.reviewerUserId, flavorRatings.templateId], set: { valuesJson: rating.valuesJson, confidence: rating.confidence, status: "ACTIVE", updatedAt: input.now } }),
    db.update(reviewerProfiles).set({ lastActivityAt: input.now, updatedAt: input.now }).where(eq(reviewerProfiles.userId, input.reviewerUserId)),
  ]);
  return rating;
}

function percentile(sorted: number[], fraction: number) {
  const position = (sorted.length - 1) * fraction;
  const index = fraction < 0.5 ? Math.floor(position) : fraction > 0.5 ? Math.ceil(position) : Math.round(position);
  return sorted[index];
}

export async function getPlaceFlavorPrint(db: AppDb, placeId: string) {
  const rows = await db.select({ rating: flavorRatings, template: flavorTemplates }).from(flavorRatings)
    .innerJoin(flavorTemplates, eq(flavorTemplates.id, flavorRatings.templateId))
    .where(and(eq(flavorRatings.placeId, placeId), eq(flavorRatings.status, "ACTIVE"), eq(flavorTemplates.status, "ACTIVE")));
  if (rows.length < 3) return { status: "LEARNING" as const, ratingCount: rows.length, dimensions: [] as FlavorDimensionResult[] };
  const dimensions = JSON.parse(rows[0].template.dimensionsJson) as string[];
  return {
    status: "VISIBLE" as const,
    ratingCount: rows.length,
    templateVersion: rows[0].template.version,
    dimensions: dimensions.map((key) => {
      const values = rows.map(({ rating }) => (JSON.parse(rating.valuesJson) as Record<string, number>)[key]).sort((a, b) => a - b);
      return { key, median: percentile(values, 0.5), q1: percentile(values, 0.25), q3: percentile(values, 0.75) };
    }),
  };
}

export async function getMemberTasteGraph(db: AppDb, userId: string) {
  const recommendations = await db.select({ placeId: currentVotes.placeId }).from(currentVotes)
    .innerJoin(places, eq(places.id, currentVotes.placeId))
    .where(and(eq(currentVotes.userId, userId), eq(currentVotes.value, 1), eq(places.status, "PUBLISHED")));
  const visible = [] as Array<Awaited<ReturnType<typeof getPlaceFlavorPrint>> & { placeId: string }>;
  for (const row of recommendations) {
    const print = await getPlaceFlavorPrint(db, row.placeId);
    if (print.status === "VISIBLE") visible.push({ ...print, placeId: row.placeId });
  }
  if (visible.length < 5) return { status: "LEARNING" as const, placeCount: visible.length, dimensions: [] as Array<{ key: string; value: number }> };
  const values = new Map<string, number[]>();
  for (const print of visible) for (const dimension of print.dimensions) values.set(dimension.key, [...(values.get(dimension.key) ?? []), dimension.median]);
  return { status: "VISIBLE" as const, placeCount: visible.length, dimensions: [...values].map(([key, dimensionValues]) => ({ key, value: dimensionValues.reduce((sum, value) => sum + value, 0) / dimensionValues.length })) };
}
