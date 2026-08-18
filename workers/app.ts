import { createRequestHandler } from "react-router";
import { runScheduledCandidateSync } from "../app/features/candidates/scheduled-sync.server";
import { withSecurityHeaders } from "../app/features/http/security-headers";
import { runScheduledRatingMaintenance } from "../app/features/ratings/scheduled-rating.server";
import { runScheduledPlaceMaintenance } from "../app/features/places/scheduled-place.server";
import { runScheduledParkingSync } from "../app/features/parking/scheduled-parking.server";
import { runScheduledOnboardingDataLifecycle } from "../app/features/onboarding/data-lifecycle.server";

const requestHandler = createRequestHandler(
  () => import("virtual:react-router/server-build"),
  import.meta.env.MODE,
);

export default {
  async fetch(request) {
    return withSecurityHeaders(await requestHandler(request));
  },
  async scheduled(_controller, env, ctx) {
    ctx.waitUntil(Promise.all([
      runScheduledCandidateSync(env),
      runScheduledRatingMaintenance(env),
      runScheduledPlaceMaintenance(env),
      runScheduledParkingSync(env),
      runScheduledOnboardingDataLifecycle(env),
    ]));
  },
} satisfies ExportedHandler<Env>;
