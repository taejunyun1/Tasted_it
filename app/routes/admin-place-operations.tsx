import { env } from "cloudflare:workers";
import { asc, desc, eq, inArray } from "drizzle-orm";
import { Children } from "react";
import { Form, Link } from "react-router";
import type { Route } from "./+types/admin-place-operations";

import { createDb } from "../db/client.server";
import { placeCorrectionRequests, placeDuplicateCandidates, placeLivenessStates, placeRevalidationCases, placeRevisions, placeSuggestions, places } from "../db/schema";
import { requireAdmin } from "../features/auth/session.server";
import { applyPlaceCorrection, transitionPlaceCorrection } from "../features/places/place-correction.server";
import { mergePlaces, restorePlaceRevision } from "../features/places/place-merge.server";
import { clearRecommendationExclusions, resolvePlaceLivenessCase } from "../features/places/place-revalidation.server";
import { approvePlaceSuggestion, transitionPlaceSuggestion } from "../features/places/place-suggestion.server";

type LivenessFilter = "SUSPECTED" | "HIDDEN" | "ERROR";
type EvidenceScore = { name: number | null; address: number | null; distance: number | null; phone: number | null; total: number | null };
type ActivityEvidence = { active: boolean; at: string | null };
type LivenessEvidence = { source: string | null; score: EvidenceScore; reviewer: ActivityEvidence; member: ActivityEvidence; openSource: ActivityEvidence };

export async function loader({ request }: Route.LoaderArgs) {
  await requireAdmin(request);
  const db = createDb(env.DB);
  const livenessFilter = parseLivenessFilter(new URL(request.url).searchParams.get("liveness"));
  const [suggestions, corrections, revalidations, revisions, duplicates, placeRows, livenessStates] = await Promise.all([
    db.select().from(placeSuggestions).where(inArray(placeSuggestions.status, ["SUBMITTED", "NEEDS_INFO", "REVIEWING"])).orderBy(asc(placeSuggestions.createdAt)).limit(200),
    db.select().from(placeCorrectionRequests).where(inArray(placeCorrectionRequests.status, ["SUBMITTED", "REVIEWING"])).orderBy(asc(placeCorrectionRequests.createdAt)).limit(200),
    db.select().from(placeRevalidationCases).where(inArray(placeRevalidationCases.status, ["OPEN", "REVIEWING"])).orderBy(asc(placeRevalidationCases.createdAt)).limit(200),
    db.select().from(placeRevisions).orderBy(desc(placeRevisions.createdAt)).limit(100),
    db.select().from(placeDuplicateCandidates).where(inArray(placeDuplicateCandidates.status, ["OPEN"])).orderBy(desc(placeDuplicateCandidates.createdAt)).limit(100),
    db.select({ id: places.id, name: places.name, slug: places.slug, status: places.status }).from(places).orderBy(asc(places.name)).limit(1_000),
    db.select({
      placeId: placeLivenessStates.placeId,
      placeName: places.name,
      status: placeLivenessStates.status,
      kakaoStatus: placeLivenessStates.kakaoStatus,
      matchScore: placeLivenessStates.matchScore,
      consecutiveNotFound: placeLivenessStates.consecutiveNotFound,
      protectedUntil: placeLivenessStates.protectedUntil,
      evidenceJson: placeLivenessStates.evidenceJson,
      updatedAt: placeLivenessStates.updatedAt,
    }).from(placeLivenessStates).innerJoin(places, eq(places.id, placeLivenessStates.placeId)).orderBy(desc(placeLivenessStates.updatedAt)).limit(1_000),
  ]);
  const names = new Map(placeRows.map((place) => [place.id, place.name]));
  const statesByPlace = new Map(livenessStates.map((state) => [state.placeId, state]));
  const caseRows = revalidations.map((item) => livenessRow({
    caseId: item.id,
    placeId: item.placeId,
    placeName: names.get(item.placeId) ?? item.placeId,
    reasonType: item.reasonType,
    caseEvidenceJson: item.evidenceJson,
    state: statesByPlace.get(item.placeId),
  }));
  const casePlaceIds = new Set(revalidations.map((item) => item.placeId));
  const stateRows = livenessStates
    .filter((state) => isAttentionState(state))
    .filter((state) => !casePlaceIds.has(state.placeId))
    .map((state) => livenessRow({
      caseId: null,
      placeId: state.placeId,
      placeName: state.placeName,
      reasonType: "LIVENESS_STATE",
      caseEvidenceJson: null,
      state,
    }));

  return {
    suggestions,
    corrections,
    revisions,
    duplicates,
    places: placeRows,
    livenessFilter,
    livenessRows: [...caseRows, ...stateRows].filter((row) => matchesLivenessFilter(row, livenessFilter)),
    revalidationCount: revalidations.length,
  };
}

