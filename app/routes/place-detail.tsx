import { env } from "cloudflare:workers";
import { Link } from "react-router";
import type { Route } from "./+types/place-detail";
import { createDb } from "../db/client.server";
import { getPlaceBySlug } from "../features/places/place.server";
import { calculateRating } from "../features/ratings/rating-v1";

export async function loader({ params }: Route.LoaderArgs) {
  const place = await getPlaceBySlug(createDb(env.DB), params.placeSlug);
  return { place, rating: calculateRating(place) };
}

export function meta() { return [{ title: "장소 상세 — Re:Taste" }]; }

export default function PlaceDetail({ loaderData }: Route.ComponentProps) {
  const { place, rating } = loaderData;
  const query = encodeURIComponent(place.address);
  return (
    <main id="main" className="detail shell">
      <Link className="back-link" to={`/maps/${place.primaryCategory.slug}`}>← {place.primaryCategory.name} 지도로</Link>
      <div className="detail-grid">
        <div className="detail-hero">{place.heroImageUrl ? <img src={place.heroImageUrl} alt={`${place.name} 대표`} /> : <span>RE:TASTE<br />FIELD NOTE</span>}</div>
        <article className="detail-copy">
          <p className="eyebrow">{place.primaryCategory.emoji} {place.primaryCategory.name} · {place.neighborhood}</p><h1>{place.name}</h1>
          <div className="score"><strong>{rating.sampleStatus === "VISIBLE" ? `${rating.displayScore}%` : "평가 수 부족"}</strong><span>추천 {place.positive} · 비추천 {place.negative}</span></div>
          <dl><div><dt>주소</dt><dd>{place.address}</dd></div><div><dt>주차</dt><dd>{place.parkingSummary ?? "정보 확인 중"}</dd></div>{place.phone && <div><dt>전화</dt><dd>{place.phone}</dd></div>}</dl>
          <div className="action-placeholder"><button disabled>추천</button><button disabled>비추천</button><button disabled>저장</button><small>로그인 기능 연결 예정</small></div>
          <div className="directions"><a href={`https://map.kakao.com/link/search/${query}`} target="_blank" rel="noreferrer">카카오맵 길찾기</a><a href={`https://map.naver.com/p/search/${query}`} target="_blank" rel="noreferrer">네이버지도 길찾기</a></div>
        </article>
      </div>
    </main>
  );
}
