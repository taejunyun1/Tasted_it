import { and, asc, eq, inArray, sql } from "drizzle-orm";

import type { AppDb } from "../../db/client.server";
import { adminAuditLogs, categories, placeCategories, placeDuplicateCandidates, placeRevisions, places, placeSuggestions, reviewerApplications, users } from "../../db/schema";
import { classifyPlaceDuplicate, normalizePlaceIdentity, type PlaceIdentityInput } from "./place-duplicate-policy";
import { slugifyPlaceName } from "./place-slug";

interface SuggestionInput extends PlaceIdentityInput {
  id: string; userId: string; neighborhood: string; categoryId: string;
  description: string | null; duplicateOverrideReason: string | null; now: string;
}

export async function findSuggestionDuplicates(db: AppDb, input: PlaceIdentityInput) {
  const candidates = await db.select({ id: places.id, slug: places.slug, name: places.name, address: places.address, phone: places.phone, latitude: places.latitude, longitude: places.longitude })
    .from(places).where(inArray(places.status, ["DRAFT", "PUBLISHED", "HIDDEN"])).orderBy(asc(places.id)).limit(1_000);
  return candidates.map((candidate) => ({ candidate, ...classifyPlaceDuplicate(input, candidate) }))
    .filter((result) => result.level !== "NONE")
    .sort((left, right) => ({ EXACT: 0, HIGH: 1, MEDIUM: 2 }[left.level] - { EXACT: 0, HIGH: 1, MEDIUM: 2 }[right.level]));
}

export async function submitPlaceSuggestion(db: AppDb, input: SuggestionInput) {
  const [user, category] = await Promise.all([
    db.query.users.findFirst({ where: eq(users.id, input.userId) }),
    db.query.categories.findFirst({ where: and(eq(categories.id, input.categoryId), eq(categories.isActive, true)) }),
  ]);
  if (!user?.emailVerifiedAt) throw new Error("EMAIL_VERIFICATION_REQUIRED");
  if (!category) throw new Error("CATEGORY_NOT_FOUND");
  const normalized = normalizePlaceIdentity(input);
  if (!normalized.name || !normalized.address || !input.neighborhood.trim()) throw new Error("SUGGESTION_REQUIRED_FIELDS");
  const duplicates = await findSuggestionDuplicates(db, input);
  if (duplicates.length && !input.duplicateOverrideReason?.trim()) throw new Error("DUPLICATE_CONFIRMATION_REQUIRED");
  const suggestion = {
    id: input.id, userId: input.userId, status: "SUBMITTED" as const,
    name: input.name.trim(), normalizedName: normalized.name, address: input.address.trim(), normalizedAddress: normalized.address,
    neighborhood: input.neighborhood.trim(), latitude: input.latitude ?? null, longitude: input.longitude ?? null,
    phone: normalized.phone, categoryId: input.categoryId, description: input.description?.trim() || null,
    duplicateOverrideReason: input.duplicateOverrideReason?.trim() || null, createdAt: input.now, updatedAt: input.now,
  };
  await db.insert(placeSuggestions).values(suggestion);
  if (duplicates.length) await db.insert(placeDuplicateCandidates).values(duplicates.map((duplicate) => ({
    id: crypto.randomUUID(), suggestionId: input.id, rightPlaceId: duplicate.candidate.id,
    confidence: duplicate.level as "EXACT" | "HIGH" | "MEDIUM", distanceMeters: duplicate.distanceMeters,
    reasonsJson: JSON.stringify(duplicate.reasons), status: "OPEN" as const, createdAt: input.now, updatedAt: input.now,
  })));
  return { id: input.id, duplicates };
}

async function uniqueSlug(db: AppDb, name: string) {
  const base = slugifyPlaceName(name); let slug = base;
  for (let suffix = 2; await db.query.places.findFirst({ where: eq(places.slug, slug) }); suffix += 1) slug = `${base}-${suffix}`;
  return slug;
}

