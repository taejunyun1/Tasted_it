import { env } from "cloudflare:workers";
import { asc } from "drizzle-orm";
import { Form, Link, redirect } from "react-router";
import type { Route } from "./+types/admin-candidates";
import { CandidateMap } from "../components/map/CandidateMap";
import { createDb } from "../db/client.server";
import { categories } from "../db/schema";
import { approveCandidate, listPendingCandidates, rejectCandidate } from "../features/candidates/candidate.server";
import type { PublicDataSource, RegionCode } from "../features/candidates/public-data";
import { requireAdmin } from "../features/auth/session.server";

export async function loader({ request }: Route.LoaderArgs) {
  const user = await requireAdmin(request); const url = new URL(request.url); const db = createDb(env.DB);
  const [candidates, categoryRows] = await Promise.all([
    listPendingCandidates(db, { query: url.searchParams.get("q") ?? undefined, sourceType: (url.searchParams.get("source") || undefined) as PublicDataSource | undefined, regionCode: (url.searchParams.get("region") || undefined) as RegionCode | undefined }),
    db.select().from(categories).orderBy(asc(categories.sortOrder)),
  ]);
  return { user, candidates, categories: categoryRows, clientId: env.NAVER_MAPS_CLIENT_ID ?? "" };
}
export async function action({ request }: Route.ActionArgs) {
  const user = await requireAdmin(request); const form = await request.formData(); const intent = String(form.get("intent") ?? ""); const candidateId = String(form.get("candidateId") ?? ""); const now = new Date().toISOString(); const db = createDb(env.DB);
  if (intent === "reject") await rejectCandidate(db, { candidateId, actorUserId: user.id, reason: String(form.get("reason") ?? ""), now });
  else if (intent === "approve") await approveCandidate(db, { candidateId, actorUserId: user.id, categoryId: String(form.get("categoryId") ?? ""), slug: String(form.get("slug") ?? "").trim(), name: String(form.get("name") ?? "").trim(), address: String(form.get("address") ?? "").trim(), neighborhood: String(form.get("neighborhood") ?? "").trim(), latitude: Number(form.get("latitude")), longitude: Number(form.get("longitude")), now });
  return redirect("/admin/candidates");
}
export default function AdminCandidates({ loaderData }: Route.ComponentProps) {
  return <main className="admin-candidates shell"><header className="admin-head"><div><p className="eyebrow">ADMIN / REVIEW</p><h1>장소 후보 검수</h1><p>영업 중으로 확인된 후보만 표시됩니다.</p></div><nav><Link to="/admin/places">공개 장소</Link><Link to="/admin/data-sync">데이터 동기화</Link></nav></header>
    <Form className="candidate-filters"><input name="q" placeholder="상호명 또는 주소"/><select name="region" defaultValue=""><option value="">전체 지역</option><option value="GWANGJU">광주</option><option value="JEONNAM">전남</option></select><select name="source" defaultValue=""><option value="">전체 업종</option><option value="GENERAL_RESTAURANT">일반음식점</option><option value="REST_CAFE">휴게음식점</option><option value="BAKERY">제과점</option><option value="ENTERTAINMENT_BAR">유흥주점</option></select><button>검색</button></Form>
    <CandidateMap candidates={loaderData.candidates} clientId={loaderData.clientId}/><p className="candidate-count">검수 대기 {loaderData.candidates.length}곳 · 좌표 없는 후보는 지도에서 제외</p>
    <section className="candidate-list">{loaderData.candidates.map((candidate) => <article id={`candidate-${candidate.id}`} className="candidate-row" key={candidate.id}><div><span>{candidate.sourceType} · {candidate.regionCode}</span><h2>{candidate.businessName}</h2><p>{candidate.businessSubtype ?? "업종 미상"} · {candidate.roadAddress ?? candidate.lotAddress}</p><small>{candidate.latitude == null ? "좌표 확인 필요" : `${candidate.latitude.toFixed(6)}, ${candidate.longitude?.toFixed(6)}`}</small></div><Form method="post" className="review-form"><input type="hidden" name="candidateId" value={candidate.id}/><input name="name" defaultValue={candidate.businessName} aria-label="공개 상호명" required/><input name="slug" placeholder="place-slug" aria-label="slug" required/><input name="address" defaultValue={candidate.roadAddress ?? candidate.lotAddress ?? ""} aria-label="주소" required/><input name="neighborhood" placeholder="동네" required/><div className="coordinate-inputs"><input name="latitude" defaultValue={candidate.latitude ?? ""} placeholder="위도" required/><input name="longitude" defaultValue={candidate.longitude ?? ""} placeholder="경도" required/></div><select name="categoryId" required defaultValue=""><option value="" disabled>카테고리 선택</option>{loaderData.categories.map((category) => <option value={category.id} key={category.id}>{category.emoji} {category.name}</option>)}</select><button name="intent" value="approve">검수 승인·공개</button><input name="reason" placeholder="반려 사유"/><button className="secondary" name="intent" value="reject" formNoValidate>반려</button></Form></article>)}{!loaderData.candidates.length && <p className="empty">현재 검수할 영업 중 후보가 없습니다.</p>}</section>
  </main>;
}
