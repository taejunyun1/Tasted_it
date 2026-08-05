import { and, asc, eq, gte, lt } from "drizzle-orm";

import type { AppDb } from "../../db/client.server";
import { goldenPickEvents, places, reviewerProfiles } from "../../db/schema";

function addDays(iso: string, days: number) {
  const date = new Date(iso);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString();
}

function monthBounds(iso: string) {
  const date = new Date(iso);
  return {
    start: new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1)).toISOString(),
    end: new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1)).toISOString(),
  };
}

export async function grantGoldenPick(db: AppDb, input: {
  id: string; reviewerUserId: string; placeId: string; now: string;
}) {
  const reviewer = await db.query.reviewerProfiles.findFirst({ where: eq(reviewerProfiles.userId, input.reviewerUserId) });
  if (!reviewer || reviewer.status !== "ACTIVE") throw new Error("ACTIVE_REVIEWER_REQUIRED");
  const place = await db.query.places.findFirst({ where: eq(places.id, input.placeId) });
  if (!place || place.status !== "PUBLISHED") throw new Error("PUBLISHED_PLACE_REQUIRED");
  const bounds = monthBounds(input.now);
  const monthly = await db.select().from(goldenPickEvents).where(and(
    eq(goldenPickEvents.reviewerUserId, input.reviewerUserId), eq(goldenPickEvents.eventType, "GRANT"),
    gte(goldenPickEvents.effectiveAt, bounds.start), lt(goldenPickEvents.effectiveAt, bounds.end),
  ));
  if (monthly.length >= 3) throw new Error("GOLDEN_PICK_MONTHLY_LIMIT");
  const grants = await db.select().from(goldenPickEvents).where(and(
    eq(goldenPickEvents.reviewerUserId, input.reviewerUserId), eq(goldenPickEvents.placeId, input.placeId), eq(goldenPickEvents.eventType, "GRANT"),
  )).orderBy(asc(goldenPickEvents.effectiveAt));
  const latest = grants.at(-1);
  if (latest && new Date(input.now).getTime() < new Date(addDays(latest.effectiveAt, 90)).getTime()) throw new Error("GOLDEN_PICK_PLACE_COOLDOWN");
  const event = { id: input.id, reviewerUserId: input.reviewerUserId, placeId: input.placeId, eventType: "GRANT" as const, previousEventId: null, reason: null, effectiveAt: input.now, expiresAt: addDays(input.now, 90), createdAt: input.now };
  await db.batch([
    db.insert(goldenPickEvents).values(event),
    db.update(reviewerProfiles).set({ lastActivityAt: input.now, updatedAt: input.now }).where(eq(reviewerProfiles.userId, input.reviewerUserId)),
  ]);
  return event;
}

export async function listActiveGoldenPicks(db: AppDb, now: string, reviewerUserId?: string) {
  const events = await db.select().from(goldenPickEvents).orderBy(asc(goldenPickEvents.effectiveAt));
  const closed = new Set(events.filter((event) => event.eventType !== "GRANT" && event.previousEventId).map((event) => event.previousEventId!));
  return events.filter((event) => event.eventType === "GRANT" && !closed.has(event.id) && event.expiresAt && event.expiresAt > now && (!reviewerUserId || event.reviewerUserId === reviewerUserId));
}

export async function withdrawGoldenPick(db: AppDb, input: {
  id: string; grantEventId: string; reviewerUserId: string; reason: string; now: string;
}) {
  if (!input.reason.trim()) throw new Error("GOLDEN_PICK_REASON_REQUIRED");
  const grant = await db.query.goldenPickEvents.findFirst({ where: eq(goldenPickEvents.id, input.grantEventId) });
  if (!grant || grant.eventType !== "GRANT" || grant.reviewerUserId !== input.reviewerUserId) throw new Error("GOLDEN_PICK_NOT_FOUND");
  const existing = await db.query.goldenPickEvents.findFirst({ where: eq(goldenPickEvents.previousEventId, grant.id) });
  if (existing) throw new Error("GOLDEN_PICK_ALREADY_CLOSED");
  await db.insert(goldenPickEvents).values({ id: input.id, reviewerUserId: grant.reviewerUserId, placeId: grant.placeId, eventType: "WITHDRAW", previousEventId: grant.id, reason: input.reason.trim(), effectiveAt: input.now, expiresAt: null, createdAt: input.now });
}

export async function expireGoldenPicks(db: AppDb, input: { now: string; reviewerUserId?: string }) {
  const events = await db.select().from(goldenPickEvents).orderBy(asc(goldenPickEvents.effectiveAt));
  const closed = new Set(events.filter((event) => event.eventType !== "GRANT" && event.previousEventId).map((event) => event.previousEventId!));
  const expired = events.filter((event) => event.eventType === "GRANT" && !closed.has(event.id) && event.expiresAt && event.expiresAt <= input.now && (!input.reviewerUserId || event.reviewerUserId === input.reviewerUserId));
  if (expired.length) await db.insert(goldenPickEvents).values(expired.map((grant) => ({ id: crypto.randomUUID(), reviewerUserId: grant.reviewerUserId, placeId: grant.placeId, eventType: "EXPIRE" as const, previousEventId: grant.id, reason: "90_DAY_EXPIRATION", effectiveAt: input.now, expiresAt: null, createdAt: input.now })));
  return expired.length;
}
