import { createRequestHandler } from "react-router";
import { runScheduledCandidateSync } from "../app/features/candidates/scheduled-sync.server";

const requestHandler = createRequestHandler(
  () => import("virtual:react-router/server-build"),
  import.meta.env.MODE,
);

export default {
  async fetch(request) {
    return requestHandler(request);
  },
  async scheduled(_controller, env, ctx) {
    ctx.waitUntil(runScheduledCandidateSync(env));
  },
} satisfies ExportedHandler<Env>;
