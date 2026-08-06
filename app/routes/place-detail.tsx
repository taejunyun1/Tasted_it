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
import { getHiddenGemStatus, recordPlaceDetailView } from "../features/ratings/rating-badges.server";
import { castVote, getCurrentVote } from "../features/ratings/vote.server";
import { getOptionalUser, requireUser } from "../features/auth/session.server";
import { getSaved, setSaved } from "../features/saves/save.server";
import { VoteControl } from "../components/ratings/VoteControl";

const actionSchema = z.discriminatedUnion("intent", [
  z.object({ intent: z.literal("vote"), value: z.coerce.number().refine((value): value is -1 | 1 => value === -1 || value === 1) }),
  z.object({ intent: z.literal("save"), saved: z.enum(["true", "false"]).transform((value) => value === "true") }),
]);

export async function loader({ request, params }: Route.LoaderArgs) {
  const db = createDb(env.DB);
  const redirectedSlug = await resolvePlaceSlugRedirect(db, params.placeSlug);
  if (redirectedSlug) throw redirect(`/places/${redirectedSlug}`, 301);
  const [place, user] = await Promise.all([getPlaceBySlug(db, params.placeSlug), getOptionalUser(request)]);
  const [vote, saved] = user ? await Promise.all([
    getCurrentVote(db, { placeId: place.id, userId: user.id }),
    getSaved(db, { placeId: place.id, userId: user.id }),
  ]) : [null, false] as const;
  const now = new Date().toISOString();
  await recordPlaceDetailView(db, { placeId: place.id, now });
  const [snapshot, flavorPrint, goldenPicks, hiddenGem] = await Promise.all([
    getLatestRatingSnapshot(db, place.id),
    getPlaceFlavorPrint(db, place.id),
    listActiveGoldenPicks(db, now),
    getHiddenGemStatus(db, { placeId: place.id, now }),
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
  return { place, rating, flavorPrint, hiddenGem, hasGoldenPick: goldenPicks.some((pick) => pick.placeId === place.id), user, vote, saved };
}

export async function action({ request, params }: Route.ActionArgs) {
  const user = await requireUser(request);
  const parsed = actionSchema.safeParse(Object.fromEntries(await request.formData()));
  if (!parsed.success) throw new Response("Invalid reaction", { status: 400, statusText: "INVALID_REACTION" });
  const db = createDb(env.DB);
  const redirectedSlug = await resolvePlaceSlugRedirect(db, params.placeSlug);
  if (redirectedSlug) throw redirect(`/places/${redirectedSlug}`, 308);
  const place = await getPlaceBySlug(db, params.placeSlug);
  const now = new Date().toISOString();
  if (parsed.data.intent === "vote") {
    await castVote(db, { placeId: place.id, userId: user.id, value: parsed.data.value, eventId: crypto.randomUUID(), now });
  } else {
    await setSaved(db, { placeId: place.id, userId: user.id, saved: parsed.data.saved, now });
  }
  return redirect(`/places/${params.placeSlug}`);
}

export function meta() { return [{ title: "장소 상세 — Re:Taste" }]; }

export default function PlaceDetail({ loaderData }: Route.ComponentProps) {
  const { place, rating, flavorPrint } = loaderData;
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
          <VoteControl vote={loaderData.vote} saved={loaderData.saved} signedIn={Boolean(loaderData.user)} returnTo={`/places/${place.slug}`} />
          <div className="directions"><a href={`https://map.naver.com/p/search/${query}`} target="_blank" rel="noreferrer">네이버 지도에서 길찾기</a></div>
        </article>
      </div>
    </main>
  );
}
