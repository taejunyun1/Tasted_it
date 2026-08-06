import { createRequestHandler } from "react-router";
import { runScheduledCandidateSync } from "../app/features/candidates/scheduled-sync.server";
import { runScheduledRatingMaintenance } from "../app/features/ratings/scheduled-rating.server";
import { runScheduledPlaceMaintenance } from "../app/features/places/scheduled-place.server";
import { runScheduledAiClassification } from "../app/features/candidates/scheduled-ai.server";

const requestHandler = createRequestHandler(
  () => import("virtual:react-router/server-build"),
  import.meta.env.MODE,
);

export default {
  async fetch(request) {
    return requestHandler(request);
  },
  async scheduled(_controller, env, ctx) {
    ctx.waitUntil(Promise.all([
      runScheduledCandidateSync(env),
      runScheduledRatingMaintenance(env),
      runScheduledPlaceMaintenance(env),
      runScheduledAiClassification(env),
    ]));
  },
} satisfies ExportedHandler<Env>;
