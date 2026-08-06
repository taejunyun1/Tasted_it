import type { AppDb } from "../../db/client.server";
import { listActiveGoldenPicks } from "../ratings/golden-pick.server";
import { buildDiscoverySections, type DiscoveryCenter } from "./place-discovery";
import { listPlaces } from "./place.server";

export async function getPlaceDiscovery(
  db: AppDb,
  input: { categorySlug?: string; bbox: [number, number, number, number]; center: DiscoveryCenter; now: string },
) {
  const [places, goldenPicks] = await Promise.all([
    listPlaces(db, { categorySlug: input.categorySlug, bbox: input.bbox, limit: 100 }),
    listActiveGoldenPicks(db, input.now),
  ]);
  return buildDiscoverySections(places, goldenPicks, input.center);
}
