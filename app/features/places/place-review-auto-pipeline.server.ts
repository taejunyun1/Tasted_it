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

/** Per-item verify calls run in flights of this size; each call is one external
 * request, so a flight of five keeps a scheduled tick within its budget while
 * still draining more than a single candidate per run. */
const NAVER_VERIFY_FLIGHT = 5;

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
        // verifyReviewItemsWithNaver caps each call at one item (external request
        // per item by design); run the bounded slice in small parallel flights so
        // naverLimit is real instead of collapsing to a single verification.
        const adapter = input.naverAdapter;
        let scanned = 0;
        let advanced = 0;
        let skipped = 0;
        for (let index = 0; index < naverItems.length; index += NAVER_VERIFY_FLIGHT) {
          const results = await Promise.all(naverItems.slice(index, index + NAVER_VERIFY_FLIGHT).map((item) =>
            verifyReviewItemsWithNaver(db, {
              workItemIds: [item.id], actorUserId, now: input.now,
              adapter, confidentAdvanceEnabled: true,
            }).catch(() => null)));
          for (const result of results) {
            if (!result) { skipped += 1; continue; }
            scanned += result.scanned;
            advanced += result.passed;
            skipped += result.skipped.length;
          }
        }
        summary.NAVER_VERIFICATION = { scanned, advanced, skipped };
      }
    }
    const result = await sweepConfidentReviewStage(db, {
      stage, limit: sweepLimit, dryRun: false, actorUserId, now: input.now, confidentAdvanceEnabled: true,
    });
    summary[stage] = { scanned: result.scanned, advanced: result.advanced.length, skipped: result.skipped.length };
  }
  return { actorUserId, enabled: true as const, summary };
}
