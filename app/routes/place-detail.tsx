import { env } from "cloudflare:workers";
import { and, eq } from "drizzle-orm";
import { Link, redirect } from "react-router";
import { z } from "zod";
import type { Route } from "./+types/place-detail";
import { createDb, type AppDb } from "../db/client.server";
import { places } from "../db/schema";
import { getPlaceBySlug, resolvePlaceSlugRedirect } from "../features/places/place.server";
import { publicRatingFromPlace, formatRatingGroup, reviewerWeightExplanation } from "../features/ratings/public-rating";
import { formatPublicRatingSummary } from "../features/places/place-discovery";
import { PublicRatingMeta } from "../components/ratings/PublicRatingMeta";
import { FlavorMeter } from "../components/ratings/FlavorMeter";
import { PlaceInformation } from "../components/places/PlaceInformation";
import { PlacePoiPhoto } from "../components/places/PlacePoiPhoto";
import { PlaceInstagramPhoto } from "../components/places/PlaceInstagramPhoto";
import { PlacePhotoOriginalLink } from "../components/places/PlacePhotoOriginalLink";
import { PlaceCorrectionLink, PlacePublicReviewers, PlaceRatingBadges, PlaceReviewPhotos } from "../components/places/PlacePublicEvidence";
import { getPlaceFlavorPrint } from "../features/ratings/flavor-print.server";
import { listActiveGoldenPicks } from "../features/ratings/golden-pick.server";
import { getHiddenGemStatus } from "../features/ratings/rating-badges.server";
import { eligiblePoiMediaPlace, getPublicPoiPhoto } from "../features/poi-media/poi-media.server";
import { curatedInstagramPhoto } from "../features/poi-media/instagram-photos";
import { reviewedPlacePhotoOriginal } from "../features/poi-media/photo-original-sources";
import type { PlaceDetail as PublicPlaceDetail } from "../features/places/place.types";
import { castVote, getCurrentVoteState, withdrawVote } from "../features/ratings/vote.server";
import { getOptionalUser, requireUser } from "../features/auth/session.server";
import { readPlaceMutationBrowseReturn } from "../features/auth/place-detail-return";
import { isSameOriginMutation } from "../features/http/same-origin";
import { getSaved, setSavedAndRefreshTaste } from "../features/saves/save.server";
import { refreshInferredTasteSignals } from "../features/members/taste-learning.server";
import { recordProductEvent, type ProductEventMetadata, type ProductEventName } from "../features/onboarding/onboarding-events.server";
import { getGuestOnboardingFromRequest } from "../features/onboarding/guest-session.server";
import {
  safePlaceDetailRequestPath,
  type RecommendationDiscoveryMode,
  type RecommendationSourceRail,
} from "../components/places/PlaceCard";
import { VoteControl } from "../components/ratings/VoteControl";
import { listPublicPlaceReviewers } from "../features/ratings/reviewer-publication.server";
import { listPublishedPlaceReviewPhotos } from "../features/ratings/reviewer-visit.server";
import { listPublicPilotPhotos } from "../features/ratings/student-review-pilot-photo.server";
import { TempCatalogNotice } from "../features/temp-catalog/TempCatalogNotice";
import { loadPlaceDetailSafely, mutatePlaceDetailSafely } from "../features/places/place-detail-client";
import { placePageMeta, publicPageMeta, resolvePublicOrigin } from "../features/places/public-metadata";

const actionSchema = z.discriminatedUnion("intent", [
  z.object({
    intent: z.literal("vote"),
    value: z.coerce.number().refine((value): value is -1 | 1 => value === -1 || value === 1),
    reason: z.enum(["MENU", "DISTANCE", "PRICE", "ATMOSPHERE", "ALREADY_VISITED"]).nullable().default(null),
  }),
  z.object({ intent: z.literal("withdraw"), expectedEventId: z.string().min(1).max(128) }),
  z.object({ intent: z.literal("save"), saved: z.enum(["true", "false"]).transform((value) => value === "true") }),
]);

