import { and, asc, eq, gte, inArray, lt, sql } from "drizzle-orm";

import type { AppDb } from "../../db/client.server";
import { loadInD1Chunks } from "../../db/d1-query-chunks";
import { goldenPickEvents, places, reviewerProfiles } from "../../db/schema";

export type GoldenPlaceSummary = {
  placeId: string;
  active: boolean;
  activeStrength: 0 | 0.8 | 1;
  pastStrength: 0 | 0.4;
  reviewerUserId: string | null;
};

import { eligibleReviewCondition } from "./reviewer-publication.server";

type GoldenPickEvent = typeof goldenPickEvents.$inferSelect;

function compareGoldenEvents(left: GoldenPickEvent, right: GoldenPickEvent) {
  return (
    left.effectiveAt.localeCompare(right.effectiveAt) ||
    left.id.localeCompare(right.id)
  );
}

function summarizeGoldenPickEvents(events: GoldenPickEvent[], now: string) {
  const occurredEvents = events.filter((event) => event.effectiveAt <= now);
  const closuresByGrant = new Map<string, GoldenPickEvent[]>();
  occurredEvents.forEach((event) => {
    if (event.eventType === "GRANT" || !event.previousEventId) return;
    const closures = closuresByGrant.get(event.previousEventId) ?? [];
    closures.push(event);
    closuresByGrant.set(event.previousEventId, closures);
  });

  const grantsByPlace = new Map<string, GoldenPickEvent[]>();
  occurredEvents.forEach((event) => {
    if (event.eventType !== "GRANT") return;
    const grants = grantsByPlace.get(event.placeId) ?? [];
    grants.push(event);
    grantsByPlace.set(event.placeId, grants);
  });

  const expiringSoonAt = addDays(now, 14);
  const summaries = new Map<string, GoldenPlaceSummary>();
  const activePicks: GoldenPickEvent[] = [];
  grantsByPlace.forEach((grants, placeId) => {
    const candidates = grants.map((grant) => {
      const closures = closuresByGrant.get(grant.id) ?? [];
      const withdrawn = closures.some(
        (event) => event.eventType === "WITHDRAW",
      );
      const expired = closures.some((event) => event.eventType === "EXPIRE");
      const validInterval =
        grant.expiresAt != null && grant.expiresAt > grant.effectiveAt;
      const active =
        validInterval && !withdrawn && !expired && grant.expiresAt! > now;
      const past = validInterval && !withdrawn && grant.expiresAt! <= now;
      return { grant, active, past };
    });
    const active = candidates
      .filter((candidate) => candidate.active)
      .sort((left, right) => {
        const leftStrength = left.grant.expiresAt! <= expiringSoonAt ? 0.8 : 1;
        const rightStrength =
          right.grant.expiresAt! <= expiringSoonAt ? 0.8 : 1;
        return (
          rightStrength - leftStrength ||
          compareGoldenEvents(right.grant, left.grant)
        );
      });
    activePicks.push(...active.map((candidate) => candidate.grant));
    const strongestActive = active[0];
    if (strongestActive) {
      summaries.set(placeId, {
        placeId,
        active: true,
        activeStrength:
          strongestActive.grant.expiresAt! <= expiringSoonAt ? 0.8 : 1,
        pastStrength: 0,
        reviewerUserId: strongestActive.grant.reviewerUserId,
      });
      return;
    }

    const latestPast = candidates
      .filter((candidate) => candidate.past)
      .sort((left, right) => compareGoldenEvents(right.grant, left.grant))[0];
    summaries.set(placeId, {
      placeId,
      active: false,
      activeStrength: 0,
      pastStrength: latestPast ? 0.4 : 0,
      reviewerUserId: latestPast?.grant.reviewerUserId ?? null,
    });
  });

  return {
    summaries,
    activePicks: activePicks.sort(compareGoldenEvents),
  };
}

