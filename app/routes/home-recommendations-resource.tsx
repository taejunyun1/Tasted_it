import { env } from "cloudflare:workers";
import { data } from "react-router";

import type { Route } from "./+types/home-recommendations-resource";
import { createDb } from "../db/client.server";
import { getOptionalUser } from "../features/auth/session.server";
import { parseHomeRecommendationRequest } from "../features/maps/home-curation-options";
import { getGuestOnboardingFromRequest } from "../features/onboarding/guest-session.server";
import { getHomeCurationPage } from "../features/places/home-curation.server";
import { readMapResource } from "../features/maps/map-read-recovery";
import { mapViewerKey } from "../features/maps/map-viewer-key.server";

export async function clientLoader({ request, serverLoader }: Route.ClientLoaderArgs) {
  return readMapResource(request, serverLoader);
}

export async function loader({ request }: Route.LoaderArgs) {
  let state: ReturnType<typeof parseHomeRecommendationRequest>;
  try {
    state = parseHomeRecommendationRequest(new URL(request.url).search);
  } catch {
    return data({
      ok: false as const,
      message: "추천 조건이 올바르지 않아요.",
    }, { status: 400 });
  }

  try {
    const db = createDb(env.DB);
    const now = new Date().toISOString();
    const user = await getOptionalUser(request);
    const guest = !user && env.ONBOARDING_ENABLED === "true"
      ? await getGuestOnboardingFromRequest(db, request, now)
      : null;
    const recommendations = await getHomeCurationPage(db, {
      userId: user?.id,
      tasteBadgeIds: guest ? [...guest.foodBadgeIds, ...guest.styleBadgeIds] : [],
      bbox: state.bbox,
      center: state.center,
      mode: state.mode,
      now,
      history: state.history,
      locationSource: state.locationSource,
    });

    if (recommendations.status === "UNAVAILABLE") return data({
      ok: false as const,
      requestToken: state.requestToken,
      message: recommendations.notice,
    }, { status: 503 });

    return data({
      ok: true as const,
      requestToken: state.requestToken,
      mapViewerKey: await mapViewerKey(request, user),
      recommendations,
    });
  } catch (error) {
    console.error("HOME_RECOMMENDATION_RESOURCE_FAILED", error);
    return data({
      ok: false as const,
      requestToken: state.requestToken,
      message: "추천을 다시 불러오지 못했어요. 기존 결과를 유지합니다.",
    }, { status: 503 });
  }
}