function recommendationProvenance(request: Request) {
  const url = new URL(request.url);
  const routeDataMarkers = url.searchParams.getAll("_routes");
  const isCanonicalRouteDataRequest = url.pathname.endsWith(".data")
    && routeDataMarkers.length === 1
    && routeDataMarkers[0] === "routes/place-detail";
  if (isCanonicalRouteDataRequest) {
    url.pathname = url.pathname.slice(0, -".data".length);
    url.searchParams.delete("_routes");
  }
  const requestPath = safePlaceDetailRequestPath(`${url.pathname}${url.search}`);
  if (!requestPath?.includes("?")) return null;
  const validated = new URL(requestPath, "https://retaste.invalid");
  return {
    sourceRail: validated.searchParams.get("sourceRail") as RecommendationSourceRail,
    discoveryMode: validated.searchParams.get("discoveryMode") as RecommendationDiscoveryMode,
    recommendationRequestId: validated.searchParams.get("recommendationRequestId")!,
  };
}

async function recordPlaceProductEvent(db: ReturnType<typeof createDb>, input: {
  eventName: ProductEventName;
  eventId?: string;
  userId: string | null;
  guestSessionId?: string | null;
  metadata?: ProductEventMetadata;
  occurredAt: string;
}) {
  try {
    await recordProductEvent(db, {
      eventName: input.eventName,
      eventId: input.eventId,
      guestSessionId: input.guestSessionId ?? null,
      userId: input.userId,
      metadata: input.metadata,
      occurredAt: input.occurredAt,
    });
  } catch {
    console.error("PRODUCT_EVENT_WRITE_FAILED");
  }
}

async function getPublicPlacePhotoSources(db: AppDb, place: PublicPlaceDetail) {
  if (place.tempCatalog || place.heroImageUrl) return null;
  const instagramPhoto = curatedInstagramPhoto(place, env.POI_INSTAGRAM_PHOTO_ENABLED);
  const photoOriginal = instagramPhoto ? null : reviewedPlacePhotoOriginal(place, env.POI_THREADS_PHOTO_ENABLED);
  if (!instagramPhoto && !photoOriginal) return null;
  try {
    const [eligible] = await db.select({ id: places.id }).from(places)
      .where(and(
        eq(places.id, place.id),
        eq(places.name, place.name),
        eq(places.address, place.address),
        eligiblePoiMediaPlace(db, eq(places.id, place.id)),
      )).limit(1);
    return eligible ? { instagramPhoto, photoOriginal } : null;
  } catch {
    return null;
  }
}