export async function loadGoldenPickContextForPlaces(
  db: AppDb,
  placeIds: string[],
  now: string,
) {
  const uniquePlaceIds = [...new Set(placeIds)];
  const events = await loadInD1Chunks(
    uniquePlaceIds,
    (placeIdChunk) =>
      db
        .select()
        .from(goldenPickEvents)
        .where(
          and(
            inArray(goldenPickEvents.placeId, placeIdChunk),
            eligibleGoldenCondition(),
          ),
        )
        .orderBy(asc(goldenPickEvents.effectiveAt), asc(goldenPickEvents.id)),
    { reservedBindings: 1 },
  );
  const context = summarizeGoldenPickEvents(events, now);
  const summaries = new Map<string, GoldenPlaceSummary>();
  uniquePlaceIds.forEach((placeId) => {
    const summary = context.summaries.get(placeId);
    if (summary) summaries.set(placeId, summary);
  });
  return { ...context, summaries };
}

export async function listGoldenPickHistoryForPlaces(
  db: AppDb,
  placeIds: string[],
  now: string,
) {
  return (await loadGoldenPickContextForPlaces(db, placeIds, now)).summaries;
}

function addDays(iso: string, days: number) {
  const date = new Date(iso);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString();
}

function monthBounds(iso: string) {
  const date = new Date(iso);
  return {
    start: new Date(
      Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1),
    ).toISOString(),
    end: new Date(
      Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1),
    ).toISOString(),
  };
}

export async function getGoldenPickQuota(
  db: AppDb,
  reviewerUserId: string,
  now: string,
) {
  const bounds = monthBounds(now);
  const grants = await db
    .select({ id: goldenPickEvents.id })
    .from(goldenPickEvents)
    .where(
      and(
        eq(goldenPickEvents.reviewerUserId, reviewerUserId),
        eq(goldenPickEvents.eventType, "GRANT"),
        gte(goldenPickEvents.effectiveAt, bounds.start),
        lt(goldenPickEvents.effectiveAt, bounds.end),
      ),
    );
  const limit = 3;
  return {
    used: grants.length,
    limit,
    remaining: Math.max(0, limit - grants.length),
  };
}

export async function prepareGoldenPickGrant(
  db: AppDb,
  input: {
    id: string;
    reviewerUserId: string;
    placeId: string;
    reason: string;
    now: string;
  },
) {
  const reason = input.reason.trim();
  if (reason.length < 15 || reason.length > 100)
    throw new Error("GOLDEN_PICK_REASON_LENGTH");
  const reviewer = await db.query.reviewerProfiles.findFirst({
    where: eq(reviewerProfiles.userId, input.reviewerUserId),
  });
  if (!reviewer || reviewer.status !== "ACTIVE")
    throw new Error("ACTIVE_REVIEWER_REQUIRED");
  const place = await db.query.places.findFirst({
    where: eq(places.id, input.placeId),
  });
  if (!place || place.status !== "PUBLISHED")
    throw new Error("PUBLISHED_PLACE_REQUIRED");
  const bounds = monthBounds(input.now);
  const monthly = await db
    .select()
    .from(goldenPickEvents)
    .where(
      and(
        eq(goldenPickEvents.reviewerUserId, input.reviewerUserId),
        eq(goldenPickEvents.eventType, "GRANT"),
        gte(goldenPickEvents.effectiveAt, bounds.start),
        lt(goldenPickEvents.effectiveAt, bounds.end),
      ),
    );
  if (monthly.length >= 3) throw new Error("GOLDEN_PICK_MONTHLY_LIMIT");
  const grants = await db
    .select()
    .from(goldenPickEvents)
    .where(
      and(
        eq(goldenPickEvents.reviewerUserId, input.reviewerUserId),
        eq(goldenPickEvents.placeId, input.placeId),
        eq(goldenPickEvents.eventType, "GRANT"),
      ),
    )
    .orderBy(asc(goldenPickEvents.effectiveAt));
  const latest = grants.at(-1);
  if (
    latest &&
    new Date(input.now).getTime() <
      new Date(addDays(latest.effectiveAt, 90)).getTime()
  )
    throw new Error("GOLDEN_PICK_PLACE_COOLDOWN");
  return {
    id: input.id,
    reviewerUserId: input.reviewerUserId,
    placeId: input.placeId,
    eventType: "GRANT" as const,
    previousEventId: null,
    reason,
    effectiveAt: input.now,
    expiresAt: addDays(input.now, 90),
    createdAt: input.now,
  };
}