export async function action({ request }: Route.ActionArgs) {
  const admin = await requireAdmin(request);
  const form = await request.formData();
  const db = createDb(env.DB);
  const now = new Date().toISOString();
  const intent = String(form.get("intent") ?? "");
  if (intent === "approve-suggestion") {
    const latitudeRaw = String(form.get("latitude") ?? "").trim();
    const longitudeRaw = String(form.get("longitude") ?? "").trim();
    const latitude = latitudeRaw ? Number(latitudeRaw) : null;
    const longitude = longitudeRaw ? Number(longitudeRaw) : null;
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
  if (intent === "resolve-liveness") {
    await resolvePlaceLivenessCase(db, {
      caseId: String(form.get("caseId")),
      actorUserId: admin.id,
      resolution: String(form.get("resolution")) as "OPEN" | "TEMPORARILY_CLOSED" | "CLOSED" | "MOVED",
      reason: String(form.get("reason") ?? ""),
      now,
    });
    return { ok: true, message: "영업 상태 검수를 반영했습니다." };
  }
  if (intent === "clear-recommendation-exclusions") {
    const result = await clearRecommendationExclusions(db, { actorUserId: admin.id, reason: String(form.get("reason") ?? ""), now });
    return { ok: true, message: `자동 추천 제외 ${result.updated}건을 해제했습니다.` };
  }
  throw new Response("Invalid intent", { status: 400 });
}

export function meta() { return [{ title: "장소 운영 — Re:Taste Admin" }]; }

export default function AdminPlaceOperations({ loaderData, actionData }: Route.ComponentProps) {
  const names = new Map(loaderData.places.map((place) => [place.id, place.name]));
  return <main id="main" className="place-ops shell">
    <header className="place-ops-head">
      <div><p className="eyebrow">ADMIN / PLACE OPERATIONS</p><h1>장소 운영</h1><p>제안·정정·중복·폐업 검토를 지도 없이 순서대로 처리합니다.</p></div>
      <nav><Link to="/admin/candidates">공공데이터 검수</Link><Link to="/admin/ratings">평가 운영</Link></nav>
    </header>
    {actionData?.message && <p className="admin-notice">{actionData.message}</p>}
    <section className="place-ops-stats"><Stat label="장소 제안" value={loaderData.suggestions.length}/><Stat label="정보 정정" value={loaderData.corrections.length}/><Stat label="영업 재검증" value={loaderData.revalidationCount}/><Stat label="중복 후보" value={loaderData.duplicates.length}/></section>
    <OpsSection title="회원 장소 제안" empty="검토할 제안이 없습니다.">
      {loaderData.suggestions.map((item) => <article className="ops-card" key={item.id}><div><span>{item.status}</span><h3>{item.name}</h3><p>{item.address} · {item.neighborhood}</p><small>{item.description ?? "설명 없음"}</small></div><div className="ops-actions"><Form method="post" className="ops-form"><input type="hidden" name="intent" value="approve-suggestion"/><input type="hidden" name="suggestionId" value={item.id}/><div><input name="latitude" defaultValue={item.latitude ?? ""} placeholder="위도"/><input name="longitude" defaultValue={item.longitude ?? ""} placeholder="경도"/></div><input name="reason" placeholder="승인 근거" required/><button>초안 승인</button></Form><Form method="post" className="ops-form ops-form-compact"><input type="hidden" name="intent" value="transition-suggestion"/><input type="hidden" name="suggestionId" value={item.id}/><input name="reason" placeholder="추가 정보 요청 사유" required/><button className="secondary" name="status" value="NEEDS_INFO">추가 정보</button><button className="secondary" name="status" value="REJECTED">반려</button></Form></div></article>)}
    </OpsSection>
    <OpsSection title="정보 정정·이의 제기" empty="검토할 정정 요청이 없습니다.">
      {loaderData.corrections.map((item) => <article className="ops-card" key={item.id}><div><span>{item.status} · {item.requestType}</span><h3>{item.placeId ? names.get(item.placeId) ?? item.placeId : "목록에 없는 장소"}</h3><p>{item.requesterRelation} · {item.requesterEmail}</p><code>{item.requestedChangesJson}</code><small>{item.evidenceNote}</small></div><div className="ops-actions"><Form method="post" className="ops-form"><input type="hidden" name="requestId" value={item.id}/><input name="reason" placeholder="적용 근거" required/><button name="intent" value="apply-correction">정정 적용</button></Form><Form method="post" className="ops-form ops-form-compact"><input type="hidden" name="intent" value="transition-correction"/><input type="hidden" name="requestId" value={item.id}/><input name="reason" placeholder="반려 사유" required/><button className="secondary" name="status" value="REJECTED">반려</button></Form></div></article>)}
    </OpsSection>
    <OpsSection title="영업 상태 재검증" empty="검수할 영업 상태가 없습니다.">
      <div className="liveness-toolbar">
        <Form method="get" className="liveness-filters"><label>상태 필터<select name="liveness" defaultValue={loaderData.livenessFilter ?? ""} aria-label="영업 상태 필터"><option value="">전체</option><option value="SUSPECTED">운영 의심</option><option value="HIDDEN">임시 숨김</option><option value="ERROR">공급자 오류</option></select></label><button>적용</button><Link to="/admin/place-operations">초기화</Link></Form>
        <Form method="post" className="liveness-reset-form"><input type="hidden" name="intent" value="clear-recommendation-exclusions"/><input name="reason" aria-label="자동 추천 제외 해제 근거" placeholder="해제 근거" required/><button className="secondary">자동 추천 제외 전체 해제</button></Form>
      </div>
      {loaderData.livenessRows.length ? loaderData.livenessRows.map((item) => <article className="ops-card liveness-card" key={`${item.caseId ?? "state"}-${item.placeId}`}>
        <div><span>{formatReasonType(item.reasonType)} · {formatLivenessStatus(item.status)}</span><h3>{item.placeName}</h3><LivenessEvidenceView item={item}/></div>
        {item.caseId ? <Form method="post" className="ops-form liveness-action-form"><input type="hidden" name="intent" value="resolve-liveness"/><input type="hidden" name="caseId" value={item.caseId}/><select name="resolution" aria-label={`${item.placeName} 검수 결과`}><option value="OPEN">정상 영업</option><option value="TEMPORARILY_CLOSED">임시 휴업</option><option value="CLOSED">폐업</option><option value="MOVED">이전</option></select><input name="reason" aria-label={`${item.placeName} 검수 근거`} placeholder="검수 근거" required/><button>검수 반영</button></Form> : <p className="liveness-readonly">자동 검증 상태</p>}
      </article>) : <p>검수할 영업 상태가 없습니다.</p>}
    </OpsSection>
    <OpsSection title="중복 장소 병합" empty=""><Form method="post" className="merge-form"><input type="hidden" name="intent" value="merge"/><label>남길 장소<select name="targetPlaceId">{loaderData.places.map((place) => <option key={place.id} value={place.id}>{place.name} · {place.status}</option>)}</select></label><label>흡수할 장소<select name="sourcePlaceId">{loaderData.places.map((place) => <option key={place.id} value={place.id}>{place.name} · {place.status}</option>)}</select></label><input name="reason" placeholder="병합 근거" required/><button>병합 실행</button></Form></OpsSection>
    <OpsSection title="최근 변경·복원" empty="변경 이력이 없습니다.">
      {loaderData.revisions.map((item) => <article className="ops-revision" key={item.id}><div><strong>{item.action}</strong><span>{names.get(item.placeId) ?? item.placeId}</span><small>{item.reason} · {item.createdAt}</small></div>{item.beforeJson && <Form method="post"><input type="hidden" name="intent" value="restore"/><input type="hidden" name="revisionId" value={item.id}/><input name="reason" placeholder="복원 사유" required/><button>이 값으로 복원</button></Form>}</article>)}
    </OpsSection>
  </main>;
}

function LivenessEvidenceView({ item }: { item: LivenessRow }) {
  const latestInternalActivity = latestTimestamp(item.evidence.reviewer.at, item.evidence.member.at);
  return <dl className="liveness-evidence"><div><dt>Kakao 상태</dt><dd>{formatKakaoStatus(item.kakaoStatus)}</dd></div><div><dt>일치 점수</dt><dd>{item.evidence.score.total ?? item.matchScore ?? "-"}</dd></div><div><dt>점수 구성</dt><dd>이름 {item.evidence.score.name ?? "-"} · 주소 {item.evidence.score.address ?? "-"} · 거리 {item.evidence.score.distance ?? "-"} · 전화 {item.evidence.score.phone ?? "-"}</dd></div><div><dt>연속 미검색</dt><dd>{item.consecutiveNotFound}회</dd></div><div><dt>최신 내부 활동</dt><dd>{latestInternalActivity ?? "없음"}</dd></div><div><dt>활동 상태</dt><dd>검토 {item.evidence.reviewer.active ? "있음" : "없음"} · 회원 {item.evidence.member.active ? "있음" : "없음"} · 공개 {item.evidence.openSource.active ? "있음" : "없음"}</dd></div><div><dt>공개 출처</dt><dd>{item.evidence.source ?? "-"}</dd></div>{item.protectedUntil && <div><dt>보호 종료</dt><dd>{item.protectedUntil}</dd></div>}</dl>;
}

type LivenessStateRow = {
  placeId: string;
  placeName: string;
  status: "VERIFIED" | "MONITORING" | "SUSPECTED" | "HIDDEN";
  kakaoStatus: "MATCHED" | "AMBIGUOUS" | "NOT_FOUND" | "ERROR" | "SKIPPED";
  matchScore: number | null;
  consecutiveNotFound: number;
  protectedUntil: string | null;
  evidenceJson: string;
  updatedAt: string;
};

type LivenessRow = {
  caseId: string | null;
  placeId: string;
  placeName: string;
  reasonType: string;
  status: LivenessStateRow["status"] | null;
  kakaoStatus: LivenessStateRow["kakaoStatus"];
  matchScore: number | null;
  consecutiveNotFound: number;
  protectedUntil: string | null;
  evidence: LivenessEvidence;
};

function livenessRow(input: { caseId: string | null; placeId: string; placeName: string; reasonType: string; caseEvidenceJson: string | null; state: LivenessStateRow | undefined }): LivenessRow {
  const evidence = parseLivenessEvidence(input.state?.evidenceJson ?? input.caseEvidenceJson ?? "{}");
  return {
    caseId: input.caseId,
    placeId: input.placeId,
    placeName: input.placeName,
    reasonType: input.reasonType,
    status: input.state?.status ?? null,
    kakaoStatus: input.state?.kakaoStatus ?? "SKIPPED",
    matchScore: input.state?.matchScore ?? evidence.score.total,
    consecutiveNotFound: input.state?.consecutiveNotFound ?? 0,
    protectedUntil: input.state?.protectedUntil ?? null,
    evidence,
  };
}

function parseLivenessFilter(value: string | null): LivenessFilter | null {
  return value === "SUSPECTED" || value === "HIDDEN" || value === "ERROR" ? value : null;
}

function isAttentionState(state: LivenessStateRow) {
  return state.status === "SUSPECTED" || state.status === "HIDDEN" || state.kakaoStatus === "ERROR";
}

function matchesLivenessFilter(row: LivenessRow, filter: LivenessFilter | null) {
  if (!filter) return true;
  return filter === "ERROR" ? row.kakaoStatus === "ERROR" : row.status === filter;
}

function parseLivenessEvidence(value: string): LivenessEvidence {
  const parsed = parseObject(value);
  const nestedEvidence = parseObject(parsed.evidence);
  const evidence = Object.keys(nestedEvidence).length ? nestedEvidence : parsed;
  return {
    source: sourceLabel(parsed.source),
    score: parseScore(evidence.score),
    reviewer: parseActivity(evidence.recentReviewerActivity),
    member: parseActivity(evidence.recentMemberActivity),
    openSource: parseActivity(evidence.recentOpenSource),
  };
}

function parseObject(value: unknown): Record<string, unknown> {
  if (typeof value === "string") {
    try { return parseObject(JSON.parse(value)); } catch { return {}; }
  }
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function parseScore(value: unknown): EvidenceScore {
  const score = parseObject(value);
  return { name: boundedNumber(score.name), address: boundedNumber(score.address), distance: boundedNumber(score.distance), phone: boundedNumber(score.phone), total: boundedNumber(score.total) };
}

function parseActivity(value: unknown): ActivityEvidence {
  const activity = parseObject(value);
  return { active: activity.active === true, at: timestamp(activity.at) };
}

function boundedNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 100 ? value : null;
}

function timestamp(value: unknown) {
  return typeof value === "string" && Number.isFinite(Date.parse(value)) ? value : null;
}

function sourceLabel(value: unknown) {
  return value === "PLACE_LIVENESS_VERIFICATION" ? "자동 영업검증" : null;
}

function latestTimestamp(...values: Array<string | null>) {
  return values.filter((value): value is string => value !== null).sort().at(-1) ?? null;
}

function formatReasonType(value: string) {
  return ({ CLOSED: "폐업 신고", TEMPORARILY_CLOSED: "임시 휴업", UNKNOWN: "운영 미확인", SOURCE_CONFLICT: "출처 충돌", STALE_90D: "90일 재확인", LIVENESS_STATE: "자동 검증" } as Record<string, string>)[value] ?? "영업 검증";
}

function formatLivenessStatus(value: LivenessRow["status"]) {
  return ({ VERIFIED: "정상", MONITORING: "관찰", SUSPECTED: "운영 의심", HIDDEN: "임시 숨김" } as Record<string, string>)[value ?? ""] ?? "검수 대기";
}

function formatKakaoStatus(value: LivenessStateRow["kakaoStatus"]) {
  return ({ MATCHED: "일치", AMBIGUOUS: "모호", NOT_FOUND: "미검색", ERROR: "공급자 오류", SKIPPED: "미확인" } as Record<string, string>)[value];
}

function Stat({ label, value }: { label: string; value: number }) { return <article><span>{label}</span><strong>{value}</strong></article>; }
function OpsSection({ title, empty, children }: { title: string; empty: string; children: React.ReactNode }) { return <section className="place-ops-section"><h2>{title}</h2>{Children.count(children) ? children : <p>{empty}</p>}</section>; }