export async function loader({ request, params }: Route.LoaderArgs) {
  const db = createDb(env.DB);
  const redirectedSlug = await resolvePlaceSlugRedirect(db, params.placeSlug);
  if (redirectedSlug) throw redirect(`/places/${redirectedSlug}`, 301);
  const [place, user] = await Promise.all([getPlaceBySlug(db, params.placeSlug), getOptionalUser(request)]);
  const now = new Date().toISOString();
  const provenance = recommendationProvenance(request);
  const guest = provenance && !user ? await getGuestOnboardingFromRequest(db, request, now) : null;
  const [voteState, saved] = user ? await Promise.all([
    getCurrentVoteState(db, { placeId: place.id, userId: user.id }),
    getSaved(db, { placeId: place.id, userId: user.id }),
  ]) : [null, false] as const;
  const [flavorPrint, goldenPicks, hiddenGem, nativeReviewPhotos, publicReviewers, poiPhoto, photoSources, pilotPhotos] = await Promise.all([
    getPlaceFlavorPrint(db, place.id),
    listActiveGoldenPicks(db, now),
    getHiddenGemStatus(db, { placeId: place.id, now }),
    listPublishedPlaceReviewPhotos(db, place.id, 12),
    listPublicPlaceReviewers(db, place.id),
    getPublicPoiPhoto(db, place.id, env.POI_MEDIA_PUBLIC_ENABLED),
    getPublicPlacePhotoSources(db, place),
    env.STUDENT_REVIEW_PILOT_PHOTOS ? listPublicPilotPhotos(db, place.id).catch(() => []) : [],
  ]);
  const reviewPhotos = pilotPhotos.length
    ? [...nativeReviewPhotos, ...pilotPhotos].sort((left, right) =>
      right.publishedAt.localeCompare(left.publishedAt) || right.reviewId.localeCompare(left.reviewId) ||
      left.position - right.position).slice(0, 12)
    : nativeReviewPhotos;
  const rating = publicRatingFromPlace(place);
  if (provenance) {
    await recordPlaceProductEvent(db, {
      eventName: "RECOMMENDATION_DETAIL_OPENED",
      eventId: provenance.recommendationRequestId,
      userId: user?.id ?? null,
      guestSessionId: guest?.sessionId ?? null,
      metadata: {
        sourceRail: provenance.sourceRail,
        discoveryMode: provenance.discoveryMode,
      },
      occurredAt: now,
    });
  }
  const returnTo = provenance
    ? `${new URL(request.url).pathname}${new URL(request.url).search}`
    : `/places/${place.slug}`;
  const publicOrigin = resolvePublicOrigin(request.url, (env as Env & { APP_BASE_URL?: string }).APP_BASE_URL);
  return { place, publicOrigin, rating, flavorPrint, hiddenGem, reviewPhotos, publicReviewers,
    poiPhoto, instagramPhoto: photoSources?.instagramPhoto ?? null,
    photoOriginal: poiPhoto ? null : photoSources?.photoOriginal ?? null,
    hasGoldenPick: goldenPicks.some((pick) => pick.placeId === place.id), user, vote: voteState?.value ?? null, voteEventId: voteState?.eventId ?? null, saved, returnTo };
}

export async function action({ request, params }: Route.ActionArgs) {
  if (!isSameOriginMutation(request)) throw new Response("이 요청은 현재 서비스에서 다시 실행해 주세요.", { status: 403, statusText: "FORBIDDEN" });
  const user = await requireUser(request).catch(async (error: unknown) => {
    if (error instanceof Response && error.status === 302 && error.headers.get("Location")?.startsWith("/login?returnTo=")) {
      const continuation = await readPlaceMutationBrowseReturn(request, params.placeSlug);
      if (continuation) throw redirect(`/login?returnTo=${encodeURIComponent(continuation)}`);
    }
    throw error;
  });
  const parsed = actionSchema.safeParse(Object.fromEntries(await request.formData()));
  if (!parsed.success) throw new Response("Invalid reaction", { status: 400, statusText: "INVALID_REACTION" });
  const db = createDb(env.DB);
  const redirectedSlug = await resolvePlaceSlugRedirect(db, params.placeSlug);
  if (redirectedSlug) throw redirect(`/places/${redirectedSlug}`, 308);
  const place = await getPlaceBySlug(db, params.placeSlug);
  const now = new Date().toISOString();
  const provenance = recommendationProvenance(request);
  if (parsed.data.intent === "vote") {
    try {
      await castVote(db, { placeId: place.id, userId: user.id, value: parsed.data.value, eventId: crypto.randomUUID(), now, feedback: { reason: parsed.data.reason } });
    } catch (error) {
      if (error instanceof Error && error.message === "VOTE_VERSION_CONFLICT") return Response.json({ ok: false, intent: "vote", requiresRefresh: true, error: "VOTE_VERSION_CONFLICT", message: "다른 요청에서 평가가 변경되었습니다. 현재 상태를 다시 확인해 주세요." }, { status: 409 });
      throw error;
    }
    try {
      await refreshInferredTasteSignals(db, user.id, now);
    } catch {
      console.error("TASTE_LEARNING_REFRESH_FAILED");
    }
    if (provenance) await recordPlaceProductEvent(db, {
      eventName: parsed.data.value === 1 ? "RECOMMENDATION_LIKED" : "RECOMMENDATION_DISLIKED",
      userId: user.id,
      metadata: {
        sourceRail: provenance.sourceRail,
        discoveryMode: provenance.discoveryMode,
        ...(parsed.data.value === -1 && parsed.data.reason ? { reason: parsed.data.reason } : {}),
      },
      occurredAt: now,
    });
  } else if (parsed.data.intent === "withdraw") {
    try {
      await withdrawVote(db, { placeId: place.id, userId: user.id, eventId: crypto.randomUUID(), now, clearFeedback: true, expectedEventId: parsed.data.expectedEventId });
    } catch (error) {
      if (error instanceof Error && error.message === "VOTE_VERSION_CONFLICT") return Response.json({ ok: false, intent: "withdraw", requiresRefresh: true, error: "VOTE_VERSION_CONFLICT", message: "다른 요청에서 평가가 변경되었습니다. 현재 상태를 다시 확인해 주세요." }, { status: 409 });
      throw error;
    }
    try {
      await refreshInferredTasteSignals(db, user.id, now);
    } catch {
      console.error("TASTE_LEARNING_REFRESH_FAILED");
    }
  } else {
    await setSavedAndRefreshTaste(db, { placeId: place.id, userId: user.id, saved: parsed.data.saved, now });
    if (parsed.data.saved && provenance) {
      await recordPlaceProductEvent(db, {
        eventName: "RECOMMENDATION_SAVED",
        userId: user.id,
        metadata: {
          sourceRail: provenance.sourceRail,
          discoveryMode: provenance.discoveryMode,
        },
        occurredAt: now,
      });
    }
  }
  return { ok: true };
}

