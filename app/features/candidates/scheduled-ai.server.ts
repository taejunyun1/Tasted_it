import { createDb } from "../../db/client.server";
import { classifyPendingCandidatesWithAi } from "./ai-classification.server";

export function runScheduledAiClassification(env: Env, options?: { now?: string; limit?: number }) {
  return classifyPendingCandidatesWithAi(createDb(env.DB), env.AI, { now: options?.now ?? new Date().toISOString(), limit: options?.limit ?? 10 });
}
