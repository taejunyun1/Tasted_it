import type { AppDb } from "../../db/client.server";
import { placeCategoryV5Profiles } from "../../db/schema";
import { classifyPlaceCategoryV5 } from "./category-v5";
import type { PlaceCategoryV5Input } from "./category-v5.types";

export async function savePlaceCategoryV5Profile(
  db: AppDb,
  input: PlaceCategoryV5Input & { placeId: string; now: string; mode: "SHADOW" | "APPLY_VERIFIED" },
) {
  const profile = classifyPlaceCategoryV5(input);
  const values = {
    placeId: input.placeId,
    primaryCategorySlug: profile.primarySlug,
    secondaryCategorySlugsJson: JSON.stringify(profile.secondarySlugs),
    traitsJson: JSON.stringify(profile.traits),
    foodPlaceScore: profile.foodPlaceScore,
    state: profile.state,
    decision: profile.decision,
    evidenceCodesJson: JSON.stringify(profile.evidence.map((item) => item.code)),
    reasonCodesJson: JSON.stringify(profile.reasonCodes),
    algorithmVersion: profile.algorithmVersion,
    lastClassifiedAt: input.now,
    appliedAt: null,
    createdAt: input.now,
    updatedAt: input.now,
  };
  await db.insert(placeCategoryV5Profiles).values(values).onConflictDoUpdate({
    target: placeCategoryV5Profiles.placeId,
    set: { ...values, placeId: undefined, createdAt: undefined },
  });
  return profile;
}
