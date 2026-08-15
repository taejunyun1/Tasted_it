import { and, eq, inArray } from "drizzle-orm";

import type { AppDb } from "../../db/client.server";
import { adminAuditLogs, places } from "../../db/schema";

const recallAction = "RECALL_PUBLISHED_PLACES_FOR_CATEGORY_AUDIT";
const restoreAction = "RESTORE_PUBLISHED_PLACES_FOR_CATEGORY_AUDIT";

function hasAuditRunAt(value: string | null, auditRunAt: string) {
  try {
    return JSON.parse(value ?? "{}").auditRunAt === auditRunAt;
  } catch {
    return false;
  }
}

export async function recallPublishedPlaces(db: AppDb, input: { actorUserId: string | null; now: string; reason: string }) {
  const targets = await db.select({ id: places.id }).from(places).where(eq(places.status, "PUBLISHED"));
  if (!targets.length) return { recalled: 0, auditRunAt: input.now };
  const targetIds = targets.map((target) => target.id);
  const statements = [
    ...targetIds.map((targetId) => db.insert(adminAuditLogs).values({
      id: crypto.randomUUID(), actorUserId: input.actorUserId, action: recallAction,
      targetType: "PLACE", targetId,
      beforeState: JSON.stringify({ status: "PUBLISHED" }),
      afterState: JSON.stringify({ status: "HIDDEN", auditRunAt: input.now, reason: input.reason }),
      createdAt: input.now,
    })),
    db.update(places).set({ status: "HIDDEN", updatedAt: input.now }).where(inArray(places.id, targetIds)),
  ];
  const [firstStatement, ...remainingStatements] = statements;
  await db.batch([firstStatement!, ...remainingStatements]);
  return { recalled: targetIds.length, auditRunAt: input.now };
}

export async function restoreRecalledPlaces(db: AppDb, input: { actorUserId: string | null; auditRunAt: string; now: string; reason: string }) {
  const audits = await db.select({ targetId: adminAuditLogs.targetId, afterState: adminAuditLogs.afterState })
    .from(adminAuditLogs).where(eq(adminAuditLogs.action, recallAction));
  const targetIds = [...new Set(audits.filter((audit) => hasAuditRunAt(audit.afterState, input.auditRunAt)).map((audit) => audit.targetId))];
  if (!targetIds.length) return { restored: 0 };
  const hiddenTargets = await db.select({ id: places.id }).from(places)
    .where(and(inArray(places.id, targetIds), eq(places.status, "HIDDEN")));
  const hiddenIds = hiddenTargets.map((target) => target.id);
  if (!hiddenIds.length) return { restored: 0 };
  const statements = [
    ...hiddenIds.map((targetId) => db.insert(adminAuditLogs).values({
      id: crypto.randomUUID(), actorUserId: input.actorUserId, action: restoreAction,
      targetType: "PLACE", targetId,
      beforeState: JSON.stringify({ status: "HIDDEN", auditRunAt: input.auditRunAt }),
      afterState: JSON.stringify({ status: "PUBLISHED", reason: input.reason }),
      createdAt: input.now,
    })),
    db.update(places).set({ status: "PUBLISHED", updatedAt: input.now }).where(inArray(places.id, hiddenIds)),
  ];
  const [firstStatement, ...remainingStatements] = statements;
  await db.batch([firstStatement!, ...remainingStatements]);
  return { restored: hiddenIds.length };
}
