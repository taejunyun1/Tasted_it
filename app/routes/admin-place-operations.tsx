import { env } from "cloudflare:workers";
import { asc, desc, inArray } from "drizzle-orm";
import { Children } from "react";
import { Form, Link } from "react-router";
import type { Route } from "./+types/admin-place-operations";

import { createDb } from "../db/client.server";
import { placeCorrectionRequests, placeDuplicateCandidates, placeRevalidationCases, placeRevisions, placeSuggestions, places } from "../db/schema";
import { requireAdmin } from "../features/auth/session.server";
import { applyPlaceCorrection, transitionPlaceCorrection } from "../features/places/place-correction.server";
import { mergePlaces, restorePlaceRevision } from "../features/places/place-merge.server";
import { resolvePlaceRevalidation } from "../features/places/place-revalidation.server";
import { approvePlaceSuggestion, transitionPlaceSuggestion } from "../features/places/place-suggestion.server";

export async function loader({ request }: Route.LoaderArgs) {
  await requireAdmin(request); const db = createDb(env.DB);
  const [suggestions, corrections, revalidations, revisions, duplicates, placeRows] = await Promise.all([
    db.select().from(placeSuggestions).where(inArray(placeSuggestions.status, ["SUBMITTED", "NEEDS_INFO", "REVIEWING"])).orderBy(asc(placeSuggestions.createdAt)).limit(200),
    db.select().from(placeCorrectionRequests).where(inArray(placeCorrectionRequests.status, ["SUBMITTED", "REVIEWING"])).orderBy(asc(placeCorrectionRequests.createdAt)).limit(200),
    db.select().from(placeRevalidationCases).where(inArray(placeRevalidationCases.status, ["OPEN", "REVIEWING"])).orderBy(asc(placeRevalidationCases.createdAt)).limit(200),
    db.select().from(placeRevisions).orderBy(desc(placeRevisions.createdAt)).limit(100),
    db.select().from(placeDuplicateCandidates).where(inArray(placeDuplicateCandidates.status, ["OPEN"])).orderBy(desc(placeDuplicateCandidates.createdAt)).limit(100),
    db.select({ id: places.id, name: places.name, slug: places.slug, status: places.status }).from(places).orderBy(asc(places.name)).limit(1_000),
  ]);
  return { suggestions, corrections, revalidations, revisions, duplicates, places: placeRows };
}

export async function action({ request }: Route.ActionArgs) {
  const admin = await requireAdmin(request); const form = await request.formData(); const db = createDb(env.DB); const now = new Date().toISOString(); const intent = String(form.get("intent") ?? "");
  if (intent === "approve-suggestion") {
    const latitudeRaw = String(form.get("latitude") ?? "").trim(); const longitudeRaw = String(form.get("longitude") ?? "").trim();
    const latitude = latitudeRaw ? Number(latitudeRaw) : null; const longitude = longitudeRaw ? Number(longitudeRaw) : null;
    await approvePlaceSuggestion(db, { suggestionId: String(form.get("suggestionId")), actorUserId: admin.id, placeId: crypto.randomUUID(), latitude: Number.isFinite(latitude) ? latitude : null, longitude: Number.isFinite(longitude) ? longitude : null, reason: String(form.get("reason") ?? ""), now });
    return { ok: true, message: "제안을 비공개 초안으로 승인했습니다." };
  }
  if (intent === "transition-suggestion") {
    await transitionPlaceSuggestion(db, { suggestionId: String(form.get("suggestionId")), actorUserId: admin.id, status: String(form.get("status")) as "NEEDS_INFO" | "REVIEWING" | "REJECTED" | "DUPLICATE", reason: String(form.get("reason") ?? ""), now });
    return { ok: true, message: "제안 상태를 변경했습니다." };
  }
  if (intent === "apply-correction") {
    await applyPlaceCorrection(db, { requestId: String(form.get("requestId")), actorUserId: admin.id, reason: String(form.get("reason") ?? ""), now });
    return { ok: true, message: "정정 내용을 적용하고 수정 이력을 남겼습니다." };
  }
  if (intent === "transition-correction") {
    await transitionPlaceCorrection(db, { requestId: String(form.get("requestId")), actorUserId: admin.id, status: String(form.get("status")) as "REVIEWING" | "REJECTED", reason: String(form.get("reason") ?? ""), now });
    return { ok: true, message: "정정 요청 상태를 변경했습니다." };
  }
  if (intent === "merge") {
    await mergePlaces(db, { targetPlaceId: String(form.get("targetPlaceId")), sourcePlaceId: String(form.get("sourcePlaceId")), actorUserId: admin.id, reason: String(form.get("reason") ?? ""), now });
    return { ok: true, message: "중복 장소를 병합하고 기존 URL 리다이렉트를 생성했습니다." };
  }
  if (intent === "restore") {
    await restorePlaceRevision(db, { revisionId: String(form.get("revisionId")), actorUserId: admin.id, reason: String(form.get("reason") ?? ""), now });
    return { ok: true, message: "선택한 이전 값으로 복원했습니다." };
  }
  if (intent === "revalidate") {
    await resolvePlaceRevalidation(db, { caseId: String(form.get("caseId")), actorUserId: admin.id, resolution: String(form.get("resolution")) as "KEEP_PUBLISHED" | "KEEP_HIDDEN" | "RESTORE_PUBLISHED", reason: String(form.get("reason") ?? ""), now });
    return { ok: true, message: "영업 상태 재검증을 완료했습니다." };
  }
  throw new Response("Invalid intent", { status: 400 });
}

export function meta() { return [{ title: "장소 운영 — Re:Taste Admin" }]; }

