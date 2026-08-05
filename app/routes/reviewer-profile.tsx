import { env } from "cloudflare:workers";
import type { Route } from "./+types/reviewer-profile";
import { createDb } from "../db/client.server";
import { getPublicReviewerProfile } from "../features/reviewers/reviewer.server";

export async function loader({ params }: Route.LoaderArgs) {
  const profile = await getPublicReviewerProfile(createDb(env.DB), params.slug ?? "");
  if (!profile) throw new Response("Not Found", { status: 404, statusText: "Not Found" });
  return { profile };
}

export default function ReviewerProfile({ loaderData }: Route.ComponentProps) {
  const { profile } = loaderData;
  return <main id="main" className="shell py-14 md:py-24"><p className="eyebrow">RE:TASTE REVIEWER</p><div className="mt-4 grid border border-neutral-900 bg-white md:grid-cols-[1fr_0.65fr]"><section className="p-7 md:p-14"><div className="flex items-center gap-3"><span className="border border-emerald-700 bg-emerald-50 px-2 py-1 text-xs font-medium text-emerald-900">{profile.status === "DORMANT" ? "휴면 리뷰어" : "활동 리뷰어"}</span><span className="text-xs text-neutral-500">{profile.regionCode === "GWANGJU" ? "광주" : "전남"}</span></div><h1 className="mt-8 text-4xl font-semibold tracking-[-0.05em] md:text-6xl">{profile.displayName}</h1><p className="mt-3 text-sm text-neutral-500">{profile.occupation}</p><blockquote className="mt-10 border-l-4 border-emerald-800 pl-5 text-xl font-medium leading-9">{profile.tasteDirection}</blockquote></section><aside className="border-t border-neutral-900 bg-[#f4f7ef] p-7 md:border-l md:border-t-0 md:p-10"><p className="text-xs font-semibold text-neutral-500">전문 카테고리</p><div className="mt-4 flex flex-wrap gap-2">{profile.specialties.map((category) => <span key={category.slug} className="border border-neutral-300 bg-white px-3 py-2 text-sm">{category.emoji} {category.name}</span>)}</div><dl className="mt-10"><div><dt>승인일</dt><dd>{profile.approvedAt.slice(0, 10)}</dd></div><div><dt>최근 활동</dt><dd>{profile.lastActivityAt.slice(0, 10)}</dd></div></dl></aside></div></main>;
}
