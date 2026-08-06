import { and, eq } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";

import type { AppDb } from "../../db/client.server";
import { adminAuditLogs, currentVotes, placeCategories, placeCorrectionRequests, placeRevisions, placeSlugRedirects, placeSourceLinks, placeSuggestions, places, savedPlaces, users, voteEvents } from "../../db/schema";

async function requireAdmin(db: AppDb, userId: string) { const user = await db.query.users.findFirst({ where: eq(users.id, userId) }); if (user?.role !== "ADMIN") throw new Error("ADMIN_REQUIRED"); }

export async function mergePlaces(db: AppDb, input: { targetPlaceId: string; sourcePlaceId: string; actorUserId: string; reason: string; now: string }) {
  if (input.targetPlaceId === input.sourcePlaceId) throw new Error("MERGE_SAME_PLACE");
  if (!input.reason.trim()) throw new Error("MERGE_REASON_REQUIRED");
  await requireAdmin(db, input.actorUserId);
  const [target, source, sourceVotes, targetVotes, sourceSaves, targetSaves, sourceCategories] = await Promise.all([
    db.query.places.findFirst({ where: eq(places.id, input.targetPlaceId) }), db.query.places.findFirst({ where: eq(places.id, input.sourcePlaceId) }),
    db.select().from(currentVotes).where(eq(currentVotes.placeId, input.sourcePlaceId)), db.select().from(currentVotes).where(eq(currentVotes.placeId, input.targetPlaceId)),
    db.select().from(savedPlaces).where(eq(savedPlaces.placeId, input.sourcePlaceId)), db.select().from(savedPlaces).where(eq(savedPlaces.placeId, input.targetPlaceId)),
    db.select().from(placeCategories).where(eq(placeCategories.placeId, input.sourcePlaceId)),
  ]);
  if (!target || !source) throw new Error("MERGE_PLACE_NOT_FOUND");
  const targetVoteUsers = new Set(targetVotes.map((vote) => vote.userId)); const targetSaveUsers = new Set(targetSaves.map((save) => save.userId));
  const statements: BatchItem<"sqlite">[] = [];
  for (const vote of sourceVotes) {
    if (!targetVoteUsers.has(vote.userId)) statements.push(db.insert(currentVotes).values({ ...vote, placeId: target.id }));
    statements.push(db.delete(currentVotes).where(and(eq(currentVotes.placeId, source.id), eq(currentVotes.userId, vote.userId))));
  }
  statements.push(db.update(voteEvents).set({ placeId: target.id }).where(eq(voteEvents.placeId, source.id)));
  for (const save of sourceSaves) {
    if (!targetSaveUsers.has(save.userId)) statements.push(db.insert(savedPlaces).values({ ...save, placeId: target.id }));
  }
  statements.push(db.delete(savedPlaces).where(eq(savedPlaces.placeId, source.id)));
  for (const category of sourceCategories) statements.push(db.insert(placeCategories).values({ ...category, placeId: target.id, isPrimary: false }).onConflictDoNothing());
  statements.push(
    db.delete(placeCategories).where(eq(placeCategories.placeId, source.id)),
    db.update(placeSourceLinks).set({ placeId: target.id }).where(eq(placeSourceLinks.placeId, source.id)),
    db.update(placeSuggestions).set({ approvedPlaceId: target.id, updatedAt: input.now }).where(eq(placeSuggestions.approvedPlaceId, source.id)),
    db.update(placeCorrectionRequests).set({ placeId: target.id, updatedAt: input.now }).where(eq(placeCorrectionRequests.placeId, source.id)),
    db.update(places).set({ status: "HIDDEN", updatedAt: input.now }).where(eq(places.id, source.id)),
    db.insert(placeSlugRedirects).values({ oldSlug: source.slug, placeId: target.id, createdAt: input.now }).onConflictDoUpdate({ target: placeSlugRedirects.oldSlug, set: { placeId: target.id, createdAt: input.now } }),
    db.insert(placeRevisions).values({ id: crypto.randomUUID(), placeId: target.id, actorUserId: input.actorUserId, action: "MERGE", reason: input.reason.trim(), beforeJson: JSON.stringify({ target, source }), afterJson: JSON.stringify({ targetPlaceId: target.id, absorbedPlaceId: source.id, sourceStatus: "HIDDEN" }), sourceType: "PLACE_MERGE", sourceId: source.id, createdAt: input.now }),
    db.insert(adminAuditLogs).values({ id: crypto.randomUUID(), actorUserId: input.actorUserId, action: "MERGE_PLACES", targetType: "PLACE", targetId: target.id, beforeState: JSON.stringify({ target, source }), afterState: JSON.stringify({ absorbedPlaceId: source.id }), createdAt: input.now }),
  );
  const [first, ...rest] = statements; if (first) await db.batch([first, ...rest]);
  return { targetPlaceId: target.id, oldSlug: source.slug };
}

function restorableSnapshot(raw: string | null) {
  if (!raw) throw new Error("REVISION_HAS_NO_BEFORE_STATE");
  const value = JSON.parse(raw) as Record<string, unknown>; const output: Record<string, string | number | null> = {};
  for (const key of ["slug", "name", "status", "address", "neighborhood", "phone", "parkingSummary", "heroImageUrl", "kakaoPlaceId", "searchText", "lastVerifiedAt", "closedAt"] as const) if (typeof value[key] === "string" || value[key] === null) output[key] = value[key] as string | null;
  for (const key of ["latitude", "longitude"] as const) if (typeof value[key] === "number") output[key] = value[key];
  return output;
}

export async function restorePlaceRevision(db: AppDb, input: { revisionId: string; actorUserId: string; reason: string; now: string }) {
  if (!input.reason.trim()) throw new Error("RESTORE_REASON_REQUIRED"); await requireAdmin(db, input.actorUserId);
  const revision = await db.query.placeRevisions.findFirst({ where: eq(placeRevisions.id, input.revisionId) });
  if (!revision) throw new Error("REVISION_NOT_FOUND");
  const place = await db.query.places.findFirst({ where: eq(places.id, revision.placeId) }); if (!place) throw new Error("PLACE_NOT_FOUND");
  const changes = restorableSnapshot(revision.beforeJson); const restored = { ...place, ...changes, updatedAt: input.now };
  await db.batch([
    db.update(places).set({ ...changes, updatedAt: input.now }).where(eq(places.id, place.id)),
    db.insert(placeRevisions).values({ id: crypto.randomUUID(), placeId: place.id, actorUserId: input.actorUserId, action: "RESTORE", reason: input.reason.trim(), beforeJson: JSON.stringify(place), afterJson: JSON.stringify(restored), sourceType: "PLACE_REVISION", sourceId: revision.id, createdAt: input.now }),
    db.insert(adminAuditLogs).values({ id: crypto.randomUUID(), actorUserId: input.actorUserId, action: "RESTORE_PLACE_REVISION", targetType: "PLACE", targetId: place.id, beforeState: JSON.stringify(place), afterState: JSON.stringify(restored), createdAt: input.now }),
  ]);
  return restored;
}
