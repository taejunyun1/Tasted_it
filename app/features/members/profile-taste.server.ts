import { eq } from "drizzle-orm";

import type { AppDb } from "../../db/client.server";
import { userTasteBadges } from "../../db/schema";
import {
  buildTasteProfile,
  inferTasteBadges,
  type TasteBadgeSource,
} from "./profile-taste-badges";

type MemberActivity = { name: string; categoryName: string };
type RatedActivity = MemberActivity & { value: number };
type FlavorTasteGraph = {
  status: "LEARNING" | "VISIBLE";
  placeCount: number;
  dimensions: Array<{ key: string; value: number }>;
};

export async function getMemberTasteProfile(db: AppDb, input: {
  userId: string;
  displayName: string;
  saved: MemberActivity[];
  rated: RatedActivity[];
  tasteGraph: FlavorTasteGraph;
}) {
  const stored = await db.select({
    badgeId: userTasteBadges.badgeId,
    score: userTasteBadges.score,
    source: userTasteBadges.source,
  }).from(userTasteBadges).where(eq(userTasteBadges.userId, input.userId));
  const inferred = inferTasteBadges({
    saved: input.saved,
    rated: input.rated,
    flavorDimensions: input.tasteGraph.status === "VISIBLE" ? input.tasteGraph.dimensions : [],
  });
  return buildTasteProfile({
    displayName: input.displayName,
    stored: stored.map((row) => ({ ...row, source: row.source as TasteBadgeSource })),
    inferred,
  });
}
