import { and, eq, inArray } from "drizzle-orm";

import type { AppDb } from "../../db/client.server";
import { adminAuditLogs, categories, naverLocalCategoryVerifications, placeReviewWorkItems } from "../../db/schema";
import { getTerminalCategoryIds } from "../candidates/category-selection";
import { advancePlaceReviewWorkItems } from "./place-review-work-items.server";

const MAX_REVIEW_BATCH_SIZE = 25;

export async function confirmReviewItemCategories(db: AppDb, input: {
  selections: Array<{ workItemId: string; categoryId: string; reason: string }>;
  actorUserId: string;
  now: string;
}) {
  const selections = [...new Map(input.selections.filter((item) => item.workItemId && item.categoryId).map((item) => [item.workItemId, item])).values()];
  if (!selections.length || selections.length > MAX_REVIEW_BATCH_SIZE) throw new Error("PLACE_REVIEW_BATCH_LIMIT_EXCEEDED");
  const categoryRows = await db.select().from(categories).where(eq(categories.isActive, true));
  const terminalCategoryIds = getTerminalCategoryIds(categoryRows);
  const categoriesById = new Map(categoryRows.map((category) => [category.id, category]));
  const workItems = await db.select().from(placeReviewWorkItems).where(inArray(placeReviewWorkItems.id, selections.map((item) => item.workItemId)));
  const workItemsById = new Map(workItems.map((item) => [item.id, item]));
  const confirmed: string[] = [];
  const skipped: Array<{ workItemId: string; code: string }> = [];

  for (const selection of selections) {
    const workItem = workItemsById.get(selection.workItemId);
    const category = categoriesById.get(selection.categoryId);
    if (!workItem || workItem.status !== "ACTIVE" || workItem.stage !== "CATEGORY_CONFIRMATION") { skipped.push({ workItemId: selection.workItemId, code: "NOT_ACTIVE" }); continue; }
    if (!category || !terminalCategoryIds.has(category.id)) { skipped.push({ workItemId: selection.workItemId, code: "CATEGORY_INACTIVE" }); continue; }
    const naverCategoryId = workItem.businessLicenseId
      ? (await db.query.naverLocalCategoryVerifications.findFirst({ where: eq(naverLocalCategoryVerifications.businessLicenseId, workItem.businessLicenseId) }))?.mappedCategoryId
      : null;
    if (naverCategoryId && naverCategoryId !== category.id && selection.reason.trim().length < 10) { skipped.push({ workItemId: selection.workItemId, code: "CATEGORY_OVERRIDE_REASON_REQUIRED" }); continue; }
    const updated = await db.update(placeReviewWorkItems).set({ selectedCategoryId: category.id, categoryOverrideReason: selection.reason.trim() || null, updatedAt: input.now })
      .where(and(eq(placeReviewWorkItems.id, workItem.id), eq(placeReviewWorkItems.stage, "CATEGORY_CONFIRMATION"), eq(placeReviewWorkItems.status, "ACTIVE"), eq(placeReviewWorkItems.stageVersion, workItem.stageVersion))).returning({ id: placeReviewWorkItems.id });
    if (!updated.length) { skipped.push({ workItemId: selection.workItemId, code: "STALE_WORK_ITEM" }); continue; }
    await db.insert(adminAuditLogs).values({ id: crypto.randomUUID(), actorUserId: input.actorUserId, action: "PLACE_REVIEW_CATEGORY_CONFIRMED", targetType: "PLACE_REVIEW_WORK_ITEM", targetId: workItem.id, beforeState: JSON.stringify({ categoryId: workItem.selectedCategoryId }), afterState: JSON.stringify({ categoryId: category.id, reason: selection.reason.trim() || null }), createdAt: input.now });
    const advanced = await advancePlaceReviewWorkItems(db, { workItemIds: [workItem.id], expectedStage: "CATEGORY_CONFIRMATION", expectedVersions: { [workItem.id]: workItem.stageVersion }, actorUserId: input.actorUserId, now: input.now });
    if (advanced.advanced.length) confirmed.push(workItem.id); else skipped.push(...advanced.skipped);
  }
  return { confirmed, skipped };
}
