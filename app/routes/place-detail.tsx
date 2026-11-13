import { env } from "cloudflare:workers";
import { Link, redirect } from "react-router";
import { z } from "zod";
import type { Route } from "./+types/place-detail";
import { createDb } from "../db/client.server";
import { getPlaceBySlug, resolvePlaceSlugRedirect } from "../features/places/place.server";
import { calculateRating } from "../features/ratings/rating-v1";
import { getLatestRatingSnapshot } from "../features/ratings/recompute.server";
import { getPlaceFlavorPrint } from "../features/ratings/flavor-print.server";
import { listActiveGoldenPicks } from "../features/ratings/golden-pick.server";
import { getHiddenGemStatus } from "../features/ratings/rating-badges.server";
import { castVote, getCurrentVote, withdrawVote } from "../features/ratings/vote.server";
import { getOptionalUser, requireUser } from "../features/auth/session.server";
import { isSameOriginMutation } from "../features/http/same-origin";
import { getSaved, setSavedAndRefreshTaste } from "../features/saves/save.server";
import { clearRecommendationFeedback, recordRecommendationFeedback, refreshInferredTasteSignals } from "../features/members/taste-learning.server";
import { recordProductEvent, type ProductEventMetadata, type ProductEventName } from "../features/onboarding/onboarding-events.server";
import { getGuestOnboardingFromRequest } from "../features/onboarding/guest-session.server";
import {
  safePlaceDetailRequestPath,
  type RecommendationDiscoveryMode,
  type RecommendationSourceRail,
} from "../components/places/PlaceCard";
import { VoteControl } from "../components/ratings/VoteControl";
import { listPublishedPlaceReviewPhotos } from "../features/ratings/reviewer-visit.server";

