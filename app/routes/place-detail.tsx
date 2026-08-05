import { env } from "cloudflare:workers";
import { Link, redirect } from "react-router";
import { z } from "zod";
import type { Route } from "./+types/place-detail";
import { createDb } from "../db/client.server";
import { getPlaceBySlug } from "../features/places/place.server";
import { calculateRating } from "../features/ratings/rating-v1";
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
  const [place, user] = await Promise.all([getPlaceBySlug(db, params.placeSlug), getOptionalUser(request)]);
  const [vote, saved] = user ? await Promise.all([
    getCurrentVote(db, { placeId: place.id, userId: user.id }),
    getSaved(db, { placeId: place.id, userId: user.id }),
  ]) : [null, false] as const;
  return { place, rating: calculateRating(place), user, vote, saved };
}

export async function action({ request, params }: Route.ActionArgs) {
  const user = await requireUser(request);
  const parsed = actionSchema.safeParse(Object.fromEntries(await request.formData()));
  if (!parsed.success) throw new Response("Invalid reaction", { status: 400, statusText: "INVALID_REACTION" });
  const db = createDb(env.DB);
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
  const { place, rating } = loaderData;
  const query = encodeURIComponent(place.address);
  return (
    <main id="main" className="detail shell">
      <Link className="back-link" to={`/?category=${encodeURIComponent(place.primaryCategory.slug)}`}>← {place.primaryCategory.name} 지도로</Link>
      <div className="detail-grid">
        <div className="detail-hero">{place.heroImageUrl ? <img src={place.heroImageUrl} alt={`${place.name} 대표`} /> : <span>RE:TASTE<br />FIELD NOTE</span>}</div>
        <article className="detail-copy">
          <p className="eyebrow">{place.primaryCategory.emoji} {place.primaryCategory.name} · {place.neighborhood}</p><h1>{place.name}</h1>
          <div className="score"><strong>{rating.sampleStatus === "VISIBLE" ? `${rating.displayScore}%` : "평가 수 부족"}</strong><span>추천 {place.positive} · 비추천 {place.negative}</span></div>
          <dl><div><dt>주소</dt><dd>{place.address}</dd></div><div><dt>주차</dt><dd>{place.parkingSummary ?? "정보 확인 중"}</dd></div>{place.phone && <div><dt>전화</dt><dd>{place.phone}</dd></div>}</dl>
          <VoteControl vote={loaderData.vote} saved={loaderData.saved} signedIn={Boolean(loaderData.user)} returnTo={`/places/${place.slug}`} />
          <div className="directions"><a href={`https://map.naver.com/p/search/${query}`} target="_blank" rel="noreferrer">네이버 지도에서 길찾기</a></div>
        </article>
      </div>
    </main>
  );
}
