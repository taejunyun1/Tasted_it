import { env } from "cloudflare:workers";
import { asc, desc, eq, inArray } from "drizzle-orm";
import { Children, useState } from "react";
import { data, Form, Link } from "react-router";
import { z } from "zod";
import type { Route } from "./+types/admin-place-operations";

import { PlaceSuggestionReviewCard } from "../components/admin/PlaceSuggestionReviewCard";
import { createDb } from "../db/client.server";
import { placeCorrectionRequests, placeDuplicateCandidates, placeLivenessStates, placeRevalidationCases, placeRevisions, placeSuggestions, places } from "../db/schema";
import { requireAdmin } from "../features/auth/session.server";
import { isSameOriginMutation } from "../features/http/same-origin";
import { applyPlaceCorrection, transitionPlaceCorrection } from "../features/places/place-correction.server";
import { mergePlaces, restorePlaceRevision } from "../features/places/place-merge.server";
import { recallPublishedPlaces, restoreRecalledPlaces } from "../features/places/place-publication-recall.server";
import { groupPlacesByNormalizedName } from "../features/places/place-name-groups";
import { parsePlaceOperationsTab, type PlaceOperationsTab } from "../features/places/place-operations-tabs";
import { buildSafeSameNameMergeGroups, mergeSafeSameNamePlaces } from "../features/places/place-same-name-merge.server";
import { getNaverLocalSearchApiCallsToday, verifyPlacesLivenessWithNaver } from "../features/places/naver-place-liveness.server";
import { clearRecommendationExclusions, resolvePlaceLivenessCase } from "../features/places/place-revalidation.server";
import { approvePlaceSuggestion, transitionPlaceSuggestion } from "../features/places/place-suggestion.server";
import { assertNaverLocalSearchEnabled, createNaverLocalSearchAdapter, NaverLocalSearchError } from "../features/candidates/naver-local-search.server";

type LivenessFilter = "SUSPECTED" | "HIDDEN" | "ERROR";
type EvidenceScore = { name: number | null; address: number | null; distance: number | null; phone: number | null; total: number | null };
type ActivityEvidence = { active: boolean; at: string | null };
type LivenessEvidence = { source: string | null; score: EvidenceScore; reviewer: ActivityEvidence; member: ActivityEvidence; openSource: ActivityEvidence };

const approvalSchema = z.object({
  suggestionId: z.string().trim().min(1).max(160),
  address: z.string().trim().min(5).max(300),
  neighborhood: z.string().trim().min(1).max(80),
  originLatitude: z.coerce.number().finite(),
  originLongitude: z.coerce.number().finite(),
  latitude: z.coerce.number().finite(),
  longitude: z.coerce.number().finite(),
  locationConfirmed: z.literal("true"),
  reason: z.string().trim().min(1).max(300),
});

function approvalErrorMessage(code: string) {
  if (code === "SUGGESTION_NOT_REVIEWABLE") return "이미 처리됐거나 다른 관리자가 검토 중인 제안입니다. 목록을 새로고침해 주세요.";
  if (code === "SUGGESTION_COORDINATES_REQUIRED" || code === "LOCATION_REQUIRED") return "지도에서 위치를 확인한 뒤 승인해 주세요.";
  if (code === "LOCATION_OUT_OF_SCOPE") return "광주·전남 범위 안의 위치만 승인할 수 있어요.";
  if (code === "REVIEW_REASON_REQUIRED") return "승인 근거를 입력해 주세요.";
  return "초안 승인에 실패했어요. 잠시 뒤 목록을 새로고침한 후 다시 시도해 주세요.";
}

