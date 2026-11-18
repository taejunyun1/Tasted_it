import { and, asc, eq, inArray, sql } from "drizzle-orm";

import type { AppDb } from "../../db/client.server";
import { adminAuditLogs, categories, placeCategories, placeDuplicateCandidates, placeReviewWorkItems, placeRevisions, places, placeSuggestions, reviewerApplications, users } from "../../db/schema";
import { classifyPlaceDuplicate, normalizePlaceIdentity, type PlaceIdentityInput } from "./place-duplicate-policy";
import { isSupportedRegionAddress, normalizeSupportedRegionAddress, validateAdjustedCoordinate, validatePlaceCoordinate } from "../maps/place-location";
import { slugifyPlaceNameForAddress } from "./place-slug";
import { newReviewWorkItemValues } from "./place-review-work-items.server";
import { enforceReviewDiningExclusion } from "./local-dining-review.server";
import { reviewableSuggestionStatuses } from "./place-suggestion-io";

export interface SuggestionInput extends PlaceIdentityInput {
  id: string; userId: string; neighborhood: string; categoryId: string;
  originLatitude: number; originLongitude: number;
  latitude: number; longitude: number;
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
  if (input.originLatitude == null || input.originLongitude == null || input.latitude == null || input.longitude == null) throw new Error("LOCATION_REQUIRED");
  const address = normalizeSupportedRegionAddress(input.address);
  if (!isSupportedRegionAddress(address)) throw new Error("LOCATION_OUT_OF_SCOPE");
  const origin = validatePlaceCoordinate({ latitude: input.originLatitude, longitude: input.originLongitude });
  if (!origin.ok) throw new Error(origin.code);
  const location = validatePlaceCoordinate({ latitude: input.latitude, longitude: input.longitude });
  if (!location.ok) throw new Error(location.code);
  const adjusted = validateAdjustedCoordinate(origin.coordinate, location.coordinate);
  if (!adjusted.ok) throw new Error(adjusted.code);
  const normalizedInput = { ...input, address };
  const normalized = normalizePlaceIdentity(normalizedInput);
  if (!normalized.name || !normalized.address || !input.neighborhood.trim()) throw new Error("SUGGESTION_REQUIRED_FIELDS");
  const duplicates = await findSuggestionDuplicates(db, normalizedInput);
  if (duplicates.length && !input.duplicateOverrideReason?.trim()) throw new Error("DUPLICATE_CONFIRMATION_REQUIRED");
  const suggestion = {
    id: input.id, userId: input.userId, status: "SUBMITTED" as const,
    name: input.name.trim(), normalizedName: normalized.name, address, normalizedAddress: normalized.address,
    neighborhood: input.neighborhood.trim(), latitude: location.coordinate.latitude, longitude: location.coordinate.longitude,
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

export async function listReviewablePlaceSuggestions(db: AppDb, requestedPage = 1) {
  const pageSize = 25;
  const where = inArray(placeSuggestions.status, [...reviewableSuggestionStatuses]);
  const [count] = await db.select({ total: sql<number>`count(*)` }).from(placeSuggestions).where(where);
  const total = Number(count?.total ?? 0);
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const page = Math.min(totalPages, Number.isSafeInteger(requestedPage) && requestedPage > 0 ? requestedPage : 1);
  const rows = await db.select({
    id: placeSuggestions.id,
    status: placeSuggestions.status,
    name: placeSuggestions.name,
    address: placeSuggestions.address,
    neighborhood: placeSuggestions.neighborhood,
    latitude: placeSuggestions.latitude,
    longitude: placeSuggestions.longitude,
    description: placeSuggestions.description,
  }).from(placeSuggestions)
    .where(where)
    .orderBy(asc(placeSuggestions.createdAt), asc(placeSuggestions.id))
    .limit(pageSize).offset((page - 1) * pageSize);
  return { rows, pagination: { page, pageSize, total, totalPages } };
}

async function uniqueSlug(db: AppDb, name: string, address: string) {
  const base = slugifyPlaceNameForAddress(name, address); let slug = base;
  for (let suffix = 2; await db.query.places.findFirst({ where: eq(places.slug, slug) }); suffix += 1) slug = `${base}-${suffix}`;
  return slug;
}

export async function approvePlaceSuggestion(db: AppDb, input: {
  suggestionId: string;
  actorUserId: string;
  address?: string | null;
  neighborhood?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  originLatitude?: number | null;
  originLongitude?: number | null;
  reason: string;
  now: string;
}) {
  const [suggestion, actor] = await Promise.all([
    db.query.placeSuggestions.findFirst({ where: eq(placeSuggestions.id, input.suggestionId) }),
    db.query.users.findFirst({ where: eq(users.id, input.actorUserId) }),
  ]);
  if (actor?.role !== "ADMIN") throw new Error("ADMIN_REQUIRED");
  if (!suggestion) throw new Error("SUGGESTION_NOT_REVIEWABLE");

  // A browser can lose the response after the D1 batch commits. Treat an
  // identical follow-up request as the already-completed approval instead of
  // making the reviewer retry into a terminal-state error.
  if (suggestion.status === "APPROVED" && suggestion.approvedPlaceId === suggestion.id) {
    const existingPlace = await db.query.places.findFirst({ where: eq(places.id, suggestion.id) });
    if (existingPlace) return { placeId: existingPlace.id, slug: existingPlace.slug, status: existingPlace.status };
  }

  if (!["SUBMITTED", "NEEDS_INFO", "REVIEWING"].includes(suggestion.status)) throw new Error("SUGGESTION_NOT_REVIEWABLE");
  if (!input.reason.trim()) throw new Error("REVIEW_REASON_REQUIRED");
  const address = normalizeSupportedRegionAddress(input.address?.trim() || suggestion.address);
  const neighborhood = input.neighborhood?.trim() || suggestion.neighborhood;
  if (!address || !neighborhood) throw new Error("SUGGESTION_REQUIRED_FIELDS");
  if (!isSupportedRegionAddress(address)) throw new Error("LOCATION_OUT_OF_SCOPE");
  const latitude = input.latitude ?? suggestion.latitude; const longitude = input.longitude ?? suggestion.longitude;
  if (latitude == null || longitude == null) throw new Error("SUGGESTION_COORDINATES_REQUIRED");
  const originLatitude = input.originLatitude ?? suggestion.latitude; const originLongitude = input.originLongitude ?? suggestion.longitude;
  if (originLatitude == null || originLongitude == null) throw new Error("SUGGESTION_COORDINATES_REQUIRED");
  const origin = validatePlaceCoordinate({ latitude: originLatitude, longitude: originLongitude });
  if (!origin.ok) throw new Error(origin.code);
  const location = validatePlaceCoordinate({ latitude, longitude });
  if (!location.ok) throw new Error(location.code);
  const adjusted = validateAdjustedCoordinate(origin.coordinate, location.coordinate);
  if (!adjusted.ok) throw new Error(adjusted.code);
  const normalized = normalizePlaceIdentity({ name: suggestion.name, address, phone: suggestion.phone });
  // One suggestion has one immutable draft ID. Retried or concurrent approvals
  // therefore collide safely inside the same D1 batch instead of creating twins.
  const placeId = suggestion.id;
  const slug = await uniqueSlug(db, suggestion.name, address);
  const place = { id: placeId, slug, name: suggestion.name, status: "DRAFT" as const, address, neighborhood, latitude: location.coordinate.latitude, longitude: location.coordinate.longitude, phone: suggestion.phone, searchText: `${suggestion.name} ${address} ${neighborhood}`.toLocaleLowerCase("ko-KR"), lastVerifiedAt: input.now, createdAt: input.now, updatedAt: input.now };
  try {
    await db.batch([
    // Claim with REVIEWING before the place insert. A suggestion cannot point to
    // a draft that does not exist yet because approved_place_id is a foreign key.
    // The D1 batch is atomic, so REVIEWING is never externally visible on failure.
    db.update(placeSuggestions).set({ status: "REVIEWING", address, normalizedAddress: normalized.address, neighborhood, latitude: location.coordinate.latitude, longitude: location.coordinate.longitude, reviewReason: input.reason.trim(), reviewedBy: input.actorUserId, reviewedAt: input.now, updatedAt: input.now }).where(and(eq(placeSuggestions.id, suggestion.id), inArray(placeSuggestions.status, ["SUBMITTED", "NEEDS_INFO", "REVIEWING"]))),
    db.insert(places).values(place),
    db.insert(placeCategories).values({ placeId, categoryId: suggestion.categoryId, isPrimary: true }),
    db.insert(placeReviewWorkItems).values(newReviewWorkItemValues({ placeId, sourceKind: "PLACE_SUGGESTION", now: input.now })).onConflictDoNothing(),
    db.update(placeSuggestions).set({ status: "APPROVED", approvedPlaceId: placeId, reviewReason: input.reason.trim(), reviewedBy: input.actorUserId, reviewedAt: input.now, updatedAt: input.now }).where(and(eq(placeSuggestions.id, suggestion.id), eq(placeSuggestions.status, "REVIEWING"), eq(placeSuggestions.reviewedBy, input.actorUserId), eq(placeSuggestions.reviewedAt, input.now))),
    db.update(placeDuplicateCandidates).set({ status: "DISMISSED", resolvedBy: input.actorUserId, resolvedAt: input.now, updatedAt: input.now }).where(eq(placeDuplicateCandidates.suggestionId, suggestion.id)),
    db.update(reviewerApplications).set({ approvedSuggestionCount: sql`${reviewerApplications.approvedSuggestionCount} + 1`, updatedAt: input.now }).where(and(eq(reviewerApplications.userId, suggestion.userId), inArray(reviewerApplications.status, ["APPLIED", "REVIEWING"]))),
    db.insert(placeRevisions).values({ id: crypto.randomUUID(), placeId, actorUserId: input.actorUserId, action: "CREATE_FROM_SUGGESTION", reason: input.reason.trim(), beforeJson: null, afterJson: JSON.stringify(place), sourceType: "PLACE_SUGGESTION", sourceId: suggestion.id, createdAt: input.now }),
    db.insert(adminAuditLogs).values({ id: crypto.randomUUID(), actorUserId: input.actorUserId, action: "APPROVE_PLACE_SUGGESTION", targetType: "PLACE_SUGGESTION", targetId: suggestion.id, beforeState: JSON.stringify({ status: suggestion.status, address: suggestion.address, neighborhood: suggestion.neighborhood, latitude: suggestion.latitude, longitude: suggestion.longitude }), afterState: JSON.stringify({ status: "APPROVED", placeId, address, neighborhood, latitude: location.coordinate.latitude, longitude: location.coordinate.longitude }), createdAt: input.now }),
    ]);
  } catch (error) {
    const alreadyApproved = await db.query.placeSuggestions.findFirst({ where: eq(placeSuggestions.id, suggestion.id) });
    const existingPlace = await db.query.places.findFirst({ where: eq(places.id, placeId) });
    if (alreadyApproved?.status === "APPROVED" && alreadyApproved.approvedPlaceId === placeId && existingPlace) {
      return { placeId, slug: existingPlace.slug, status: "DRAFT" as const };
    }
    throw error;
  }
  const reviewItem = await db.query.placeReviewWorkItems.findFirst({ where: eq(placeReviewWorkItems.placeId, placeId) });
  if (reviewItem) await enforceReviewDiningExclusion(db, reviewItem, input.actorUserId, input.now);
  return { placeId, slug, status: "DRAFT" as const };
}

export async function transitionPlaceSuggestion(db: AppDb, input: { suggestionId: string; actorUserId: string; status: "NEEDS_INFO" | "REVIEWING" | "REJECTED" | "DUPLICATE"; reason: string; now: string }) {
  const actor = await db.query.users.findFirst({ where: eq(users.id, input.actorUserId) });
  if (actor?.role !== "ADMIN") throw new Error("ADMIN_REQUIRED");
  if (!input.reason.trim()) throw new Error("REVIEW_REASON_REQUIRED");
  await db.update(placeSuggestions).set({ status: input.status, reviewReason: input.reason.trim(), reviewedBy: input.actorUserId, reviewedAt: input.now, updatedAt: input.now }).where(eq(placeSuggestions.id, input.suggestionId));
}