export async function approvePlaceSuggestion(db: AppDb, input: { suggestionId: string; actorUserId: string; placeId: string; latitude?: number | null; longitude?: number | null; reason: string; now: string }) {
  const [suggestion, actor] = await Promise.all([
    db.query.placeSuggestions.findFirst({ where: eq(placeSuggestions.id, input.suggestionId) }),
    db.query.users.findFirst({ where: eq(users.id, input.actorUserId) }),
  ]);
  if (actor?.role !== "ADMIN") throw new Error("ADMIN_REQUIRED");
  if (!suggestion || !["SUBMITTED", "NEEDS_INFO", "REVIEWING"].includes(suggestion.status)) throw new Error("SUGGESTION_NOT_REVIEWABLE");
  if (!input.reason.trim()) throw new Error("REVIEW_REASON_REQUIRED");
  const latitude = input.latitude ?? suggestion.latitude; const longitude = input.longitude ?? suggestion.longitude;
  if (latitude == null || longitude == null || !Number.isFinite(latitude) || !Number.isFinite(longitude)) throw new Error("SUGGESTION_COORDINATES_REQUIRED");
  const slug = await uniqueSlug(db, suggestion.name);
  const place = { id: input.placeId, slug, name: suggestion.name, status: "DRAFT" as const, address: suggestion.address, neighborhood: suggestion.neighborhood, latitude, longitude, phone: suggestion.phone, searchText: `${suggestion.name} ${suggestion.address} ${suggestion.neighborhood}`.toLocaleLowerCase("ko-KR"), lastVerifiedAt: input.now, createdAt: input.now, updatedAt: input.now };
  await db.batch([
    db.insert(places).values(place),
    db.insert(placeCategories).values({ placeId: input.placeId, categoryId: suggestion.categoryId, isPrimary: true }),
    db.update(placeSuggestions).set({ status: "APPROVED", approvedPlaceId: input.placeId, reviewReason: input.reason.trim(), reviewedBy: input.actorUserId, reviewedAt: input.now, updatedAt: input.now }).where(eq(placeSuggestions.id, suggestion.id)),
    db.update(placeDuplicateCandidates).set({ status: "DISMISSED", resolvedBy: input.actorUserId, resolvedAt: input.now, updatedAt: input.now }).where(eq(placeDuplicateCandidates.suggestionId, suggestion.id)),
    db.update(reviewerApplications).set({ approvedSuggestionCount: sql`${reviewerApplications.approvedSuggestionCount} + 1`, updatedAt: input.now }).where(and(eq(reviewerApplications.userId, suggestion.userId), inArray(reviewerApplications.status, ["APPLIED", "REVIEWING"]))),
    db.insert(placeRevisions).values({ id: crypto.randomUUID(), placeId: input.placeId, actorUserId: input.actorUserId, action: "CREATE_FROM_SUGGESTION", reason: input.reason.trim(), beforeJson: null, afterJson: JSON.stringify(place), sourceType: "PLACE_SUGGESTION", sourceId: suggestion.id, createdAt: input.now }),
    db.insert(adminAuditLogs).values({ id: crypto.randomUUID(), actorUserId: input.actorUserId, action: "APPROVE_PLACE_SUGGESTION", targetType: "PLACE_SUGGESTION", targetId: suggestion.id, beforeState: JSON.stringify({ status: suggestion.status }), afterState: JSON.stringify({ status: "APPROVED", placeId: input.placeId }), createdAt: input.now }),
  ]);
  return { placeId: input.placeId, slug, status: "DRAFT" as const };
}

export async function transitionPlaceSuggestion(db: AppDb, input: { suggestionId: string; actorUserId: string; status: "NEEDS_INFO" | "REVIEWING" | "REJECTED" | "DUPLICATE"; reason: string; now: string }) {
  const actor = await db.query.users.findFirst({ where: eq(users.id, input.actorUserId) });
  if (actor?.role !== "ADMIN") throw new Error("ADMIN_REQUIRED");
  if (!input.reason.trim()) throw new Error("REVIEW_REASON_REQUIRED");
  await db.update(placeSuggestions).set({ status: input.status, reviewReason: input.reason.trim(), reviewedBy: input.actorUserId, reviewedAt: input.now, updatedAt: input.now }).where(eq(placeSuggestions.id, input.suggestionId));
}
