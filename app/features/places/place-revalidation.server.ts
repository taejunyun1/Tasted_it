import { and, eq, inArray, isNull, lt, or } from "drizzle-orm";

import type { AppDb } from "../../db/client.server";
import { adminAuditLogs, placeRevalidationCases, placeRevisions, places, users } from "../../db/schema";

export async function enqueueStalePlaceRevalidations(db: AppDb, input: { now: string }) {
  const cutoff = new Date(new Date(input.now).getTime() - 90 * 24 * 60 * 60 * 1000).toISOString();
  const targets = await db.select().from(places).where(and(eq(places.status, "PUBLISHED"), or(isNull(places.lastVerifiedAt), lt(places.lastVerifiedAt, cutoff)))).limit(1_000);
  let created = 0;
  for (const place of targets) {
    const existing = await db.query.placeRevalidationCases.findFirst({ where: and(eq(placeRevalidationCases.placeId, place.id), eq(placeRevalidationCases.reasonType, "STALE_90D"), inArray(placeRevalidationCases.status, ["OPEN", "REVIEWING"])) });
    if (existing) continue;
    await db.insert(placeRevalidationCases).values({ id: crypto.randomUUID(), placeId: place.id, reasonType: "STALE_90D", status: "OPEN", evidenceJson: JSON.stringify({ lastVerifiedAt: place.lastVerifiedAt, cutoff }), createdAt: input.now, updatedAt: input.now }); created += 1;
  }
  return { scanned: targets.length, created };
}

export async function resolvePlaceRevalidation(db: AppDb, input: { caseId: string; actorUserId: string; resolution: "KEEP_PUBLISHED" | "KEEP_HIDDEN" | "RESTORE_PUBLISHED"; reason: string; now: string }) {
  const [actor, item] = await Promise.all([db.query.users.findFirst({ where: eq(users.id, input.actorUserId) }), db.query.placeRevalidationCases.findFirst({ where: eq(placeRevalidationCases.id, input.caseId) })]);
  if (actor?.role !== "ADMIN") throw new Error("ADMIN_REQUIRED"); if (!item || !["OPEN", "REVIEWING"].includes(item.status)) throw new Error("REVALIDATION_NOT_REVIEWABLE"); if (!input.reason.trim()) throw new Error("REVIEW_REASON_REQUIRED");
  const place = await db.query.places.findFirst({ where: eq(places.id, item.placeId) }); if (!place) throw new Error("PLACE_NOT_FOUND");
  const status = input.resolution === "KEEP_HIDDEN" ? "HIDDEN" as const : "PUBLISHED" as const;
  const after = { ...place, status, lastVerifiedAt: input.now, closedAt: status === "PUBLISHED" ? null : place.closedAt, updatedAt: input.now };
  await db.batch([
    db.update(places).set(after).where(eq(places.id, place.id)),
    db.update(placeRevalidationCases).set({ status: "RESOLVED", resolution: `${input.resolution}:${input.reason.trim()}`, reviewedBy: input.actorUserId, reviewedAt: input.now, updatedAt: input.now }).where(eq(placeRevalidationCases.id, item.id)),
    db.insert(placeRevisions).values({ id: crypto.randomUUID(), placeId: place.id, actorUserId: input.actorUserId, action: "STATUS_CHANGE", reason: input.reason.trim(), beforeJson: JSON.stringify(place), afterJson: JSON.stringify(after), sourceType: "REVALIDATION_CASE", sourceId: item.id, createdAt: input.now }),
    db.insert(adminAuditLogs).values({ id: crypto.randomUUID(), actorUserId: input.actorUserId, action: "RESOLVE_PLACE_REVALIDATION", targetType: "PLACE", targetId: place.id, beforeState: JSON.stringify(place), afterState: JSON.stringify(after), createdAt: input.now }),
  ]);
  return after;
}
