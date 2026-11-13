import { and, eq, sql } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";

import type { AppDb } from "../../db/client.server";
import { eligibleVoteCondition } from "../ratings/reviewer-publication.server";
import {
  adminAuditLogs,
  guestSavedPlaces,
  memberSaveChoices,
  currentVotes,
  placeCategories,
  placeCorrectionRequests,
  placeRevisions,
  placeSlugRedirects,
  placeSourceLinks,
  placeSuggestions,
  places,
  savedPlaces,
  users,
  voteEvents,
} from "../../db/schema";

async function requireAdmin(db: AppDb, userId: string) {
  const user = await db.query.users.findFirst({ where: eq(users.id, userId) });
  if (user?.role !== "ADMIN") throw new Error("ADMIN_REQUIRED");
}

export async function mergePlaces(
  db: AppDb,
  input: {
    targetPlaceId: string;
    sourcePlaceId: string;
    actorUserId: string;
    reason: string;
    now: string;
  },
) {
  if (input.targetPlaceId === input.sourcePlaceId)
    throw new Error("MERGE_SAME_PLACE");
  if (!input.reason.trim()) throw new Error("MERGE_REASON_REQUIRED");
  await requireAdmin(db, input.actorUserId);
  const [target, source, sourceVotes, sourceCategories] = await Promise.all([
    db.query.places.findFirst({ where: eq(places.id, input.targetPlaceId) }),
    db.query.places.findFirst({ where: eq(places.id, input.sourcePlaceId) }),
    db
      .select()
      .from(currentVotes)
      .where(eq(currentVotes.placeId, input.sourcePlaceId)),
    db
      .select()
      .from(placeCategories)
      .where(eq(placeCategories.placeId, input.sourcePlaceId)),
  ]);
  if (!target || !source) throw new Error("MERGE_PLACE_NOT_FOUND");
  const statements: BatchItem<"sqlite">[] = [];
  // A merge preserves the original location and provenance of every event.
  // Only a still-current ordinary reaction may be forwarded to the canonical
  // place; reviewer declarations require a new explicit review of that place.
  for (const vote of sourceVotes) {
    const forwardedId = crypto.randomUUID();
    statements.push(
      db.insert(voteEvents).select(
        db
          .select({
            id: sql<string>`${forwardedId}`.as("id"),
            placeId: sql<string>`${target.id}`.as("place_id"),
            userId: currentVotes.userId,
            value: currentVotes.value,
            source: sql<"GENERAL">`'GENERAL'`.as("source"),
            reviewId: sql<string | null>`null`.as("review_id"),
            reviewVersion: sql<number | null>`null`.as("review_version"),
            eventType: sql<"CREATE">`'CREATE'`.as("event_type"),
            previousEventId: currentVotes.eventId,
            createdAt: sql<string>`${input.now}`.as("created_at"),
          })
          .from(currentVotes)
          .innerJoin(voteEvents, eq(voteEvents.id, currentVotes.eventId))
          .where(
            and(
              eq(currentVotes.placeId, source.id),
              eq(currentVotes.userId, vote.userId),
              eq(currentVotes.eventId, vote.eventId),
              eq(voteEvents.source, "GENERAL"),
              eligibleVoteCondition(),
              sql`not exists(select 1 from current_votes target_vote where target_vote.place_id=${target.id} and target_vote.user_id=${vote.userId})`,
            ),
          ),
      ),
    );
    statements.push(
      db
        .insert(currentVotes)
        .select(
          db
            .select({
              placeId: voteEvents.placeId,
              userId: voteEvents.userId,
              eventId: voteEvents.id,
              value: voteEvents.value,
              updatedAt: voteEvents.createdAt,
            })
            .from(voteEvents)
            .where(eq(voteEvents.id, forwardedId)),
        )
        .onConflictDoNothing(),
    );
    statements.push(
      db
        .delete(currentVotes)
        .where(
          and(
            eq(currentVotes.placeId, source.id),
            eq(currentVotes.userId, vote.userId),
            eq(currentVotes.eventId, vote.eventId),
            sql`exists(select 1 from vote_events source_event where source_event.id=${vote.eventId} and source_event.source='GENERAL')`,
            sql`exists(select 1 from current_votes target_vote where target_vote.place_id=${target.id} and target_vote.user_id=${vote.userId})`,
          ),
        ),
    );
  }
  // An explicit canonical choice wins. Preserve source markers as historical
  // evidence; copy them only when the target has no explicit choice.
  statements.push(
    db
      .insert(memberSaveChoices)
      .select(
        db
          .select({
            userId: memberSaveChoices.userId,
            placeId: sql<string>`${target.id}`.as("place_id"),
            saved: memberSaveChoices.saved,
            updatedAt: memberSaveChoices.updatedAt,
          })
          .from(memberSaveChoices)
          .where(eq(memberSaveChoices.placeId, source.id)),
      )
      .onConflictDoNothing(),
    db
      .insert(savedPlaces)
      .select(
        db
          .select({
            userId: savedPlaces.userId,
            placeId: sql<string>`${target.id}`.as("place_id"),
            createdAt: savedPlaces.createdAt,
          })
          .from(savedPlaces)
          .where(
            and(
              eq(savedPlaces.placeId, source.id),
              sql`not exists(select 1 from member_save_choices choice where choice.place_id=${target.id} and choice.user_id=${savedPlaces.userId} and choice.saved=0)`,
            ),
          ),
      )
      .onConflictDoNothing(),
    db
      .insert(savedPlaces)
      .select(
        db
          .select({
            userId: memberSaveChoices.userId,
            placeId: memberSaveChoices.placeId,
            createdAt: memberSaveChoices.updatedAt,
          })
          .from(memberSaveChoices)
          .where(
            and(
              eq(memberSaveChoices.placeId, target.id),
              eq(memberSaveChoices.saved, true),
            ),
          ),
      )
      .onConflictDoNothing(),
    db
      .delete(savedPlaces)
      .where(
        and(
          eq(savedPlaces.placeId, target.id),
          sql`exists(select 1 from member_save_choices choice where choice.place_id=${target.id} and choice.user_id=${savedPlaces.userId} and choice.saved=0)`,
        ),
      ),
    db.delete(savedPlaces).where(eq(savedPlaces.placeId, source.id)),
    // UPDATE maintains the 50-choice bound, including a full guest session.
    db
      .update(guestSavedPlaces)
      .set({ placeId: target.id })
      .where(
        and(
          eq(guestSavedPlaces.placeId, source.id),
          sql`not exists(select 1 from guest_saved_places target_choice where target_choice.place_id=${target.id} and target_choice.session_id=${guestSavedPlaces.sessionId})`,
        ),
      ),
    db.delete(guestSavedPlaces).where(eq(guestSavedPlaces.placeId, source.id)),
  );
  for (const category of sourceCategories)
    statements.push(
      db
        .insert(placeCategories)
        .values({ ...category, placeId: target.id, isPrimary: false })
        .onConflictDoNothing(),
    );
  statements.push(
    db.delete(placeCategories).where(eq(placeCategories.placeId, source.id)),
    db
      .update(placeSourceLinks)
      .set({ placeId: target.id })
      .where(eq(placeSourceLinks.placeId, source.id)),
    db
      .update(placeSuggestions)
      .set({ approvedPlaceId: target.id, updatedAt: input.now })
      .where(eq(placeSuggestions.approvedPlaceId, source.id)),
    db
      .update(placeCorrectionRequests)
      .set({ placeId: target.id, updatedAt: input.now })
      .where(eq(placeCorrectionRequests.placeId, source.id)),
    db
      .update(places)
      .set({ status: "HIDDEN", updatedAt: input.now })
      .where(eq(places.id, source.id)),
    db
      .insert(placeSlugRedirects)
      .values({
        oldSlug: source.slug,
        placeId: target.id,
        createdAt: input.now,
      })
      .onConflictDoUpdate({
        target: placeSlugRedirects.oldSlug,
        set: { placeId: target.id, createdAt: input.now },
      }),
    db
      .insert(placeRevisions)
      .values({
        id: crypto.randomUUID(),
        placeId: target.id,
        actorUserId: input.actorUserId,
        action: "MERGE",
        reason: input.reason.trim(),
        beforeJson: JSON.stringify({ target, source }),
        afterJson: JSON.stringify({
          targetPlaceId: target.id,
          absorbedPlaceId: source.id,
          sourceStatus: "HIDDEN",
        }),
        sourceType: "PLACE_MERGE",
        sourceId: source.id,
        createdAt: input.now,
      }),
    db
      .insert(adminAuditLogs)
      .values({
        id: crypto.randomUUID(),
        actorUserId: input.actorUserId,
        action: "MERGE_PLACES",
        targetType: "PLACE",
        targetId: target.id,
        beforeState: JSON.stringify({ target, source }),
        afterState: sql`json_object('absorbedPlaceId',${source.id},'voteForwardPolicy','GENERAL_ONLY_CAS','voteForwards',json((select coalesce(json_group_array(json_object('sourceEventId',forwarded.previous_event_id,'targetEventId',forwarded.id)),'[]') from vote_events forwarded inner join vote_events original on original.id=forwarded.previous_event_id where forwarded.place_id=${target.id} and original.place_id=${source.id} and forwarded.created_at=${input.now} and forwarded.source='GENERAL')))`,
        createdAt: input.now,
      }),
  );
  const [first, ...rest] = statements;
  if (first) await db.batch([first, ...rest]);
  return { targetPlaceId: target.id, oldSlug: source.slug };
}