export async function grantGoldenPick(
  db: AppDb,
  input: {
    id: string;
    reviewerUserId: string;
    placeId: string;
    reason: string;
    now: string;
  },
) {
  void db;
  void input;
  throw new Error("GOLDEN_PICK_REVIEW_APPROVAL_REQUIRED");
}

export async function listActiveGoldenPicks(
  db: AppDb,
  now: string,
  reviewerUserId?: string,
) {
  const events = await db
    .select()
    .from(goldenPickEvents)
    .where(eligibleGoldenCondition())
    .orderBy(asc(goldenPickEvents.effectiveAt));
  return summarizeGoldenPickEvents(events, now).activePicks.filter(
    (event) => !reviewerUserId || event.reviewerUserId === reviewerUserId,
  );
}

export async function withdrawGoldenPick(
  db: AppDb,
  input: {
    id: string;
    grantEventId: string;
    reviewerUserId: string;
    reason: string;
    now: string;
  },
) {
  if (!input.reason.trim()) throw new Error("GOLDEN_PICK_REASON_REQUIRED");
  const grant = await db.query.goldenPickEvents.findFirst({
    where: eq(goldenPickEvents.id, input.grantEventId),
  });
  if (
    !grant ||
    grant.eventType !== "GRANT" ||
    grant.reviewerUserId !== input.reviewerUserId
  )
    throw new Error("GOLDEN_PICK_NOT_FOUND");
  const existing = await db.query.goldenPickEvents.findFirst({
    where: eq(goldenPickEvents.previousEventId, grant.id),
  });
  if (existing) throw new Error("GOLDEN_PICK_ALREADY_CLOSED");
  await db
    .insert(goldenPickEvents)
    .values({
      id: input.id,
      reviewerUserId: grant.reviewerUserId,
      placeId: grant.placeId,
      eventType: "WITHDRAW",
      previousEventId: grant.id,
      reason: input.reason.trim(),
      effectiveAt: input.now,
      expiresAt: null,
      createdAt: input.now,
    });
}

export async function expireGoldenPicks(
  db: AppDb,
  input: { now: string; reviewerUserId?: string },
) {
  const events = await db
    .select()
    .from(goldenPickEvents)
    .orderBy(asc(goldenPickEvents.effectiveAt));
  const closed = new Set(
    events
      .filter((event) => event.eventType !== "GRANT" && event.previousEventId)
      .map((event) => event.previousEventId!),
  );
  const expired = events.filter(
    (event) =>
      event.eventType === "GRANT" &&
      !closed.has(event.id) &&
      event.expiresAt &&
      event.expiresAt <= input.now &&
      (!input.reviewerUserId || event.reviewerUserId === input.reviewerUserId),
  );
  if (expired.length)
    await db
      .insert(goldenPickEvents)
      .values(
        expired.map((grant) => ({
          id: crypto.randomUUID(),
          reviewerUserId: grant.reviewerUserId,
          placeId: grant.placeId,
          eventType: "EXPIRE" as const,
          previousEventId: grant.id,
          reason: "90_DAY_EXPIRATION",
          effectiveAt: input.now,
          expiresAt: null,
          createdAt: input.now,
        })),
      );
  return expired.length;
}

function eligibleGoldenCondition() {
  return sql<boolean>`exists(select 1 from golden_pick_events public_grant where public_grant.id=case when ${goldenPickEvents.eventType}='GRANT' then ${goldenPickEvents.id} else ${goldenPickEvents.previousEventId} end
 and public_grant.place_id=${goldenPickEvents.placeId} and public_grant.reviewer_user_id=${goldenPickEvents.reviewerUserId}
 and exists(select 1 from reviewer_visit_reviews bound_review where bound_review.id=public_grant.review_id and bound_review.place_id=public_grant.place_id and bound_review.reviewer_user_id=public_grant.reviewer_user_id and bound_review.golden_pick_event_id=public_grant.id and bound_review.golden_requested=1 and bound_review.photo_count>0 and public_grant.review_version<=bound_review.content_version)
 and ${eligibleReviewCondition(sql`public_grant.review_id`)})`;
}
