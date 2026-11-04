import { and, asc, eq } from "drizzle-orm";

import type { AppDb } from "../../db/client.server";
import { placeReviewWorkItems, users } from "../../db/schema";
import type { NaverLocalSearchAdapter } from "../candidates/naver-local-search.server";
import { verifyReviewItemsWithNaver } from "./place-review-naver.server";
import { sweepConfidentReviewStage } from "./place-review-work-items.server";

/** Audit actor for pipeline-driven transitions. Password-less and cannot log
 * in; exists so adminAuditLogs.actorUserId stays a real users row and every
 * automated move is attributable to the pipeline, not a human operator. */
export const AUTO_PIPELINE_ACTOR_ID = "auto-pipeline";

async function ensureAutoPipelineActor(db: AppDb, now: string) {
  const existing = await db.query.users.findFirst({ where: eq(users.id, AUTO_PIPELINE_ACTOR_ID) });
  if (existing) return;
  await db.insert(users).values({
    id: AUTO_PIPELINE_ACTOR_ID, email: "auto-pipeline@retaste.internal", displayName: "자동 검수 파이프라인",
    role: "ADMIN", passwordHash: null, passwordSalt: null, emailVerifiedAt: null, createdAt: now, updatedAt: now,
  });
}

/** Runs the same gates a human operator stamps, in bounded slices, no publish.
 * Stage order matches the manual queue; each stage is capped so a sync tick
 * never turns into an unbounded scan. NAVER calls use the caller's adapter and
 * existing regional budgets; FINAL_APPROVAL is never entered automatically. */
export async function runAutoReviewPipeline(db: AppDb, input: {
  now: string;
  sweepLimit?: number;
  naverLimit?: number;
  naverAdapter?: NaverLocalSearchAdapter;
  confidentAdvanceEnabled?: boolean;
}) {
  const actorUserId = AUTO_PIPELINE_ACTOR_ID;
  const sweepLimit = input.sweepLimit ?? 50;
  const naverLimit = input.naverLimit ?? 25;
  const summary: Record<string, { scanned: number; advanced: number; skipped: number }> = {};
  if (!input.confidentAdvanceEnabled) return { actorUserId, enabled: false as const, summary };
  await ensureAutoPipelineActor(db, input.now);

  for (const stage of ["SOURCE_REVIEW", "CATEGORY_CONFIRMATION", "DUPLICATE_REVIEW"] as const) {
    if (stage === "CATEGORY_CONFIRMATION" && input.naverAdapter) {
      const naverItems = await db.select({ id: placeReviewWorkItems.id })
        .from(placeReviewWorkItems)
        .where(and(eq(placeReviewWorkItems.stage, "NAVER_VERIFICATION"), eq(placeReviewWorkItems.status, "ACTIVE")))
        .orderBy(asc(placeReviewWorkItems.updatedAt))
        .limit(naverLimit);
      if (naverItems.length) {
        const result = await verifyReviewItemsWithNaver(db, {
          workItemIds: naverItems.map((item) => item.id), actorUserId, now: input.now,
          adapter: input.naverAdapter, confidentAdvanceEnabled: true,
        });
        summary.NAVER_VERIFICATION = { scanned: naverItems.length, advanced: result.passed, skipped: result.skipped.length };
      }
    }
    const result = await sweepConfidentReviewStage(db, {
      stage, limit: sweepLimit, dryRun: false, actorUserId, now: input.now, confidentAdvanceEnabled: true,
    });
    summary[stage] = { scanned: result.scanned, advanced: result.advanced.length, skipped: result.skipped.length };
  }
  return { actorUserId, enabled: true as const, summary };
}