const actionSchema = z.discriminatedUnion("intent", [
  z.object({
    intent: z.literal("vote"),
    value: z.coerce.number().refine((value): value is -1 | 1 => value === -1 || value === 1),
    reason: z.enum(["MENU", "DISTANCE", "PRICE", "ATMOSPHERE", "ALREADY_VISITED"]).nullable().default(null),
  }),
  z.object({ intent: z.literal("withdraw") }),
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

export async function loader({ request, params }: Route.LoaderArgs) {
  const db = createDb(env.DB);
  const redirectedSlug = await resolvePlaceSlugRedirect(db, params.placeSlug);
  if (redirectedSlug) throw redirect(`/places/${redirectedSlug}`, 301);
  const [place, user] = await Promise.all([getPlaceBySlug(db, params.placeSlug), getOptionalUser(request)]);
  const now = new Date().toISOString();
  const provenance = recommendationProvenance(request);
  const guest = provenance && !user ? await getGuestOnboardingFromRequest(db, request, now) : null;
  const [vote, saved] = user ? await Promise.all([
    getCurrentVote(db, { placeId: place.id, userId: user.id }),
    getSaved(db, { placeId: place.id, userId: user.id }),
  ]) : [null, false] as const;
  const [snapshot, flavorPrint, goldenPicks, hiddenGem, reviewPhotos] = await Promise.all([
    getLatestRatingSnapshot(db, place.id),
    getPlaceFlavorPrint(db, place.id),
    listActiveGoldenPicks(db, now),
    getHiddenGemStatus(db, { placeId: place.id, now }),
    listPublishedPlaceReviewPhotos(db, place.id, 12),
  ]);
  const legacy = calculateRating(place);
  const rating = snapshot ? {
    overallScore: snapshot.overallScore,
    userScore: snapshot.userScore,
    reviewerScore: snapshot.reviewerScore,
    overallSampleCount: snapshot.overallSampleCount,
    userSampleCount: snapshot.userSampleCount,
    reviewerSampleCount: snapshot.reviewerSampleCount,
    isStale: snapshot.isStale,
    algorithmVersion: "rating-v2.0",
  } : {
    overallScore: legacy.sampleStatus === "VISIBLE" ? legacy.displayScore : null,
    userScore: null,
    reviewerScore: null,
    overallSampleCount: place.positive + place.negative,
    userSampleCount: place.positive + place.negative,
    reviewerSampleCount: 0,
    isStale: false,
    algorithmVersion: "rating-v1-fallback",
  };
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
  return { place, rating, flavorPrint, hiddenGem, reviewPhotos, hasGoldenPick: goldenPicks.some((pick) => pick.placeId === place.id), user, vote, saved, returnTo };
}

export async function action({ request, params }: Route.ActionArgs) {
  if (!isSameOriginMutation(request)) throw new Response("이 요청은 현재 서비스에서 다시 실행해 주세요.", { status: 403, statusText: "FORBIDDEN" });
  const user = await requireUser(request);
  const parsed = actionSchema.safeParse(Object.fromEntries(await request.formData()));
  if (!parsed.success) throw new Response("Invalid reaction", { status: 400, statusText: "INVALID_REACTION" });
  const db = createDb(env.DB);
  const redirectedSlug = await resolvePlaceSlugRedirect(db, params.placeSlug);
  if (redirectedSlug) throw redirect(`/places/${redirectedSlug}`, 308);
  const place = await getPlaceBySlug(db, params.placeSlug);
  const now = new Date().toISOString();
  const provenance = recommendationProvenance(request);
  if (parsed.data.intent === "vote") {
    await castVote(db, { placeId: place.id, userId: user.id, value: parsed.data.value, eventId: crypto.randomUUID(), now });
    try {
      await recordRecommendationFeedback(db, {
        placeId: place.id,
        userId: user.id,
        value: parsed.data.value,
        reason: parsed.data.reason,
        now,
      });
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
    // Remove feedback first: failed cleanup must keep the visible vote retryable.
    await clearRecommendationFeedback(db, { userId: user.id, placeId: place.id });
    await withdrawVote(db, { placeId: place.id, userId: user.id, eventId: crypto.randomUUID(), now });
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

export function meta({ params }: Route.MetaArgs) {
  const name = params.placeSlug ?? "장소 상세";
  return [
    { title: `${name} — Re:Taste` },
    { name: "description", content: "광주·전남 맛 지도" },
    { property: "og:title", content: `${name} — Re:Taste` },
    { property: "og:description", content: "광주·전남 맛 지도" },
    { property: "og:type", content: "article" },
  ];
}

export default function PlaceDetail({ loaderData }: Route.ComponentProps) {
  const { place, rating, flavorPrint, reviewPhotos } = loaderData;
  const query = encodeURIComponent(place.address);
  return (
    <main id="main" className="detail shell">
      <Link className="back-link" to={`/?category=${encodeURIComponent(place.primaryCategory.slug)}`}>← {place.primaryCategory.name} 지도로</Link>
      <div className="detail-grid">
        <div className="detail-hero">{place.heroImageUrl ? <img src={place.heroImageUrl} alt={`${place.name} 대표`} /> : <span>RE:TASTE<br />FIELD NOTE</span>}</div>
        <article className="detail-copy">
          <p className="eyebrow">{place.primaryCategory.emoji} {place.primaryCategory.name} · {place.neighborhood}</p><h1>{place.name}</h1>
          {loaderData.hasGoldenPick && <span className="rating-badge">GOLDEN PICK · 90일</span>}
          {loaderData.hiddenGem.eligible && <span className="rating-badge rating-badge-hidden">HIDDEN GEM · 노출 대비 높은 평가</span>}
          <div className="score"><strong>{rating.overallScore === null ? `표본 수집 중 · ${rating.overallSampleCount}/8` : `${rating.overallScore}%`}</strong><span>{rating.isStale ? "새 평가 반영 중" : "검증된 최신 결과"}</span></div>
          <section className="rating-breakdown" aria-labelledby="rating-breakdown-title"><h2 id="rating-breakdown-title">평가 구성</h2><div><span>일반 회원</span><strong>{rating.userScore === null ? `${rating.userSampleCount}/8` : `${rating.userScore}%`}</strong></div><div><span>리뷰어</span><strong>{rating.reviewerScore === null ? `${rating.reviewerSampleCount}/8` : `${rating.reviewerScore}%`}</strong></div><small>각 집단은 8표부터 숫자를 공개하며 리뷰어 영향은 전체 유효 가중치의 최대 30%입니다.</small></section>
          {flavorPrint.status === "VISIBLE" ? <section className="flavor-print"><h2>Flavor Print</h2>{flavorPrint.dimensions.map((dimension) => <div key={dimension.key}><span>{dimension.key}</span><meter min="1" max="5" value={dimension.median}>{dimension.median}</meter><strong>{dimension.median}/5</strong></div>)}</section> : <section className="flavor-print"><h2>Flavor Print</h2><p>리뷰어 평가 수집 중 · {flavorPrint.ratingCount}/3</p></section>}
          <dl><div><dt>주소</dt><dd>{place.address}</dd></div><div><dt>주차</dt><dd>{place.parkingSummary ?? "정보 확인 중"}</dd></div>{place.phone && <div><dt>전화</dt><dd>{place.phone}</dd></div>}</dl>
          <VoteControl vote={loaderData.vote} saved={loaderData.saved} signedIn={Boolean(loaderData.user)} returnTo={loaderData.returnTo} />
          <p><Link to={`/corrections/new?${new URLSearchParams({ placeId: place.id })}`}>이 장소 정보 정정 요청</Link></p>
          <div className="directions"><a href={`https://map.naver.com/p/search/${query}`} target="_blank" rel="noreferrer">네이버 지도에서 길찾기</a></div>
          {reviewPhotos.length > 0 && <section className="review-photo-gallery" aria-labelledby="review-photo-gallery-title">
            <div><p className="eyebrow">REVIEWER / PHOTO</p><h2 id="review-photo-gallery-title">리뷰어가 남긴 사진</h2></div>
            <div>
              {reviewPhotos.map((photo) => <img key={photo.id} src={photo.url} alt={`${place.name} 리뷰 사진`} loading="lazy" />)}
            </div>
          </section>}
        </article>
      </div>
    </main>
  );
}
