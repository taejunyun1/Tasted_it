import { desc, isNull } from "drizzle-orm";

import type { AppDb } from "../../db/client.server";
import { ratingConfigs } from "../../db/schema";

export async function getActiveRatingConfig(db: AppDb, now: string) {
  const config = await db.query.ratingConfigs.findFirst({
    where: isNull(ratingConfigs.activeUntil),
    orderBy: [desc(ratingConfigs.activeFrom)],
  });
  if (!config) throw new Error("ACTIVE_RATING_CONFIG_NOT_FOUND");
  return config;
}