function restorableSnapshot(raw: string | null) {
  if (!raw) throw new Error("REVISION_HAS_NO_BEFORE_STATE");
  const value = JSON.parse(raw) as Record<string, unknown>;
  const output: Record<string, string | number | null> = {};
  for (const key of [
    "slug",
    "name",
    "status",
    "address",
    "neighborhood",
    "phone",
    "parkingSummary",
    "heroImageUrl",
    "kakaoPlaceId",
    "searchText",
    "lastVerifiedAt",
    "closedAt",
  ] as const)
    if (typeof value[key] === "string" || value[key] === null)
      output[key] = value[key] as string | null;
  for (const key of ["latitude", "longitude"] as const)
    if (typeof value[key] === "number") output[key] = value[key];
  return output;
}

export async function restorePlaceRevision(
  db: AppDb,
  input: {
    revisionId: string;
    actorUserId: string;
    reason: string;
    now: string;
  },
) {
  if (!input.reason.trim()) throw new Error("RESTORE_REASON_REQUIRED");
  await requireAdmin(db, input.actorUserId);
  const revision = await db.query.placeRevisions.findFirst({
    where: eq(placeRevisions.id, input.revisionId),
  });
  if (!revision) throw new Error("REVISION_NOT_FOUND");
  const place = await db.query.places.findFirst({
    where: eq(places.id, revision.placeId),
  });
  if (!place) throw new Error("PLACE_NOT_FOUND");
  const changes = restorableSnapshot(revision.beforeJson);
  const restored = { ...place, ...changes, updatedAt: input.now };
  await db.batch([
    db
      .update(places)
      .set({ ...changes, updatedAt: input.now })
      .where(eq(places.id, place.id)),
    db
      .insert(placeRevisions)
      .values({
        id: crypto.randomUUID(),
        placeId: place.id,
        actorUserId: input.actorUserId,
        action: "RESTORE",
        reason: input.reason.trim(),
        beforeJson: JSON.stringify(place),
        afterJson: JSON.stringify(restored),
        sourceType: "PLACE_REVISION",
        sourceId: revision.id,
        createdAt: input.now,
      }),
    db
      .insert(adminAuditLogs)
      .values({
        id: crypto.randomUUID(),
        actorUserId: input.actorUserId,
        action: "RESTORE_PLACE_REVISION",
        targetType: "PLACE",
        targetId: place.id,
        beforeState: JSON.stringify(place),
        afterState: JSON.stringify(restored),
        createdAt: input.now,
      }),
  ]);
  return restored;
}
