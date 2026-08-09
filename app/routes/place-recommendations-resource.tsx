import { env } from "cloudflare:workers";
import { data } from "react-router";

import type { Route } from "./+types/place-recommendations-resource";
import { createDb } from "../db/client.server";
import { getOptionalUser } from "../features/auth/session.server";
import { parseMapState } from "../features/maps/map-state";
import { getPlaceRecommendationPage } from "../features/places/place-recommendation.server";

export async function loader({ request }: Route.LoaderArgs) {
  const url = new URL(request.url);
  const state = parseMapState(url.search);
  const [west, south, east, north] = state.bbox;
  const user = await getOptionalUser(request);
  const recommendations = await getPlaceRecommendationPage(createDb(env.DB), {
    userId: user?.id,
    bbox: state.bbox,
    categorySlug: url.searchParams.get("category") || undefined,
    center: { latitude: (south + north) / 2, longitude: (west + east) / 2 },
    selectedBadges: url.searchParams.getAll("badge"),
    now: new Date().toISOString(),
  });
  return data(recommendations);
}

