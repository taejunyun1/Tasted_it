import { createDb } from "../../db/client.server";
import { expireGoldenPicks } from "./golden-pick.server";
import { scanVoteIntegrity } from "./integrity.server";
import { processRatingJobs } from "./recompute.server";
import { refreshReviewerTrust } from "./reviewer-trust.server";
import { recordOperationalAlert } from "../operations/alerts.server";
import { recoverPendingReviewerPhotoCleanup } from "./reviewer-photo-deletion.server";

export async function runScheduledRatingMaintenance(env: Env, options?: { now?: string; jobLimit?: number }) {
  const now = options?.now ?? new Date().toISOString();
  const db = createDb(env.DB);
  const reviewerTrust = await refreshReviewerTrust(db, { now });
  const jobs = await processRatingJobs(db, { now, limit: options?.jobLimit ?? 25 });
  if (jobs.failed) await recordOperationalAlert(db, { alertType: "RATING_RECOMPUTE", sourceId: null, message: `${jobs.failed}개 평가 재계산 실패`, details: jobs, now });
  const expiredGoldenPicks = await expireGoldenPicks(db, { now });
  const integrity = await scanVoteIntegrity(db, { now });
  let photoCleanup = { deleted: 0, pending: 0, failed: 0 };
  try {
    photoCleanup = await recoverPendingReviewerPhotoCleanup(db, env.REVIEW_PHOTOS, { now });
  } catch {
    photoCleanup = { deleted: 0, pending: 0, failed: 1 };
  }
  if (photoCleanup.failed) {
    // Keys and user data are intentionally excluded from operational logs.
    console.warn("REVIEW_PHOTO_CLEANUP_PENDING", { failed: photoCleanup.failed, pending: photoCleanup.pending });
  }
  return { reviewerTrust, jobs, expiredGoldenPicks, integrity, photoCleanup };
}
