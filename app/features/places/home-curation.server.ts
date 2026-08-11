import type { AppDb } from "../../db/client.server";
import {
  homeTimeSlotAt,
  type HomeCurationMode,
} from "../maps/home-curation-options";
import {
  rankHomeCuration,
  type HomeCurationPage,
} from "./home-curation";
import type { DiscoveryCenter } from "./place-discovery";
import { loadRecommendationCandidateContext } from "./recommendation-candidates.server";

export type HomeCurationRequest = {
  userId?: string | null;
  tasteBadgeIds?: string[];
  bbox: [number, number, number, number];
  categorySlug?: string;
  center: DiscoveryCenter;
  mode: HomeCurationMode;
  now: string;
};

export async function getHomeCurationPage(
  db: AppDb,
  input: HomeCurationRequest,
): Promise<HomeCurationPage> {
  const context = await loadRecommendationCandidateContext(db, input);
  const timeSlot = homeTimeSlotAt(new Date(input.now));
  const base = {
    places: context.candidates,
    goldenPicks: context.goldenPicks,
    center: input.center,
    tasteSignals: context.tasteSignals,
    mode: input.mode,
    timeSlot,
  };
  const withinThreeKilometers = rankHomeCuration({
    ...base,
    radiusMeters: 3_000,
  });
  const radiusMeters = withinThreeKilometers.length >= 5 ? 3_000 : 5_000;
  const curatedPlaces = radiusMeters === 3_000
    ? withinThreeKilometers
    : rankHomeCuration({ ...base, radiusMeters });

  return {
    status: curatedPlaces.length ? "READY" : "EMPTY",
    places: curatedPlaces,
    mode: input.mode,
    timeSlot,
    radiusMeters,
  };
}
