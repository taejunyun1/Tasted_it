import { and, asc, eq, getTableColumns, inArray, sql } from "drizzle-orm";

import type { AppDb } from "../../db/client.server";
import { adminAuditLogs, categories, placeCategories, placeDuplicateCandidates, placeReviewWorkItems, placeRevisions, places, placeSuggestions, reviewerApplications, users } from "../../db/schema";
import { classifyPlaceDuplicate, normalizePlaceIdentity, type PlaceIdentityInput } from "./place-duplicate-policy";
import { isSupportedRegionAddress, normalizeSupportedRegionAddress, validateAdjustedCoordinate, validatePlaceCoordinate } from "../maps/place-location";
import { isWithdrawnEmail } from "../auth/withdraw";
import { slugifyPlaceNameForAddress } from "./place-slug";
import { newReviewWorkItemValues } from "./place-review-work-items.server";
import { enforceReviewDiningExclusion } from "./local-dining-review.server";
import { reviewableSuggestionStatuses } from "./place-suggestion-io";

type Suggestion = typeof placeSuggestions.$inferSelect;
type SuggestionDecision = { suggestionId: string; actorUserId: string; expectedRevision?: string; reason: string; now: string };
const suggestionColumns = getTableColumns(placeSuggestions);
const suggestionKeys = Object.keys(suggestionColumns) as Array<keyof Suggestion>;

async function decisionDigest(value: unknown) {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(value)));
  return Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function decisionRevision(suggestion: Suggestion) {
  return decisionDigest(suggestionKeys.map((key) => suggestion[key]));
}

function exactDecision(suggestion: Suggestion, input: SuggestionDecision) {
  return and(
    ...suggestionKeys.map((key) => sql`${suggestionColumns[key]} is ${suggestion[key]}`),
    sql`exists (select 1 from users where id=${input.actorUserId} and role='ADMIN'
      and lower(email) not like 'withdrawn.%@invalid.local'
      and not exists (select 1 from member_access_restrictions r
        where r.user_id=${input.actorUserId} and r.lifted_at is null and r.starts_at<=${input.now} and r.expires_at>${input.now}))`,
  );
}

// D1 checks and writes share one transaction. An unchanged update or a
// suppressed insert must abort it before a later statement can report success.
function requireOneChange(db: AppDb) {
  return db.run(sql`SELECT json(CASE WHEN changes()=1 THEN 'true' ELSE 'SUGGESTION_CAS_CONFLICT' END)`);
}

async function commitDecision(db: AppDb, statements: Parameters<AppDb["batch"]>[0]) {
  try {
    await db.batch(statements);
  } catch (error) {
    for (let cause = error; cause instanceof Error; cause = cause.cause) {
      if (cause.message.includes("malformed JSON")) throw new Error("SUGGESTION_STALE");
    }
    throw error;
  }
}

async function readDecision(db: AppDb, input: SuggestionDecision) {
  const [suggestion, actor] = await Promise.all([
    db.query.placeSuggestions.findFirst({ where: eq(placeSuggestions.id, input.suggestionId) }),
    db.query.users.findFirst({ where: eq(users.id, input.actorUserId) }),
  ]);
  if (actor?.role !== "ADMIN" || isWithdrawnEmail(actor.email)) throw new Error("ADMIN_REQUIRED");
  if (!suggestion) throw new Error("SUGGESTION_NOT_REVIEWABLE");
  if (!input.reason.trim()) throw new Error("REVIEW_REASON_REQUIRED");
  return suggestion;
}

async function assertReviewable(suggestion: Suggestion, expectedRevision?: string) {
  if (suggestion.approvedPlaceId !== null || !reviewableSuggestionStatuses.some((status) => status === suggestion.status)) {
    throw new Error("SUGGESTION_NOT_REVIEWABLE");
  }
  if (expectedRevision !== undefined && await decisionRevision(suggestion) !== expectedRevision) throw new Error("SUGGESTION_STALE");
}

async function findApprovalReceipt(db: AppDb, suggestion: Suggestion, input: SuggestionDecision, requestDigest: string) {
  if (suggestion.status !== "APPROVED" || suggestion.approvedPlaceId !== suggestion.id || suggestion.reviewedBy !== input.actorUserId) return null;
  const [existingPlace, approvals] = await Promise.all([
    db.query.places.findFirst({ where: eq(places.id, suggestion.id), columns: { id: true, slug: true, status: true } }),
    db.select({ id: adminAuditLogs.id }).from(adminAuditLogs).where(and(
      eq(adminAuditLogs.action, "APPROVE_PLACE_SUGGESTION"),
      eq(adminAuditLogs.targetType, "PLACE_SUGGESTION"),
      eq(adminAuditLogs.targetId, suggestion.id),
      eq(adminAuditLogs.actorUserId, input.actorUserId),
      sql`json_extract(${adminAuditLogs.afterState}, '$.requestDigest')=${requestDigest}`,
    )).limit(2),
  ]);
  return existingPlace && approvals.length === 1 ? { placeId: existingPlace.id, slug: existingPlace.slug, status: existingPlace.status, replayed: true } : null;
}

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
  const rows = await db.select().from(placeSuggestions)
    .where(where)
    .orderBy(asc(placeSuggestions.createdAt), asc(placeSuggestions.id))
    .limit(pageSize).offset((page - 1) * pageSize);
  const listings = await Promise.all(rows.map(async (suggestion) => {
    const { id, status, name, address, neighborhood, latitude, longitude, description } = suggestion;
    return { id, status, name, address, neighborhood, latitude, longitude, description, decisionRevision: await decisionRevision(suggestion) };
  }));
  return { rows: listings, pagination: { page, pageSize, total, totalPages } };
}

