import { and, eq, inArray, isNull, notExists } from "drizzle-orm";

import type { AppDb } from "../../db/client.server";
import { adminAuditLogs, businessLicenses, categories, placeCategories, placeIntakeReviewLinks, placeReviewWorkItems, places } from "../../db/schema";
import { approveCandidate } from "../candidates/candidate.server";
import { getTerminalCategoryIds } from "../candidates/category-selection";
import { REVIEW_BATCH_MAX } from "./place-review-io";
import { listReviewDuplicateCandidates } from "./place-review-duplicates.server";
import { enforceReviewDiningExclusion } from "./local-dining-review.server";

function uniqueIds(ids: string[]) {
  const unique = [...new Set(ids.filter(Boolean))];
  if (unique.length > REVIEW_BATCH_MAX) throw new Error("PLACE_REVIEW_BATCH_LIMIT_EXCEEDED");
  return unique;
}

/** Publishes only final-stage items explicitly selected by an administrator. */
export async function publishReviewedPlaces(db: AppDb, input: {
  workItemIds: string[];
  expectedVersions: Record<string, number>;
  actorUserId: string;
  now: string;
}) {
  const ids = uniqueIds(input.workItemIds);
  const published: string[] = [];
  const skipped: Array<{ workItemId: string; code: string }> = [];
  const items = await db.select({ item: placeReviewWorkItems, intakeMode: placeIntakeReviewLinks.mode }).from(placeReviewWorkItems)
    .leftJoin(placeIntakeReviewLinks, eq(placeIntakeReviewLinks.workItemId, placeReviewWorkItems.id))
    .where(inArray(placeReviewWorkItems.id, ids));
  const activeCategories = await db.select({ id: categories.id, parentId: categories.parentId }).from(categories).where(eq(categories.isActive, true));
  const terminalCategoryIds = getTerminalCategoryIds(activeCategories);

  for (const { item, intakeMode } of items) {
    if (intakeMode) {
      skipped.push({ workItemId: item.id, code: "PUBLISH_CONFIRM_REQUIRED" });
      continue;
    }
    if (item.status !== "ACTIVE" || item.stage !== "FINAL_APPROVAL" || input.expectedVersions[item.id] !== item.stageVersion) {
      skipped.push({ workItemId: item.id, code: "STALE_WORK_ITEM" });
      continue;
    }
    if (!item.selectedCategoryId || !terminalCategoryIds.has(item.selectedCategoryId)) {
      skipped.push({ workItemId: item.id, code: "CATEGORY_REQUIRED" });
      continue;
    }
    const dining = await enforceReviewDiningExclusion(db, item, input.actorUserId, input.now);
    if (dining.decision.decision !== "ELIGIBLE") {
      skipped.push({ workItemId: item.id, code: dining.decision.decision === "EXCLUDE" ? "ACTIVE_EXCLUSION" : "LOCAL_DINING_REVIEW_REQUIRED" });
      continue;
    }
    const duplicateCandidates = await listReviewDuplicateCandidates(db, [item.id]);
    if (duplicateCandidates.some((candidate) => candidate.decision !== "DISTINCT")) {
      skipped.push({ workItemId: item.id, code: "DUPLICATE_REVIEW_REQUIRED" });
      continue;
    }

    const claimToken = crypto.randomUUID();
    const claimed = await db.update(placeReviewWorkItems).set({
      claimToken, claimedBy: input.actorUserId, claimedAt: input.now, updatedAt: input.now,
    }).where(and(
      eq(placeReviewWorkItems.id, item.id), eq(placeReviewWorkItems.status, "ACTIVE"),
      eq(placeReviewWorkItems.stage, "FINAL_APPROVAL"), eq(placeReviewWorkItems.stageVersion, item.stageVersion),
      isNull(placeReviewWorkItems.claimToken),
      notExists(db.select({ workItemId: placeIntakeReviewLinks.workItemId }).from(placeIntakeReviewLinks)
        .where(eq(placeIntakeReviewLinks.workItemId, item.id))),
    )).returning({ id: placeReviewWorkItems.id });
    if (!claimed.length) {
      skipped.push({ workItemId: item.id, code: "STALE_WORK_ITEM" });
      continue;
    }

    try {
      if (item.businessLicenseId) {
        const candidate = await db.query.businessLicenses.findFirst({ where: eq(businessLicenses.id, item.businessLicenseId) });
        const address = candidate?.roadAddress ?? candidate?.lotAddress ?? "";
        if (!candidate || candidate.latitude == null || candidate.longitude == null) throw new Error("SOURCE_NOT_READY");
        await approveCandidate(db, {
          candidateId: candidate.id, actorUserId: input.actorUserId, categoryId: item.selectedCategoryId,
          name: candidate.businessName, address, latitude: candidate.latitude, longitude: candidate.longitude, now: input.now,
        });
      } else if (item.placeId) {
        const place = await db.query.places.findFirst({ where: eq(places.id, item.placeId) });
        if (!place) throw new Error("PLACE_NOT_FOUND");
        await db.batch([
          db.update(places).set({ status: "PUBLISHED", updatedAt: input.now }).where(eq(places.id, place.id)),
          db.update(placeCategories).set({ isPrimary: false }).where(eq(placeCategories.placeId, place.id)),
          db.insert(placeCategories).values({ placeId: place.id, categoryId: item.selectedCategoryId, isPrimary: true }).onConflictDoUpdate({
            target: [placeCategories.placeId, placeCategories.categoryId], set: { isPrimary: true },
          }),
        ]);
      } else {
        throw new Error("REVIEW_SUBJECT_MISSING");
      }

      await db.batch([
        db.update(placeReviewWorkItems).set({
          status: "COMPLETED", completedAt: input.now, lastTransitionBy: input.actorUserId, lastTransitionAt: input.now, updatedAt: input.now,
        }).where(and(eq(placeReviewWorkItems.id, item.id), eq(placeReviewWorkItems.claimToken, claimToken))),
        db.insert(adminAuditLogs).values({
          id: crypto.randomUUID(), actorUserId: input.actorUserId, action: "PLACE_REVIEW_PUBLISH",
          targetType: "PLACE_REVIEW_WORK_ITEM", targetId: item.id,
          beforeState: JSON.stringify({ stage: item.stage, status: item.status }), afterState: JSON.stringify({ status: "COMPLETED", published: true }), createdAt: input.now,
        }),
      ]);
      published.push(item.id);
    } catch (error) {
      await db.update(placeReviewWorkItems).set({
        claimToken: null, claimedBy: null, claimedAt: null, holdCode: "PUBLISH_FAILED", holdNote: error instanceof Error ? error.message : "PUBLISH_FAILED", updatedAt: input.now,
      }).where(and(eq(placeReviewWorkItems.id, item.id), eq(placeReviewWorkItems.claimToken, claimToken)));
      skipped.push({ workItemId: item.id, code: error instanceof Error ? error.message : "PUBLISH_FAILED" });
    }
  }
  return { published, skipped };
}
