import { createDb } from "../../db/client.server";
import { expireGoldenPicks } from "./golden-pick.server";
import { scanVoteIntegrity } from "./integrity.server";
import { processRatingJobs } from "./recompute.server";
import { refreshReviewerTrust } from "./reviewer-trust.server";

export async function runScheduledRatingMaintenance(env: Env, options?: { now?: string; jobLimit?: number }) {
  const now = options?.now ?? new Date().toISOString();
  const db = createDb(env.DB);
  const reviewerTrust = await refreshReviewerTrust(db, { now });
  const jobs = await processRatingJobs(db, { now, limit: options?.jobLimit ?? 25 });
  const expiredGoldenPicks = await expireGoldenPicks(db, { now });
  const integrity = await scanVoteIntegrity(db, { now });
  return { reviewerTrust, jobs, expiredGoldenPicks, integrity };
}