export default function AdminPlaceOperations({ loaderData, actionData }: Route.ComponentProps) {
  const names = new Map(loaderData.places.map((place) => [place.id, place.name]));
  return <main id="main" className="place-ops shell"><header className="place-ops-head"><div><p className="eyebrow">ADMIN / PLACE OPERATIONS</p><h1>장소 운영</h1><p>제안·정정·중복·폐업 검토를 지도 없이 순서대로 처리합니다.</p></div><nav><Link to="/admin/candidates">공공데이터 검수</Link><Link to="/admin/ratings">평가 운영</Link></nav></header>{actionData?.message && <p className="admin-notice">{actionData.message}</p>}<section className="place-ops-stats"><Stat label="장소 제안" value={loaderData.suggestions.length}/><Stat label="정보 정정" value={loaderData.corrections.length}/><Stat label="영업 재검증" value={loaderData.revalidations.length}/><Stat label="중복 후보" value={loaderData.duplicates.length}/></section>
    <OpsSection title="회원 장소 제안" empty="검토할 제안이 없습니다.">{loaderData.suggestions.map((item) => <article className="ops-card" key={item.id}><div><span>{item.status}</span><h3>{item.name}</h3><p>{item.address} · {item.neighborhood}</p><small>{item.description ?? "설명 없음"}</small></div><div className="ops-actions"><Form method="post" className="ops-form"><input type="hidden" name="intent" value="approve-suggestion"/><input type="hidden" name="suggestionId" value={item.id}/><div><input name="latitude" defaultValue={item.latitude ?? ""} placeholder="위도"/><input name="longitude" defaultValue={item.longitude ?? ""} placeholder="경도"/></div><input name="reason" placeholder="승인 근거" required/><button>초안 승인</button></Form><Form method="post" className="ops-form ops-form-compact"><input type="hidden" name="intent" value="transition-suggestion"/><input type="hidden" name="suggestionId" value={item.id}/><input name="reason" placeholder="추가 정보 요청 사유" required/><button className="secondary" name="status" value="NEEDS_INFO">추가 정보</button><button className="secondary" name="status" value="REJECTED">반려</button></Form></div></article>)}</OpsSection>
    <OpsSection title="정보 정정·이의 제기" empty="검토할 정정 요청이 없습니다.">{loaderData.corrections.map((item) => <article className="ops-card" key={item.id}><div><span>{item.status} · {item.requestType}</span><h3>{item.placeId ? names.get(item.placeId) ?? item.placeId : "목록에 없는 장소"}</h3><p>{item.requesterRelation} · {item.requesterEmail}</p><code>{item.requestedChangesJson}</code><small>{item.evidenceNote}</small></div><div className="ops-actions"><Form method="post" className="ops-form"><input type="hidden" name="requestId" value={item.id}/><input name="reason" placeholder="적용 근거" required/><button name="intent" value="apply-correction">정정 적용</button></Form><Form method="post" className="ops-form ops-form-compact"><input type="hidden" name="intent" value="transition-correction"/><input type="hidden" name="requestId" value={item.id}/><input name="reason" placeholder="반려 사유" required/><button className="secondary" name="status" value="REJECTED">반려</button></Form></div></article>)}</OpsSection>
    <OpsSection title="영업 상태 재검증" empty="재검증할 장소가 없습니다.">{loaderData.revalidations.map((item) => <article className="ops-card" key={item.id}><div><span>{item.reasonType}</span><h3>{names.get(item.placeId) ?? item.placeId}</h3><code>{item.evidenceJson}</code></div><Form method="post" className="ops-form"><input type="hidden" name="intent" value="revalidate"/><input type="hidden" name="caseId" value={item.id}/><input name="reason" placeholder="확인 근거" required/><select name="resolution"><option value="KEEP_PUBLISHED">영업 확인·공개</option><option value="KEEP_HIDDEN">폐업 확인·숨김</option><option value="RESTORE_PUBLISHED">영업 재개·공개</option></select><button>재검증 완료</button></Form></article>)}</OpsSection>
    <OpsSection title="중복 장소 병합" empty=""><Form method="post" className="merge-form"><input type="hidden" name="intent" value="merge"/><label>남길 장소<select name="targetPlaceId">{loaderData.places.map((place) => <option key={place.id} value={place.id}>{place.name} · {place.status}</option>)}</select></label><label>흡수할 장소<select name="sourcePlaceId">{loaderData.places.map((place) => <option key={place.id} value={place.id}>{place.name} · {place.status}</option>)}</select></label><input name="reason" placeholder="병합 근거" required/><button>병합 실행</button></Form></OpsSection>
    <OpsSection title="최근 변경·복원" empty="변경 이력이 없습니다.">{loaderData.revisions.map((item) => <article className="ops-revision" key={item.id}><div><strong>{item.action}</strong><span>{names.get(item.placeId) ?? item.placeId}</span><small>{item.reason} · {item.createdAt}</small></div>{item.beforeJson && <Form method="post"><input type="hidden" name="intent" value="restore"/><input type="hidden" name="revisionId" value={item.id}/><input name="reason" placeholder="복원 사유" required/><button>이 값으로 복원</button></Form>}</article>)}</OpsSection>
  </main>;
}

function Stat({ label, value }: { label: string; value: number }) { return <article><span>{label}</span><strong>{value}</strong></article>; }
function OpsSection({ title, empty, children }: { title: string; empty: string; children: React.ReactNode }) { return <section className="place-ops-section"><h2>{title}</h2>{Children.count(children) ? children : <p>{empty}</p>}</section>; }
