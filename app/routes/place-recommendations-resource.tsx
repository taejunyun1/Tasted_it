import { env } from "cloudflare:workers";
import { data } from "react-router";

import type { Route } from "./+types/place-recommendations-resource";
import { createDb } from "../db/client.server";
import { getOptionalUser } from "../features/auth/session.server";
import { parseMapState } from "../features/maps/map-state";
import { getGuestOnboardingFromRequest } from "../features/onboarding/guest-session.server";
import { getPlaceRecommendationPage } from "../features/places/place-recommendation.server";

export async function loader({ request }: Route.LoaderArgs) {
  try {
    const url = new URL(request.url);
    const state = parseMapState(url.search);
    const [west, south, east, north] = state.bbox;
    const db = createDb(env.DB);
    const now = new Date().toISOString();
    const user = await getOptionalUser(request);
    const guest = user ? null : await getGuestOnboardingFromRequest(db, request, now);
    const recommendations = await getPlaceRecommendationPage(db, {
      userId: user?.id,
      tasteBadgeIds: guest ? [...guest.foodBadgeIds, ...guest.styleBadgeIds] : [],
      bbox: state.bbox,
      categorySlug: url.searchParams.get("category") || undefined,
      center: { latitude: (south + north) / 2, longitude: (west + east) / 2 },
      selectedBadges: url.searchParams.getAll("badge"),
      now,
    });
    return data({ ok: true as const, recommendations });
  } catch (error) {
    console.error("PLACE_RECOMMENDATION_RESOURCE_FAILED", error);
    return data({ ok: false as const, message: "추천을 다시 불러오지 못했어요. 기존 결과를 유지합니다." });
  }
}
