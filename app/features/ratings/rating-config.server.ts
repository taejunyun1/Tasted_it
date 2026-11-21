import { eq } from "drizzle-orm";
import type { AppDb } from "../../db/client.server";
import { ratingConfigs } from "../../db/schema";
import { currentRatingConfigIdSql } from "./rating-config-eligibility";

export async function getActiveRatingConfig(db: AppDb, now: string) {
  const config = await db.query.ratingConfigs.findFirst({
    where: eq(ratingConfigs.id, currentRatingConfigIdSql(now)),
  });
  if (!config) throw new Error("ACTIVE_RATING_CONFIG_NOT_FOUND");
  return config;
}
