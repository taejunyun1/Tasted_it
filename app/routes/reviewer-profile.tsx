import { env } from "cloudflare:workers";
import { Link } from "react-router";
import "../styles/reviewer-moderation.css";
import type { Route } from "./+types/reviewer-profile";
import { createDb } from "../db/client.server";
import { getPublicReviewerVisits } from "../features/ratings/reviewer-moderation.server";
import { getPublicReviewerProfile } from "../features/reviewers/reviewer.server";

export const headers: Route.HeadersFunction = () => ({ "Cache-Control": "private, no-store", Vary: "Cookie" });

export async function loader({ params }: Route.LoaderArgs) {
  const profile = await getPublicReviewerProfile(createDb(env.DB), params.slug ?? "");
  if (!profile) throw new Response("Not Found", { status: 404, statusText: "Not Found" });
  const visits = await getPublicReviewerVisits(createDb(env.DB), profile.userId);
  return { profile: {
    displayName: profile.displayName, status: profile.status, regionCode: profile.regionCode,
    directlyVerified: profile.directlyVerified, occupation: profile.directlyVerified ? null : profile.occupation,
    tasteDirection: profile.tasteDirection, specialties: profile.specialties,
    approvedAt: profile.approvedAt, lastActivityAt: profile.lastActivityAt,
  }, visits };
}

function publicBadges(value: string) {
  try { const badges: unknown = JSON.parse(value); return Array.isArray(badges) ? badges.filter((badge): badge is string => typeof badge === "string").slice(0, 2) : []; } catch { return []; }
}

export default function ReviewerProfile({ loaderData }: Route.ComponentProps) {
  const { profile } = loaderData;
  const roleLabel = profile.directlyVerified ? "직접인증" : profile.status === "DORMANT" ? "휴면 리뷰어" : "활동 리뷰어";
  return <main id="main" className="shell py-14 md:py-24"><p className="eyebrow">{profile.directlyVerified ? "RE:TASTE" : "RE:TASTE REVIEWER"}</p><div className="mt-4 grid border border-neutral-900 bg-white md:grid-cols-[1fr_0.65fr]"><section className="p-7 md:p-14"><div className="flex items-center gap-3"><span className="border border-emerald-700 bg-emerald-50 px-2 py-1 text-xs font-medium text-emerald-900">{roleLabel}</span><span className="text-xs text-neutral-500">{profile.regionCode === "GWANGJU" ? "광주" : "전남"}</span></div><h1 className="mt-8 text-[25.2px] font-semibold tracking-[-0.05em] md:text-[42px]">{profile.displayName}</h1>{profile.occupation && <p className="mt-3 text-sm text-neutral-500">{profile.occupation}</p>}<blockquote className="mt-10 border-l-4 border-emerald-800 pl-5 text-xl font-medium leading-9">{profile.tasteDirection}</blockquote></section><aside className="border-t border-neutral-900 bg-[#f4f7ef] p-7 md:border-l md:border-t-0 md:p-10"><p className="text-xs font-semibold text-neutral-500">전문 카테고리</p><div className="mt-4 flex flex-wrap gap-2">{profile.specialties.map((category) => <span key={category.slug} className="border border-neutral-300 bg-white px-3 py-2 text-sm">{category.emoji} {category.name}</span>)}</div><dl className="mt-10"><div><dt>승인일</dt><dd>{profile.approvedAt.slice(0, 10)}</dd></div><div><dt>최근 활동</dt><dd>{profile.lastActivityAt.slice(0, 10)}</dd></div></dl></aside></div>
    <section className="reviewer-public-visits" aria-labelledby="reviewer-public-visits-title">
      <h2 id="reviewer-public-visits-title">승인된 방문과 평가</h2>
      {loaderData.visits.length ? loaderData.visits.map((visit) => <article className="reviewer-public-visit" key={visit.id}>
        <h3><Link to={`/places/${visit.placeSlug}`}>{visit.placeName}</Link></h3>
        <p>{visit.visitedOn ? <time dateTime={visit.visitedOn}>{visit.visitedOn} 방문</time> : "방문일 미확인"} · {visit.evaluation === "RECOMMEND" ? "추천" : visit.evaluation === "HOLD" ? "보류" : "비추천"}</p>
        <p>{publicBadges(visit.badgesJson).join(" · ")}</p>
        <ul>{visit.photos.map((photo) => <li key={photo.id}><figure><img src={photo.url} alt={photo.caption ?? "승인된 방문 사진"} loading="lazy" width="180" height="140" /><figcaption>{photo.caption}</figcaption></figure></li>)}</ul>
      </article>) : <p>공개 승인된 방문 자료가 아직 없어요.</p>}
    </section>
  </main>;
}
