import { createRequestHandler } from "react-router";
import { withDeploymentFence } from "../app/features/operations/deployment-fence";
import { runScheduledCandidateSync } from "../app/features/candidates/scheduled-sync.server";
import { withSecurityHeaders } from "../app/features/http/security-headers";
import { runScheduledRatingMaintenance } from "../app/features/ratings/scheduled-rating.server";
import { runScheduledPlaceMaintenance } from "../app/features/places/scheduled-place.server";
import { runScheduledParkingSync } from "../app/features/parking/scheduled-parking.server";
import { runScheduledOnboardingDataLifecycle } from "../app/features/onboarding/data-lifecycle.server";
import { isRsiCron } from "../app/features/operations/rsi-self-check";
import { createDb } from "../app/db/client.server";
import { cleanupPilotPhotos } from "../app/features/ratings/student-review-pilot-photo.server";
import { handleRsiOnDemandRequest, runScheduledRsiSelfCheck } from "../app/features/operations/rsi-self-check.server";

const requestHandler = createRequestHandler(
  () => import("virtual:react-router/server-build"),
  import.meta.env.MODE,
);

export default withDeploymentFence<Env & Pick<Cloudflare.Env, "POI_INSTAGRAM_PHOTO_ENABLED" | "POI_THREADS_PHOTO_ENABLED" | "STUDENT_REVIEW_PILOT_PHOTOS">>({
  async fetch(request, env) {
    const rsi = await handleRsiOnDemandRequest(request, env);
    if (rsi) return withSecurityHeaders(rsi, request);
    return withSecurityHeaders(await requestHandler(request), request, env.POI_INSTAGRAM_PHOTO_ENABLED, env.POI_THREADS_PHOTO_ENABLED);
  },
  async scheduled(controller, env, ctx) {
    if (isRsiCron(controller.cron)) {
      ctx.waitUntil(runScheduledRsiSelfCheck(env));
      return;
    }
    if (env.STUDENT_REVIEW_PILOT_PHOTOS) {
      ctx.waitUntil(cleanupPilotPhotos(createDb(env.DB), env.STUDENT_REVIEW_PILOT_PHOTOS, new Date().toISOString()));
    }
    ctx.waitUntil(Promise.all([
      runScheduledCandidateSync(env),
      runScheduledRatingMaintenance(env),
      runScheduledPlaceMaintenance(env),
      runScheduledParkingSync(env),
      runScheduledOnboardingDataLifecycle(env),
    ]));
  },
});
