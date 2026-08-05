import { env } from "cloudflare:workers";
import { Link } from "react-router";

import type { Route } from "./+types/home";
import { createDb } from "../db/client.server";
import { listPlaces } from "../features/places/place.server";
import { PlaceCard } from "../components/places/PlaceCard";

const categories = [
  { slug: "ramen", name: "라멘", emoji: "🍜", note: "깊은 육수와 면" },
  { slug: "donkatsu", name: "돈까스", emoji: "🍛", note: "바삭한 한 접시" },
  { slug: "gukbap", name: "국밥", emoji: "🍲", note: "든든한 지역의 맛" },
  { slug: "bakery", name: "베이커리", emoji: "🥐", note: "갓 구운 동네 빵" },
];

export function meta() {
  return [
    { title: "Re:Taste — 광주·전남 맛 지도" },
    { name: "description", content: "추천과 비추천이 분명한 광주·전남 큐레이션 맛 지도" },
  ];
}

export async function loader({}: Route.LoaderArgs) {
  return { latest: await listPlaces(createDb(env.DB), { limit: 4 }) };
}

export default function Home({ loaderData }: Route.ComponentProps) {
  return (
    <main id="main">
      <section className="hero shell">
        <p className="eyebrow">GWANGJU · JEONNAM / BETA 01</p>
        <h1>오늘의 한 끼,<br />취향부터 고르세요.</h1>
        <p className="hero-copy">별점 대신 추천과 비추천. 광고 순위 대신 실제 선택을 위한 지역 맛 지도입니다.</p>
      </section>

      <section className="taste-index shell" aria-labelledby="taste-title">
        <div className="section-heading"><p className="eyebrow">TASTE INDEX</p><h2 id="taste-title">무엇이 당기나요?</h2></div>
        <div className="category-grid">
          {categories.map((category, index) => (
            <Link className="category-entry" to={`/maps/${category.slug}`} key={category.slug}>
              <span className="category-number">0{index + 1}</span>
              <span className="category-emoji" aria-hidden>{category.emoji}</span>
              <strong>{category.name}</strong><small>{category.note}</small>
            </Link>
          ))}
        </div>
      </section>

      <section className="latest shell" aria-labelledby="latest-title">
        <div className="section-heading"><p className="eyebrow">NEW ON THE MAP</p><h2 id="latest-title">지도에 막 올라온 곳</h2></div>
        <div className="place-grid">{loaderData.latest.map((place) => <PlaceCard place={place} key={place.id} />)}</div>
      </section>
    </main>
  );
}
