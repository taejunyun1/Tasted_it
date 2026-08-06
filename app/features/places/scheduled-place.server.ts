import { createDb } from "../../db/client.server";
import { enqueueStalePlaceRevalidations } from "./place-revalidation.server";

export async function runScheduledPlaceMaintenance(env: Env, options?: { now?: string }) {
  return enqueueStalePlaceRevalidations(createDb(env.DB), { now: options?.now ?? new Date().toISOString() });
}