async function uniqueSlug(db: AppDb, name: string, address: string) {
  const base = slugifyPlaceNameForAddress(name, address); let slug = base;
  for (let suffix = 2; await db.query.places.findFirst({ where: eq(places.slug, slug) }); suffix += 1) slug = `${base}-${suffix}`;
  return slug;
}

export async function approvePlaceSuggestion(db: AppDb, input: SuggestionDecision & {
  address?: string | null;
  neighborhood?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  originLatitude?: number | null;
  originLongitude?: number | null;
}) {
  const suggestion = await readDecision(db, input);
  const reason = input.reason.trim();
  const requestDigest = await decisionDigest([input.expectedRevision, reason, input.address?.trim(), input.neighborhood?.trim(),
    input.originLatitude, input.originLongitude, input.latitude, input.longitude]);
  const existing = await findApprovalReceipt(db, suggestion, input, requestDigest);
  if (existing) return existing;
  await assertReviewable(suggestion, input.expectedRevision);
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
  const claim = { status: "REVIEWING" as const, address, normalizedAddress: normalized.address, neighborhood,
    latitude: location.coordinate.latitude, longitude: location.coordinate.longitude, reviewReason: reason,
    reviewedBy: input.actorUserId, reviewedAt: input.now, updatedAt: input.now };
  try {
    await commitDecision(db, [
      db.update(placeSuggestions).set(claim).where(exactDecision(suggestion, input)), requireOneChange(db),
      db.insert(places).values(place), requireOneChange(db),
      db.insert(placeCategories).values({ placeId, categoryId: suggestion.categoryId, isPrimary: true }), requireOneChange(db),
      db.insert(placeReviewWorkItems).values(newReviewWorkItemValues({ placeId, sourceKind: "PLACE_SUGGESTION", now: input.now })), requireOneChange(db),
      db.update(placeSuggestions).set({ status: "APPROVED", approvedPlaceId: placeId }).where(exactDecision({ ...suggestion, ...claim }, input)), requireOneChange(db),
      db.update(placeDuplicateCandidates).set({ status: "DISMISSED", resolvedBy: input.actorUserId, resolvedAt: input.now, updatedAt: input.now }).where(eq(placeDuplicateCandidates.suggestionId, suggestion.id)),
      db.update(reviewerApplications).set({ approvedSuggestionCount: sql`${reviewerApplications.approvedSuggestionCount} + 1`, updatedAt: input.now }).where(and(eq(reviewerApplications.userId, suggestion.userId), inArray(reviewerApplications.status, ["APPLIED", "REVIEWING"]))),
      db.insert(placeRevisions).values({ id: crypto.randomUUID(), placeId, actorUserId: input.actorUserId, action: "CREATE_FROM_SUGGESTION", reason, beforeJson: null, afterJson: JSON.stringify(place), sourceType: "PLACE_SUGGESTION", sourceId: suggestion.id, createdAt: input.now }),
      requireOneChange(db),
      db.insert(adminAuditLogs).values({ id: crypto.randomUUID(), actorUserId: input.actorUserId, action: "APPROVE_PLACE_SUGGESTION", targetType: "PLACE_SUGGESTION", targetId: suggestion.id,
        beforeState: JSON.stringify({ status: suggestion.status, reviewReason: suggestion.reviewReason, address: suggestion.address, neighborhood: suggestion.neighborhood, latitude: suggestion.latitude, longitude: suggestion.longitude }),
        afterState: JSON.stringify({ status: "APPROVED", reviewReason: reason, placeId, address, neighborhood, latitude: location.coordinate.latitude, longitude: location.coordinate.longitude, requestDigest }),
        createdAt: input.now }),
      requireOneChange(db),
    ]);
  } catch (error) {
    const alreadyApproved = await db.query.placeSuggestions.findFirst({ where: eq(placeSuggestions.id, suggestion.id) });
    const receipt = alreadyApproved && await findApprovalReceipt(db, alreadyApproved, input, requestDigest);
    if (receipt) return receipt;
    throw error;
  }
  const reviewItem = await db.query.placeReviewWorkItems.findFirst({ where: eq(placeReviewWorkItems.placeId, placeId) });
  if (reviewItem) await enforceReviewDiningExclusion(db, reviewItem, input.actorUserId, input.now);
  return { placeId, slug, status: "DRAFT" as const, replayed: false };
}

export async function transitionPlaceSuggestion(db: AppDb, input: SuggestionDecision & { status: "NEEDS_INFO" | "REVIEWING" | "REJECTED" | "DUPLICATE" }) {
  const suggestion = await readDecision(db, input);
  await assertReviewable(suggestion, input.expectedRevision);
  const reason = input.reason.trim();
  if (suggestion.status === input.status && suggestion.reviewReason === reason) throw new Error("SUGGESTION_UNCHANGED");
  await commitDecision(db, [
    db.update(placeSuggestions).set({ status: input.status, reviewReason: reason, reviewedBy: input.actorUserId, reviewedAt: input.now, updatedAt: input.now })
      .where(exactDecision(suggestion, input)),
    requireOneChange(db),
    db.insert(adminAuditLogs).values({ id: crypto.randomUUID(), actorUserId: input.actorUserId, action: "TRANSITION_PLACE_SUGGESTION",
      targetType: "PLACE_SUGGESTION", targetId: suggestion.id, createdAt: input.now,
      beforeState: JSON.stringify({ status: suggestion.status, reviewReason: suggestion.reviewReason }),
      afterState: JSON.stringify({ status: input.status, reviewReason: reason }),
    }),
    requireOneChange(db),
  ]);
}