export async function loader({ request }: Route.LoaderArgs) {
  await requireAdmin(request);
  const db = createDb(env.DB);
  const searchParams = new URL(request.url).searchParams;
  const livenessFilter = parseLivenessFilter(searchParams.get("liveness"));
  const activeTab = parsePlaceOperationsTab(searchParams.get("tab"));
  const now = new Date().toISOString();
  const [suggestions, corrections, revalidations, revisions, duplicates, placeRows, livenessStates, naverDailyUsage] = await Promise.all([
    db.select().from(placeSuggestions).where(inArray(placeSuggestions.status, ["SUBMITTED", "NEEDS_INFO", "REVIEWING"])).orderBy(asc(placeSuggestions.createdAt)).limit(200),
    db.select().from(placeCorrectionRequests).where(inArray(placeCorrectionRequests.status, ["SUBMITTED", "REVIEWING"])).orderBy(asc(placeCorrectionRequests.createdAt)).limit(200),
    db.select().from(placeRevalidationCases).where(inArray(placeRevalidationCases.status, ["OPEN", "REVIEWING"])).orderBy(asc(placeRevalidationCases.createdAt)).limit(200),
    db.select().from(placeRevisions).orderBy(desc(placeRevisions.createdAt)).limit(100),
    db.select().from(placeDuplicateCandidates).where(inArray(placeDuplicateCandidates.status, ["OPEN"])).orderBy(desc(placeDuplicateCandidates.createdAt)).limit(100),
    db.select({ id: places.id, name: places.name, address: places.address, slug: places.slug, status: places.status, latitude: places.latitude, longitude: places.longitude, createdAt: places.createdAt }).from(places).orderBy(asc(places.name)).limit(1_000),
    db.select({
      placeId: placeLivenessStates.placeId,
      placeName: places.name,
      status: placeLivenessStates.status,
      kakaoStatus: placeLivenessStates.kakaoStatus,
      naverStatus: placeLivenessStates.naverStatus,
      naverMatchScore: placeLivenessStates.naverMatchScore,
      naverEvidenceCodesJson: placeLivenessStates.naverEvidenceCodesJson,
      matchScore: placeLivenessStates.matchScore,
      consecutiveNotFound: placeLivenessStates.consecutiveNotFound,
      protectedUntil: placeLivenessStates.protectedUntil,
      evidenceJson: placeLivenessStates.evidenceJson,
      updatedAt: placeLivenessStates.updatedAt,
    }).from(placeLivenessStates).innerJoin(places, eq(places.id, placeLivenessStates.placeId)).orderBy(desc(placeLivenessStates.updatedAt)).limit(1_000),
    getNaverLocalSearchApiCallsToday(db, now),
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
    activeTab,
    livenessFilter,
    livenessRows: [...caseRows, ...stateRows].filter((row) => matchesLivenessFilter(row, livenessFilter)),
    sameNameGroups: groupPlacesByNormalizedName(placeRows),
    safeSameNameMergeGroups: buildSafeSameNameMergeGroups(placeRows),
    naverDailyUsage,
    naverDailyLimit: Number(env.NAVER_LOCAL_SEARCH_DAILY_LIMIT ?? 20_000),
    revalidationCount: revalidations.length,
    naverMapsClientId: env.NAVER_PLACE_GEOCODING_ENABLED === "true" ? env.NAVER_MAPS_CLIENT_ID ?? "" : "",
    placeGeocodingEnabled: env.NAVER_PLACE_GEOCODING_ENABLED === "true",
  };
}

export async function action({ request }: Route.ActionArgs) {
  const admin = await requireAdmin(request);
  if (!isSameOriginMutation(request)) return data({ ok: false, error: "이 요청은 현재 서비스에서 다시 실행해 주세요." }, { status: 403 });
  const form = await request.formData();
  const db = createDb(env.DB);
  const now = new Date().toISOString();
  const intent = String(form.get("intent") ?? "");
  if (intent === "recall-published-for-category-audit") {
    const reason = String(form.get("reason") ?? "").trim();
    if (!reason) return data({ ok: false, error: "공개 회수 근거를 입력해 주세요." }, { status: 400 });
    const result = await recallPublishedPlaces(db, { actorUserId: admin.id, now, reason });
    return { ok: true, message: `${result.recalled}곳을 지도·공개 목록에서 회수했습니다.`, recallRunAt: result.auditRunAt };
  }
  if (intent === "restore-category-audit-recall") {
    const auditRunAt = String(form.get("auditRunAt") ?? "");
    const reason = String(form.get("reason") ?? "").trim();
    if (!auditRunAt || !reason) return data({ ok: false, error: "복구 대상 실행 시각과 근거를 입력해 주세요." }, { status: 400 });
    const result = await restoreRecalledPlaces(db, { actorUserId: admin.id, auditRunAt, now, reason });
    return { ok: true, message: `${result.restored}곳을 해당 회수 실행분에서만 복구했습니다.` };
  }
  if (intent === "verify-places-with-naver") {
    const placeIds = form.getAll("placeId").map(String);
    try {
      assertNaverLocalSearchEnabled(env);
      const result = await verifyPlacesLivenessWithNaver(db, {
        placeIds, now, dailyLimit: Number(env.NAVER_LOCAL_SEARCH_DAILY_LIMIT ?? 20_000), adapter: createNaverLocalSearchAdapter(env), actorUserId: admin.id,
      });
      return { ok: true, message: `NAVER 근거 확인 ${result.scanned}곳: 일치 ${result.matched} · 수동 확인 ${result.manual} · 실패 ${result.failed}` };
    } catch (error) {
      const code = error instanceof NaverLocalSearchError ? error.code : error instanceof Error ? error.message : "UNKNOWN";
      return data({ ok: false, error: code === "NAVER_LOCAL_SEARCH_QUOTA" ? "NAVER 일일 확인 한도에 도달했습니다." : `NAVER 근거 확인을 완료하지 못했습니다: ${code}` }, { status: 400 });
    }
  }
  if (intent === "merge-safe-same-name-places") {
    try {
      const result = await mergeSafeSameNamePlaces(db, {
        actorUserId: admin.id,
        now,
        reason: String(form.get("reason") ?? "동일 상호·동일 위치 운영 병합"),
      });
      return { ok: true, message: `${result.groups}개 동일 상호 묶음에서 ${result.merged}개 중복 장소를 병합했습니다.` };
    } catch (error) {
      return data({ ok: false, error: `동일 상호 병합을 완료하지 못했습니다: ${error instanceof Error ? error.message : "UNKNOWN"}` }, { status: 400 });
    }
  }
  if (intent === "approve-suggestion") {
    const suggestionId = String(form.get("suggestionId") ?? "");
    const prefix = `approval-${suggestionId}-`;
    const parsed = approvalSchema.safeParse({
      suggestionId,
      address: form.get(`${prefix}address`),
      neighborhood: form.get(`${prefix}neighborhood`),
      originLatitude: form.get(`${prefix}originLatitude`),
      originLongitude: form.get(`${prefix}originLongitude`),
      latitude: form.get(`${prefix}latitude`),
      longitude: form.get(`${prefix}longitude`),
      locationConfirmed: form.get(`${prefix}locationConfirmed`),
      reason: form.get("reason"),
    });
    if (!parsed.success) return data({ ok: false, error: "지도에서 위치를 확인하고 승인 근거를 입력해 주세요." }, { status: 400 });
    try {
      const result = await approvePlaceSuggestion(db, { suggestionId: parsed.data.suggestionId, actorUserId: admin.id, address: parsed.data.address, neighborhood: parsed.data.neighborhood, originLatitude: parsed.data.originLatitude, originLongitude: parsed.data.originLongitude, latitude: parsed.data.latitude, longitude: parsed.data.longitude, reason: parsed.data.reason, now });
      return { ok: true, suggestionId: parsed.data.suggestionId, placeId: result.placeId, slug: result.slug, message: "제안을 비공개 초안으로 승인했습니다." };
    } catch (error) {
      return data({ ok: false, error: approvalErrorMessage(error instanceof Error ? error.message : "UNKNOWN") }, { status: 400 });
    }
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
  const tabs: Array<{ id: PlaceOperationsTab; label: string; count: number }> = [
    { id: "audit", label: "근거 감사", count: loaderData.places.length },
    { id: "naver", label: "NAVER 검증", count: loaderData.places.length },
    { id: "liveness", label: "영업 재검증", count: loaderData.revalidationCount },
    { id: "suggestions", label: "장소 제안", count: loaderData.suggestions.length },
    { id: "corrections", label: "정보 정정", count: loaderData.corrections.length },
    { id: "duplicates", label: "중복·이력", count: loaderData.duplicates.length + loaderData.safeSameNameMergeGroups.length },
  ];
  return <main id="main" className="place-ops shell">
    <header className="place-ops-head">
      <div><p className="eyebrow">ADMIN / PLACE OPERATIONS</p><h1>장소 운영</h1><p>제안·정정·중복·폐업 검토를 지도 없이 순서대로 처리합니다.</p></div>
      <nav><Link to="/admin/candidates">공공데이터 검수</Link><Link to="/admin/ratings">평가 운영</Link></nav>
    </header>
    {actionData && "message" in actionData && actionData.message && <p className="admin-notice" role="status">{actionData.message}</p>}
    {actionData && "error" in actionData && actionData.error && <p className="operation-error" role="alert">{actionData.error}</p>}
    <section className="place-ops-stats"><Stat label="장소 제안" value={loaderData.suggestions.length}/><Stat label="정보 정정" value={loaderData.corrections.length}/><Stat label="영업 재검증" value={loaderData.revalidationCount}/><Stat label="중복 후보" value={loaderData.duplicates.length}/></section>
    <nav className="place-ops-tabs" aria-label="장소 운영 작업" role="tablist">{tabs.map((tab) => <Link key={tab.id} role="tab" aria-selected={loaderData.activeTab === tab.id} aria-controls={`place-ops-panel-${tab.id}`} to={`/admin/place-operations?tab=${tab.id}`}><span>{tab.label}</span><strong>{tab.count}</strong></Link>)}</nav>
    <div id={`place-ops-panel-${loaderData.activeTab}`} className="place-ops-tab-panel" role="tabpanel">
    {loaderData.activeTab === "audit" && <section className="ops-section"><div className="ops-section-head"><h2>카테고리 근거 감사</h2><p>현재 공개 장소를 삭제하지 않고 지도·공개 목록에서 회수합니다. NAVER 근거 또는 수동 승인 전에는 다시 공개하지 않습니다.</p></div><Form method="post" className="ops-form"><input type="hidden" name="intent" value="recall-published-for-category-audit"/><input name="reason" aria-label="공개 회수 근거" placeholder="카테고리 근거 재검증" required/><button className="secondary">현재 공개 장소 전체 회수</button></Form></section>}
    {loaderData.activeTab === "naver" && <PlaceNaverVerificationPanel places={loaderData.places} groups={loaderData.sameNameGroups} dailyUsage={loaderData.naverDailyUsage} dailyLimit={loaderData.naverDailyLimit}/>}
    {loaderData.activeTab === "suggestions" && <OpsSection title="회원 장소 제안" empty="검토할 제안이 없습니다.">
      {loaderData.suggestions.map((item) => <PlaceSuggestionReviewCard key={item.id} item={item} clientId={loaderData.naverMapsClientId} geocodingAvailable={loaderData.placeGeocodingEnabled && Boolean(loaderData.naverMapsClientId)} />)}
    </OpsSection>}
    {loaderData.activeTab === "corrections" && <OpsSection title="정보 정정·이의 제기" empty="검토할 정정 요청이 없습니다.">
      {loaderData.corrections.map((item) => <article className="ops-card" key={item.id}><div><span>{item.status} · {item.requestType}</span><h3>{item.placeId ? names.get(item.placeId) ?? item.placeId : "목록에 없는 장소"}</h3><p>{item.requesterRelation} · {item.requesterEmail}</p><code>{item.requestedChangesJson}</code><small>{item.evidenceNote}</small></div><div className="ops-actions"><Form method="post" className="ops-form"><input type="hidden" name="requestId" value={item.id}/><input name="reason" placeholder="적용 근거" required/><button name="intent" value="apply-correction">정정 적용</button></Form><Form method="post" className="ops-form ops-form-compact"><input type="hidden" name="intent" value="transition-correction"/><input type="hidden" name="requestId" value={item.id}/><input name="reason" placeholder="반려 사유" required/><button className="secondary" name="status" value="REJECTED">반려</button></Form></div></article>)}
    </OpsSection>}
    {loaderData.activeTab === "liveness" && <OpsSection title="영업 상태 재검증" empty="검수할 영업 상태가 없습니다.">
      <div className="liveness-toolbar">
        <Form method="get" className="liveness-filters"><input type="hidden" name="tab" value="liveness"/><label>상태 필터<select name="liveness" defaultValue={loaderData.livenessFilter ?? ""} aria-label="영업 상태 필터"><option value="">전체</option><option value="SUSPECTED">운영 의심</option><option value="HIDDEN">임시 숨김</option><option value="ERROR">공급자 오류</option></select></label><button>적용</button><Link to="/admin/place-operations?tab=liveness">초기화</Link></Form>
        <Form method="post" className="liveness-reset-form"><input type="hidden" name="intent" value="clear-recommendation-exclusions"/><input name="reason" aria-label="자동 추천 제외 해제 근거" placeholder="해제 근거" required/><button className="secondary">자동 추천 제외 전체 해제</button></Form>
      </div>
      {loaderData.livenessRows.length ? loaderData.livenessRows.map((item) => <article className="ops-card liveness-card" key={`${item.caseId ?? "state"}-${item.placeId}`}>
        <div><span>{formatReasonType(item.reasonType)} · {formatLivenessStatus(item.status)}</span><h3>{item.placeName}</h3><LivenessEvidenceView item={item}/></div>
        {item.caseId ? <Form method="post" className="ops-form liveness-action-form"><input type="hidden" name="intent" value="resolve-liveness"/><input type="hidden" name="caseId" value={item.caseId}/><select name="resolution" aria-label={`${item.placeName} 검수 결과`}><option value="OPEN">정상 영업</option><option value="TEMPORARILY_CLOSED">임시 휴업</option><option value="CLOSED">폐업</option><option value="MOVED">이전</option></select><input name="reason" aria-label={`${item.placeName} 검수 근거`} placeholder="검수 근거" required/><button>검수 반영</button></Form> : <p className="liveness-readonly">자동 검증 상태</p>}
      </article>) : <p>검수할 영업 상태가 없습니다.</p>}
    </OpsSection>}
    {loaderData.activeTab === "duplicates" && <><SafeSameNameMergePanel groups={loaderData.safeSameNameMergeGroups}/><OpsSection title="중복 장소 병합" empty=""><Form method="post" className="merge-form"><input type="hidden" name="intent" value="merge"/><label>남길 장소<select name="targetPlaceId">{loaderData.places.map((place) => <option key={place.id} value={place.id}>{place.name} · {place.status}</option>)}</select></label><label>흡수할 장소<select name="sourcePlaceId">{loaderData.places.map((place) => <option key={place.id} value={place.id}>{place.name} · {place.status}</option>)}</select></label><input name="reason" placeholder="병합 근거" required/><button>병합 실행</button></Form></OpsSection><OpsSection title="최근 변경·복원" empty="변경 이력이 없습니다.">
      {loaderData.revisions.map((item) => <article className="ops-revision" key={item.id}><div><strong>{item.action}</strong><span>{names.get(item.placeId) ?? item.placeId}</span><small>{item.reason} · {item.createdAt}</small></div>{item.beforeJson && <Form method="post"><input type="hidden" name="intent" value="restore"/><input type="hidden" name="revisionId" value={item.id}/><input name="reason" placeholder="복원 사유" required/><button>이 값으로 복원</button></Form>}</article>)}
    </OpsSection></>}
    </div>
  </main>;
}

function LivenessEvidenceView({ item }: { item: LivenessRow }) {
  const latestInternalActivity = latestTimestamp(item.evidence.reviewer.at, item.evidence.member.at);
  return <dl className="liveness-evidence"><div><dt>NAVER 상태</dt><dd>{formatNaverStatus(item.naverStatus)}</dd></div><div><dt>일치 점수</dt><dd>{item.naverMatchScore ?? item.evidence.score.total ?? item.matchScore ?? "-"}</dd></div><div><dt>근거 코드</dt><dd>{item.naverEvidenceCodes.length ? item.naverEvidenceCodes.join(" · ") : "미확인"}</dd></div><div><dt>연속 미검색</dt><dd>{item.consecutiveNotFound}회</dd></div><div><dt>최신 내부 활동</dt><dd>{latestInternalActivity ?? "없음"}</dd></div><div><dt>활동 상태</dt><dd>검토 {item.evidence.reviewer.active ? "있음" : "없음"} · 회원 {item.evidence.member.active ? "있음" : "없음"} · 공개 {item.evidence.openSource.active ? "있음" : "없음"}</dd></div><div><dt>공개 출처</dt><dd>{item.evidence.source ?? "-"}</dd></div>{item.protectedUntil && <div><dt>보호 종료</dt><dd>{item.protectedUntil}</dd></div>}</dl>;
}

type LivenessStateRow = {
  placeId: string;
  placeName: string;
  status: "VERIFIED" | "MONITORING" | "SUSPECTED" | "HIDDEN";
  kakaoStatus: "MATCHED" | "AMBIGUOUS" | "NOT_FOUND" | "ERROR" | "SKIPPED";
  naverStatus: "MATCHED" | "AMBIGUOUS" | "NOT_FOUND" | "ERROR" | "SKIPPED";
  naverMatchScore: number | null;
  naverEvidenceCodesJson: string;
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
  naverStatus: LivenessStateRow["naverStatus"];
  naverMatchScore: number | null;
  naverEvidenceCodes: string[];
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
    naverStatus: input.state?.naverStatus ?? "SKIPPED",
    naverMatchScore: input.state?.naverMatchScore ?? null,
    naverEvidenceCodes: parseEvidenceCodes(input.state?.naverEvidenceCodesJson),
    matchScore: input.state?.matchScore ?? evidence.score.total,
    consecutiveNotFound: input.state?.consecutiveNotFound ?? 0,
    protectedUntil: input.state?.protectedUntil ?? null,
    evidence,
  };
}

function parseEvidenceCodes(value: string | undefined) {
  try {
    const parsed = JSON.parse(value ?? "[]");
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string").slice(0, 8) : [];
  } catch { return []; }
}

function parseLivenessFilter(value: string | null): LivenessFilter | null {
  return value === "SUSPECTED" || value === "HIDDEN" || value === "ERROR" ? value : null;
}

function isAttentionState(state: LivenessStateRow) {
  return state.status === "SUSPECTED" || state.status === "HIDDEN" || state.naverStatus === "ERROR";
}

function matchesLivenessFilter(row: LivenessRow, filter: LivenessFilter | null) {
  if (!filter) return true;
  return filter === "ERROR" ? row.naverStatus === "ERROR" : row.status === filter;
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

function formatNaverStatus(value: LivenessStateRow["naverStatus"]) {
  return ({ MATCHED: "일치", AMBIGUOUS: "모호", NOT_FOUND: "미검색", ERROR: "공급자 오류", SKIPPED: "미확인" } as Record<string, string>)[value];
}

function SafeSameNameMergePanel({ groups }: { groups: Array<{ id: string; label: string; count: number; sourcePlaceIds: string[] }> }) {
  const absorbedCount = groups.reduce((total, group) => total + group.sourcePlaceIds.length, 0);
  return <section className="place-ops-section same-name-merge">
    <div className="ops-section-head"><p className="eyebrow">SAFE DUPLICATE MERGE</p><h2>동일 상호 중복 병합</h2><p>프랜차이즈는 제외합니다. 같은 상호이면서 주소가 같거나 좌표가 100m 이내인 장소만 하나로 합칩니다. 다른 지점은 남겨 둡니다.</p></div>
    {groups.length ? <><div className="same-name-merge-summary"><strong>{groups.length}개 묶음</strong><span>보존할 장소 {groups.length}곳 · 흡수할 중복 {absorbedCount}곳</span><Form method="post"><input type="hidden" name="intent" value="merge-safe-same-name-places"/><input type="hidden" name="reason" value="동일 상호·동일 위치 운영 병합"/><button>{groups.length}개 묶음 병합하기</button></Form></div><ul className="same-name-merge-list">{groups.slice(0, 12).map((group) => <li key={group.id}><strong>{group.label}</strong><span>동일 위치 {group.count}곳 → 1곳으로 병합</span></li>)}</ul>{groups.length > 12 && <p className="same-name-merge-more">외 {groups.length - 12}개 묶음도 같은 기준으로 처리됩니다.</p>}</> : <p className="same-name-merge-empty">지금은 자동 병합 기준을 만족하는 비프랜차이즈 중복 장소가 없습니다.</p>}
  </section>;
}

function PlaceNaverVerificationPanel({ places, groups, dailyUsage, dailyLimit }: {
  places: Array<{ id: string; name: string; address: string; slug: string; status: "DRAFT" | "PUBLISHED" | "HIDDEN" }>;
  groups: Array<{ normalizedName: string; label: string; placeIds: string[]; count: number }>;
  dailyUsage: number;
  dailyLimit: number;
}) {
  const [selectedIds, setSelectedIds] = useState<string[]>(() => places.slice(0, 25).map((place) => place.id));
  const selected = new Set(selectedIds);
  const selectableGroups = groups.filter((group) => group.count <= 25);
  const toggle = (id: string) => setSelectedIds((current) => current.includes(id) ? current.filter((item) => item !== id) : current.length < 25 ? [...current, id] : current);
  const selectGroup = (ids: string[]) => setSelectedIds((current) => ids.every((id) => current.includes(id)) ? current.filter((id) => !ids.includes(id)) : [...new Set([...current, ...ids])].slice(0, 25));
  const selectPage = () => setSelectedIds(places.slice(0, 25).map((place) => place.id));
  return <section className="place-ops-section naver-place-selection">
    <div className="ops-section-head"><p className="eyebrow">NAVER LOCAL EVIDENCE</p><h2>NAVER 근거 일괄 확인</h2><p>상호·주소·좌표를 각각 대조합니다. NAVER API Hub 전체 사용량과 별도로 이 화면에서 실행한 요청을 기록합니다.</p></div>
    <Form method="post"><input type="hidden" name="intent" value="verify-places-with-naver"/>
      <div className="naver-usage-strip"><div><span>이 앱의 오늘 NAVER 요청</span><strong>{dailyUsage.toLocaleString()} / {dailyLimit.toLocaleString()}회</strong></div><p>이번 실행은 최대 25곳입니다. 개별 상호·주소·좌표를 다시 확인해 자동 공개하지 않습니다.</p></div>
      <div className="naver-selection-toolbar"><strong>{selectedIds.length} / 25 선택</strong><button type="button" className="secondary" onClick={selectPage}>현재 목록 25곳 선택</button><button type="button" className="secondary" onClick={() => setSelectedIds([])}>선택 해제</button><button disabled={!selectedIds.length}>선택 장소 NAVER 근거 확인</button></div>
      {selectedIds.map((id) => <input key={id} type="hidden" name="placeId" value={id}/>)}
      {selectableGroups.length > 0 && <div className="same-name-groups"><h3>동일 상호 빠른 선택</h3>{selectableGroups.map((group) => <button key={group.normalizedName} type="button" aria-pressed={group.placeIds.every((id) => selected.has(id))} onClick={() => selectGroup(group.placeIds)}>{group.label} <span>{group.count}곳</span></button>)}</div>}
      <div className="naver-place-list">{places.slice(0, 25).map((place) => <label key={place.id}><input type="checkbox" checked={selected.has(place.id)} onChange={() => toggle(place.id)}/><span><strong>{place.name}</strong><small>{place.address} · {place.status}</small></span></label>)}</div>
    </Form>
  </section>;
}

function Stat({ label, value }: { label: string; value: number }) { return <article><span>{label}</span><strong>{value}</strong></article>; }
function OpsSection({ title, empty, children }: { title: string; empty: string; children: React.ReactNode }) { return <section className="place-ops-section"><h2>{title}</h2>{Children.count(children) ? children : <p>{empty}</p>}</section>; }