export async function clientLoader({ serverLoader }: Route.ClientLoaderArgs) {
  return loadPlaceDetailSafely(serverLoader);
}

export async function clientAction({ request, serverAction }: Route.ClientActionArgs) {
  const formData = await request.clone().formData();
  const intent = formData.get("intent");
  const outcome = await mutatePlaceDetailSafely(serverAction);
  if ((intent === "vote" || intent === "withdraw") && outcome && typeof outcome === "object" && "ok" in outcome) {
    return { ...outcome, intent, ...(intent === "vote" && outcome.ok === true ? { value: formData.get("value") === "-1" ? -1 as const : 1 as const } : {}) };
  }
  return outcome;
}

export function meta({ loaderData }: Route.MetaArgs) {
  return loaderData && !("detailError" in loaderData) && loaderData.place
    ? placePageMeta(loaderData.place, loaderData.publicOrigin)
    : publicPageMeta({ title: "장소 상세 — Re:Taste", description: "광주·전남 맛 지도", path: "/places", noindex: true });
}

export default function PlaceDetail({ loaderData }: Route.ComponentProps) {
  if ("detailError" in loaderData) {
    const unavailable = loaderData.status === 404 || loaderData.status === 403;
    return <main id="main" className="error-page">
      <p className="eyebrow">{unavailable ? `${loaderData.status} / UNAVAILABLE` : "CONNECTION / RETRY"}</p>
      <h1>{loaderData.status === 404 ? "이 장소를 찾을 수 없어요." : loaderData.status === 403 ? "이 장소를 볼 수 없어요." : "장소 정보를 불러오지 못했어요."}</h1>
      <p role="status">{unavailable ? "공개된 다른 장소를 찾아보세요." : "연결 상태를 확인한 뒤 다시 시도해 주세요."}</p>
      {!unavailable && <button type="button" onClick={() => window.location.reload()}>다시 불러오기</button>}
      <Link to="/places">맛집 리스트로</Link>
    </main>;
  }
  const { place, rating, flavorPrint, reviewPhotos, publicReviewers, poiPhoto, instagramPhoto, photoOriginal } = loaderData;
  const query = encodeURIComponent(place.address);
  return (
    <main id="main" className="detail shell">
      <Link className="back-link" to={`/?category=${encodeURIComponent(place.primaryCategory.slug)}`}>← {place.primaryCategory.name} 지도로</Link>
      <div className="detail-grid">
        {poiPhoto ? <PlacePoiPhoto photo={poiPhoto} placeName={place.name} heroClassName="detail-hero" /> :
        instagramPhoto ? <div className="min-w-0 bg-[var(--atlas-paper-deep)] p-4 sm:p-6">
          <PlaceInstagramPhoto photo={instagramPhoto} placeName={place.name} />
        </div> : photoOriginal?.embedUrl ? <div className="min-w-0 bg-[var(--atlas-paper-deep)] p-4 sm:p-6">
          <PlacePhotoOriginalLink key={photoOriginal.url} source={photoOriginal} />
        </div> :
        <div className="detail-hero" data-has-photo={Boolean(place.heroImageUrl)}>{place.heroImageUrl ? <img src={place.heroImageUrl} alt={`${place.name} 대표`} /> : <span>{place.primaryCategory.emoji}<br />{place.tempCatalog ? "TEMP · 사진 미제공" : "아직 등록된 사진이 없어요."}</span>}</div>}
        <article className="detail-copy">
          <p className="eyebrow">{place.primaryCategory.emoji} {place.primaryCategory.name} · {place.neighborhood}</p><h1>{place.name}</h1>
          {place.tempCatalog && <TempCatalogNotice info={place.tempCatalog} />}
          <PlaceRatingBadges goldenPick={loaderData.hasGoldenPick} hiddenGem={loaderData.hiddenGem.eligible} />
          <div className="score"><div><strong>{rating.overallScore !== null ? `${rating.overallScore}%` : rating.overallSampleCount < 8 ? `${rating.overallSampleCount}/8` : `${rating.overallSampleCount}명`}</strong><p className="public-rating-summary">{formatPublicRatingSummary(place)}</p></div><PublicRatingMeta place={place} /></div>
          <section className="rating-breakdown" aria-labelledby="rating-breakdown-title"><h2 id="rating-breakdown-title">평가 구성</h2><div><span>일반 회원</span><strong>{formatRatingGroup(rating.userScore, rating.userSampleCount)}</strong></div><div><span>리뷰어</span><strong>{formatRatingGroup(rating.reviewerScore, rating.reviewerSampleCount)}</strong></div><small>{reviewerWeightExplanation(rating.userSampleCount)}</small></section>
          {flavorPrint.status === "VISIBLE" ? <section className="flavor-print"><h2>Flavor Print</h2>{flavorPrint.dimensions.map((dimension) => <div key={dimension.key}><span>{dimension.key}</span><FlavorMeter dimension={dimension.key} value={dimension.median} /><strong>{dimension.median}/5</strong></div>)}</section> : <section className="flavor-print"><h2>Flavor Print</h2><p>리뷰어 평가 수집 중 · {flavorPrint.ratingCount}/3</p></section>}
          <PlaceInformation place={place} />
          {photoOriginal && !photoOriginal.embedUrl && <PlacePhotoOriginalLink source={photoOriginal} />}
          <fieldset className="contents"><legend className="sr-only">장소 평가와 저장</legend><VoteControl key={place.id} placeId={place.id} vote={loaderData.vote} voteEventId={loaderData.voteEventId} saved={loaderData.saved} signedIn={Boolean(loaderData.user)} returnTo={loaderData.returnTo} /></fieldset>
          <PlaceCorrectionLink placeId={place.id} />
          <div className="directions"><a href={`https://map.naver.com/p/search/${query}`} target="_blank" rel="noreferrer">네이버 지도에서 길찾기</a></div>
          <PlacePublicReviewers reviewers={publicReviewers} />
          <PlaceReviewPhotos placeName={place.name} photos={reviewPhotos} />
        </article>
      </div>
    </main>
  );
}
