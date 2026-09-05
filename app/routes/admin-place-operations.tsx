import { env } from "cloudflare:workers";
import { eq } from "drizzle-orm";
import { data, Link } from "react-router";

import type { Route } from "./+types/admin-place-operations";
import { PlaceCorrectionPanel } from "../components/admin/PlaceCorrectionPanel";
import { PlaceLivenessPanel } from "../components/admin/PlaceLivenessPanel";
import { PlaceMergePanel } from "../components/admin/PlaceMergePanel";
import { PlaceReviewPipeline } from "../components/admin/PlaceReviewPipeline";
import { PlaceSuggestionReviewCard } from "../components/admin/PlaceSuggestionReviewCard";
import { createDb } from "../db/client.server";
import { categories } from "../db/schema";
import { requireAdmin } from "../features/auth/session.server";
import { getTerminalCategoryIds } from "../features/candidates/category-selection";
import { assertNaverLocalSearchEnabled, createNaverLocalSearchAdapter, NaverLocalSearchError } from "../features/candidates/naver-local-search.server";
import { isSameOriginMutation } from "../features/http/same-origin";
import { listCorrectionOperations, listDuplicateOperations, listLivenessOperations } from "../features/places/place-operations-admin.server";
import {
  checkClearExclusionsRequest,
  checkCorrectionApplyRequest,
  checkCorrectionTransitionRequest,
  checkLivenessResolveRequest,
  checkMergeRequest,
  checkRestoreRequest,
  operationsErrorMessage,
} from "../features/places/place-operations-io";
import { parsePlaceOperationsTab, placeOperationsTabHref, type PlaceOperationsTab } from "../features/places/place-operations-tabs";
import { applyPlaceCorrection, transitionPlaceCorrection } from "../features/places/place-correction.server";
import { mergePlaces, restorePlaceRevision } from "../features/places/place-merge.server";
import { confirmReviewItemCategories } from "../features/places/place-review-category.server";
import { listReviewDuplicateCandidates, resolveReviewDuplicates } from "../features/places/place-review-duplicates.server";
import { verifyReviewItemsWithNaver } from "../features/places/place-review-naver.server";
import { reviewErrorMessage } from "../features/places/place-review-errors";
import { checkReviewRequest } from "../features/places/place-review-io";
import { parsePlaceReviewQuery } from "../features/places/place-review-pagination";
import { publishReviewedPlaces } from "../features/places/place-review-publication.server";
import { confirmLocalDiningReview } from "../features/places/local-dining-review.server";
import { getPlaceReviewStageCounts, listPlaceReviewWorkItems } from "../features/places/place-review-query.server";
import { isConfidentAdvanceEnabled } from "../features/places/place-review-pipeline";
import { advanceConfidentReviewWorkItems, advancePlaceReviewWorkItems, autoExcludeNonFoodReviewItems, excludePlaceReviewItems, holdPlaceReviewItems, updateReviewItemAddresses } from "../features/places/place-review-work-items.server";
import { clearRecommendationExclusions, resolvePlaceLivenessCase } from "../features/places/place-revalidation.server";
import { checkSuggestionApprovalRequest, checkSuggestionTransitionRequest, suggestionApprovalErrorMessage } from "../features/places/place-suggestion-io";
import { approvePlaceSuggestion, listReviewablePlaceSuggestions, transitionPlaceSuggestion } from "../features/places/place-suggestion.server";
import { listNaverRegionDailyUsage } from "../features/places/naver-region-quota.server";

function reviewActionError(code: string, extra?: { batchId?: string }) {
  const mapped = reviewErrorMessage(code);
  return data({ ok: false, error: mapped.message, code: mapped.code, ...extra }, { status: 400 });
}

function reviewCaughtError(error: unknown, extra?: { batchId?: string }) {
  const code = error instanceof NaverLocalSearchError ? error.code : error instanceof Error ? error.message : "UNKNOWN";
  return reviewActionError(code, extra);
}

function operationsActionError(code: string) {
  return data({ ok: false, error: operationsErrorMessage(code), code }, { status: 400 });
}

function operationsCaughtError(error: unknown) {
  return operationsActionError(error instanceof Error ? error.message : "UNKNOWN");
}

function selectedWorkItems(form: FormData) {
  const versions: Record<string, number> = {};
  const workItemIds = form.getAll("workItem").flatMap((value) => {
    const [id, version] = String(value).split("|");
    const parsedVersion = Number(version);
    if (!id || !Number.isInteger(parsedVersion) || parsedVersion < 0) return [];
    versions[id] = parsedVersion;
    return [id];
  });
  return { workItemIds, versions };
}

export async function loader({ request }: Route.LoaderArgs) {
  await requireAdmin(request);
  const db = createDb(env.DB);
  const url = new URL(request.url);
  const tab = parsePlaceOperationsTab(url);
  if (tab === "liveness") {
    const liveness = await listLivenessOperations(db, url.searchParams.get("liveness"));
    return { tab, ...liveness };
  }
  if (tab === "duplicates") {
    return { tab, ...(await listDuplicateOperations(db)) };
  }
  if (tab === "corrections") {
    return { tab, corrections: await listCorrectionOperations(db) };
  }
  const query = parsePlaceReviewQuery(url);
  const now = new Date().toISOString();
  const placeGeocodingEnabled = env.NAVER_PLACE_GEOCODING_ENABLED === "true";
  const [page, counts, naverRegionUsage, categoryRows, suggestions] = await Promise.all([
    listPlaceReviewWorkItems(db, query),
    getPlaceReviewStageCounts(db),
    listNaverRegionDailyUsage(db, now),
    db.select({ id: categories.id, name: categories.name, parentId: categories.parentId }).from(categories).where(eq(categories.isActive, true)),
    listReviewablePlaceSuggestions(db),
  ]);
  const terminalCategoryIds = getTerminalCategoryIds(categoryRows);
  const duplicateCandidates = query.step === 4
    ? await listReviewDuplicateCandidates(db, page.rows.map((row) => row.workItemId))
    : [];
  return {
    tab,
    query, page, counts, categories: categoryRows.filter((category) => terminalCategoryIds.has(category.id)), duplicateCandidates,
    suggestions,
    naverRegionUsage,
    naverMapsClientId: placeGeocodingEnabled ? env.NAVER_MAPS_CLIENT_ID ?? "" : "",
    placeGeocodingEnabled,
    confidentAdvanceEnabled: isConfidentAdvanceEnabled(env.REVIEW_CONFIDENT_ADVANCE_ENABLED),
  };
}

export async function action({ request }: Route.ActionArgs) {
  const admin = await requireAdmin(request);
  if (!isSameOriginMutation(request)) return data({ ok: false, error: "이 요청은 현재 서비스에서 다시 실행해 주세요." }, { status: 403 });
  const form = await request.formData();
  const db = createDb(env.DB);
  const now = new Date().toISOString();
  const confidentAdvanceEnabled = isConfidentAdvanceEnabled(env.REVIEW_CONFIDENT_ADVANCE_ENABLED);
  const intent = String(form.get("intent") ?? "");
  if (intent === "approve-suggestion") {
    const suggestionId = String(form.get("suggestionId") ?? "");
    const prefix = `approval-${suggestionId}-`;
    const checked = checkSuggestionApprovalRequest({
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
    if (!checked.ok) {
      return data({ ok: false, error: suggestionApprovalErrorMessage(checked.code), code: checked.code, suggestionId }, { status: 400 });
    }
    try {
      const result = await approvePlaceSuggestion(db, { ...checked.value, actorUserId: admin.id, now });
      return { ok: true, suggestionId: checked.value.suggestionId, placeId: result.placeId, slug: result.slug, message: "제안을 비공개 초안으로 승인했습니다." };
    } catch (error) {
      const code = error instanceof Error ? error.message : "UNKNOWN";
      return data({ ok: false, error: suggestionApprovalErrorMessage(code), code, suggestionId }, { status: 400 });
    }
  }
  if (intent === "transition-suggestion") {
    const checked = checkSuggestionTransitionRequest({
      suggestionId: form.get("suggestionId"),
      status: form.get("status"),
      reason: form.get("reason"),
    });
    if (!checked.ok) {
      return data({ ok: false, error: suggestionApprovalErrorMessage(checked.code), code: checked.code }, { status: 400 });
    }
    try {
      await transitionPlaceSuggestion(db, { ...checked.value, actorUserId: admin.id, now });
      return { ok: true, message: checked.value.status === "REJECTED" ? "제안을 반려했습니다." : "추가 정보를 요청했습니다." };
    } catch (error) {
      const code = error instanceof Error ? error.message : "UNKNOWN";
      return data({ ok: false, error: suggestionApprovalErrorMessage(code), code }, { status: 400 });
    }
  }
  if (intent === "apply-correction") {
    const checked = checkCorrectionApplyRequest({ requestId: form.get("requestId"), reason: form.get("reason") });
    if (!checked.ok) return operationsActionError(checked.code);
    try {
      await applyPlaceCorrection(db, { ...checked.value, actorUserId: admin.id, now });
      return { ok: true, message: "정정 내용을 적용하고 수정 이력을 남겼습니다." };
    } catch (error) {
      return operationsCaughtError(error);
    }
  }
  if (intent === "transition-correction") {
    const checked = checkCorrectionTransitionRequest({
      requestId: form.get("requestId"),
      status: form.get("status"),
      reason: form.get("reason"),
    });
    if (!checked.ok) return operationsActionError(checked.code);
    try {
      await transitionPlaceCorrection(db, { ...checked.value, actorUserId: admin.id, now });
      return { ok: true, message: checked.value.status === "REJECTED" ? "정정 요청을 반려했습니다." : "정정 요청을 검토 중으로 바꿨습니다." };
    } catch (error) {
      return operationsCaughtError(error);
    }
  }
  if (intent === "merge") {
    const checked = checkMergeRequest({
      targetPlaceId: form.get("targetPlaceId"),
      sourcePlaceId: form.get("sourcePlaceId"),
      reason: form.get("reason"),
    });
    if (!checked.ok) return operationsActionError(checked.code);
    try {
      await mergePlaces(db, { ...checked.value, actorUserId: admin.id, now });
      return { ok: true, message: "중복 장소를 병합하고 기존 URL 리다이렉트를 생성했습니다." };
    } catch (error) {
      return operationsCaughtError(error);
    }
  }
  if (intent === "restore") {
    const checked = checkRestoreRequest({ revisionId: form.get("revisionId"), reason: form.get("reason") });
    if (!checked.ok) return operationsActionError(checked.code);
    try {
      await restorePlaceRevision(db, { ...checked.value, actorUserId: admin.id, now });
      return { ok: true, message: "선택한 이전 값으로 복원했습니다." };
    } catch (error) {
      return operationsCaughtError(error);
    }
  }
  if (intent === "resolve-liveness") {
    const checked = checkLivenessResolveRequest({
      caseId: form.get("caseId"),
      resolution: form.get("resolution"),
      reason: form.get("reason"),
    });
    if (!checked.ok) return operationsActionError(checked.code);
    try {
      await resolvePlaceLivenessCase(db, { ...checked.value, actorUserId: admin.id, now });
      return { ok: true, message: "영업 상태 검수를 반영했습니다." };
    } catch (error) {
      return operationsCaughtError(error);
    }
  }
  if (intent === "clear-recommendation-exclusions") {
    const checked = checkClearExclusionsRequest({ reason: form.get("reason") });
    if (!checked.ok) return operationsActionError(checked.code);
    try {
      const result = await clearRecommendationExclusions(db, { ...checked.value, actorUserId: admin.id, now });
      return { ok: true, message: `자동 추천 제외 ${result.updated}건을 해제했습니다.` };
    } catch (error) {
      return operationsCaughtError(error);
    }
  }
  const batchId = String(form.get("batchId") ?? "");
  const { workItemIds, versions } = selectedWorkItems(form);
	  const automaticWorkItemIds = [
		...new Set(
			form
				.getAll("autoWorkItem")
				.map((value) => String(value))
				.filter((value): value is string => value.length > 0),
		),
	];
  const expectedStage = String(form.get("expectedStage") ?? "");
  const reason = String(form.get("reason") ?? "").trim();
  const confirmPublish = String(form.get("confirmPublish") ?? "");
  const confirmLocalDining = String(form.get("confirmLocalDining") ?? "");
  const categoryByWorkItem = Object.fromEntries(workItemIds.map((workItemId) => [workItemId, String(form.get(`category:${workItemId}`) ?? "")]));
  const addressByWorkItem = Object.fromEntries(workItemIds.map((workItemId) => [workItemId, String(form.get(`address:${workItemId}`) ?? "")]));
  const checked = checkReviewRequest({
    intent, expectedStage, workItemIds, automaticWorkItemIds, reason, confirmPublish, confirmLocalDining, categoryByWorkItem, addressByWorkItem,
  });
  if (!checked.ok) return reviewActionError(checked.code, batchId ? { batchId } : undefined);

  if (intent === "auto-exclude-non-food-review-items") {
    try {
      const result = await autoExcludeNonFoodReviewItems(db, { workItemIds: automaticWorkItemIds, actorUserId: admin.id, now });
      return { ok: true, message: `로컬 방문 식당 정책 제외 ${result.changed.length}곳 · 추가 검토 ${result.skipped.length}곳`, skipped: result.skipped };
    } catch (error) {
      return reviewCaughtError(error);
    }
  }

  if (intent === "verify-review-items-with-naver") {
    try {
      assertNaverLocalSearchEnabled(env);
      const result = await verifyReviewItemsWithNaver(db, { workItemIds, actorUserId: admin.id, now, adapter: createNaverLocalSearchAdapter(env), confidentAdvanceEnabled });
      const deferred = result.deferred ? ` · 다음 실행 ${result.deferred}곳` : "";
      return { ok: true, message: `선택 ${workItemIds.length}곳 중 확인 ${result.scanned} · 통과 ${result.passed} · 확인 필요 ${result.attention} · 실패 ${result.failed}${deferred}`, skipped: result.skipped, processedWorkItemIds: result.processedWorkItemIds, nextStep: 3 as const };
    } catch (error) {
      return reviewCaughtError(error);
    }
  }
  if (intent === "auto-verify-review-item-with-naver") {
    const workItemId = workItemIds[0]!;
    try {
      if (expectedStage === "SOURCE_REVIEW") {
        const advanced = await advancePlaceReviewWorkItems(db, {
          workItemIds: [workItemId], expectedStage: "SOURCE_REVIEW", expectedVersions: versions, actorUserId: admin.id, now, confidentAdvanceEnabled,
        });
        if (!advanced.advanced.length) return reviewActionError(advanced.skipped[0]?.code ?? "UNKNOWN", { batchId });
      }
      assertNaverLocalSearchEnabled(env);
      const result = await verifyReviewItemsWithNaver(db, {
        workItemIds: [workItemId], actorUserId: admin.id, now, adapter: createNaverLocalSearchAdapter(env), confidentAdvanceEnabled,
      });
      return { ok: true, batchId, processedWorkItemIds: result.processedWorkItemIds, passed: result.passed, attention: result.attention, failed: result.failed, message: `NAVER 확인 ${result.scanned} · 통과 ${result.passed} · 확인 필요 ${result.attention} · 실패 ${result.failed}` };
    } catch (error) {
      return reviewCaughtError(error, { batchId });
    }
  }
  try {
    if (intent === "advance-confident-review-items") {
      const result = await advanceConfidentReviewWorkItems(db, {
        workItemIds, expectedStage: checked.expectedStage, expectedVersions: versions, actorUserId: admin.id, now, confidentAdvanceEnabled,
      });
      return {
        ok: true,
        message: confidentAdvanceEnabled
          ? `근거 있는 항목 이동 ${result.advanced.length}곳 · 건너뜀 ${result.skipped.length}곳 · 공개 0곳`
          : "조건부 이동이 꺼져 있습니다. 이동 0곳 · 공개 0곳",
        skipped: result.skipped,
      };
    }
    if (intent === "confirm-local-dining") {
      const result = await confirmLocalDiningReview(db, { workItemIds, expectedVersions: versions, actorUserId: admin.id, reason, confirmed: confirmLocalDining === "on", now });
      return { ok: true, message: `로컬·방문 식사 근거 ${result.confirmed.length}곳 저장. 단계 이동과 공개는 별도입니다.` };
    }
    if (intent === "confirm-review-categories") {
      const selections = workItemIds.map((workItemId) => ({ workItemId, categoryId: String(form.get(`category:${workItemId}`) ?? ""), reason: String(form.get("reason") ?? "") }));
      const result = await confirmReviewItemCategories(db, { selections, actorUserId: admin.id, now, confidentAdvanceEnabled });
      return { ok: true, message: `카테고리 확정 ${result.confirmed.length}곳 · 건너뜀 ${result.skipped.length}곳`, skipped: result.skipped };
    }
    if (intent === "resolve-review-duplicates") {
      const resolutions = form.getAll("duplicateCandidate").map(String).flatMap((value) => {
        const [workItemId, candidatePlaceId] = value.split("|");
        const decision = String(form.get(`duplicateDecision:${value}`) ?? "");
        const duplicateReason = String(form.get(`duplicateReason:${value}`) ?? "");
        return workItemId && candidatePlaceId && ["LINK_EXISTING", "MERGE", "DISTINCT"].includes(decision)
          ? [{ workItemId, candidatePlaceId, decision: decision as "LINK_EXISTING" | "MERGE" | "DISTINCT", reason: duplicateReason }]
          : [];
      });
      const result = await resolveReviewDuplicates(db, { resolutions, actorUserId: admin.id, now });
      return { ok: true, message: `중복 판정 ${result.accepted.length}건 저장 · 건너뜀 ${result.skipped.length}건`, skipped: result.skipped };
    }
    if (intent === "publish-review-items") {
      const result = await publishReviewedPlaces(db, { workItemIds, expectedVersions: versions, actorUserId: admin.id, now });
      return { ok: true, message: `선택 공개 ${result.published.length}곳 완료 · 건너뜀 ${result.skipped.length}곳`, skipped: result.skipped };
    }
    if (intent === "advance-review-items") {
      const result = await advancePlaceReviewWorkItems(db, { workItemIds, expectedStage: checked.expectedStage, expectedVersions: versions, actorUserId: admin.id, now, confidentAdvanceEnabled });
      if (!result.advanced.length) return reviewActionError(result.skipped[0]?.code ?? "UNKNOWN");
      return { ok: true, message: `다음 단계 이동 ${result.advanced.length}곳 · 건너뜀 ${result.skipped.length}곳`, skipped: result.skipped };
    }
    if (intent === "approve-manual-review-evidence") {
      const result = await advancePlaceReviewWorkItems(db, {
        workItemIds, expectedStage: checked.expectedStage, expectedVersions: versions, actorUserId: admin.id, now, manualEvidenceReason: reason, confidentAdvanceEnabled,
      });
      if (!result.advanced.length) return reviewActionError(result.skipped[0]?.code ?? "UNKNOWN");
      return { ok: true, message: `수동 근거로 이동 ${result.advanced.length}곳 · 건너뜀 ${result.skipped.length}곳`, skipped: result.skipped };
    }
    if (intent === "update-review-item-addresses") {
      const result = await updateReviewItemAddresses(db, { workItemIds, addressByWorkItem, actorUserId: admin.id, now });
      if (!result.changed.length) return reviewActionError(result.skipped[0]?.code ?? "UNKNOWN");
      return { ok: true, message: `주소 저장 ${result.changed.length}곳 · 건너뜀 ${result.skipped.length}곳`, skipped: result.skipped };
    }
    if (intent === "hold-review-items" || intent === "exclude-review-items") {
      const result = intent === "hold-review-items"
        ? await holdPlaceReviewItems(db, { workItemIds, actorUserId: admin.id, code: "ADMIN_REVIEW_HOLD", note: reason, now })
        : await excludePlaceReviewItems(db, { workItemIds, actorUserId: admin.id, code: "ADMIN_REVIEW_EXCLUDE", note: reason, now });
      return { ok: true, message: `${intent === "hold-review-items" ? "보류" : "제외"} ${result.changed.length}곳 · 건너뜀 ${result.skipped.length}곳`, skipped: result.skipped };
    }
    return reviewActionError("INVALID_INTENT");
  } catch (error) {
    return reviewCaughtError(error);
  }
}

export function meta() { return [{ title: "장소 검수 — Re:Taste Admin" }]; }

const operationTabs: Array<{ id: PlaceOperationsTab; label: string }> = [
  { id: "review", label: "장소 검수" },
  { id: "liveness", label: "영업 재검증" },
  { id: "corrections", label: "정보 정정" },
  { id: "duplicates", label: "중복·이력" },
];

export default function AdminPlaceOperations({ loaderData, actionData }: Route.ComponentProps) {
  const message = actionData && "message" in actionData ? actionData.message : undefined;
  const error = actionData && "error" in actionData ? actionData.error : undefined;
  const nextStep = actionData && "nextStep" in actionData && actionData.nextStep === 3 ? 3 : undefined;
  const processedWorkItemIds = actionData && "processedWorkItemIds" in actionData && Array.isArray(actionData.processedWorkItemIds)
    ? actionData.processedWorkItemIds
    : [];
  return <main id="main" className="place-ops shell place-review-shell">
    <header className="place-ops-head">
      <div><p className="eyebrow">ADMIN / PLACE REVIEW</p><h1>장소 검수</h1><p>원천부터 NAVER 근거, 카테고리, 중복 검토를 순서대로 확인한 뒤 선택 공개합니다. 영업 재검증·정정·병합은 옆 탭에서 처리합니다.</p></div>
      <nav><Link to="/admin/data-sync">공공데이터 수집</Link><Link to="/admin/ratings">평가 운영</Link></nav>
    </header>
    {message && <p className="admin-notice" role="status">{message}</p>}
    {error && loaderData.tab !== "review" && <p className="operation-error" role="alert">{error}</p>}
    <nav className="place-ops-tabs" aria-label="장소 운영 작업" role="tablist">
      {operationTabs.map((tab) => (
        <Link key={tab.id} role="tab" aria-selected={loaderData.tab === tab.id} aria-controls={`place-ops-panel-${tab.id}`} to={placeOperationsTabHref(tab.id)}>
          <span>{tab.label}</span>
        </Link>
      ))}
    </nav>
    <div id={`place-ops-panel-${loaderData.tab}`} className="place-ops-tab-panel" role="tabpanel">
      {loaderData.tab === "review" && <>
        {loaderData.query.step === 1 && <section className="place-ops-section" aria-labelledby="suggestion-review-heading">
          <h2 id="suggestion-review-heading">회원 장소 제안</h2>
          <p>SUBMITTED 제안을 지도에서 확인한 뒤 초안으로 승인하면 아래 1단계 검수 큐에 들어갑니다.</p>
          {loaderData.suggestions.map((item) => (
            <PlaceSuggestionReviewCard
              key={item.id}
              item={item}
              clientId={loaderData.naverMapsClientId}
              geocodingAvailable={loaderData.placeGeocodingEnabled && Boolean(loaderData.naverMapsClientId)}
            />
          ))}
          {!loaderData.suggestions.length && <p>검토할 제안이 없습니다.</p>}
        </section>}
        <PlaceReviewPipeline query={loaderData.query} page={loaderData.page} counts={loaderData.counts} categories={loaderData.categories} duplicateCandidates={loaderData.duplicateCandidates} naverRegionUsage={loaderData.naverRegionUsage} message={message} error={error} nextStep={nextStep} processedWorkItemIds={processedWorkItemIds} confidentAdvanceEnabled={loaderData.confidentAdvanceEnabled} />
      </>}
      {loaderData.tab === "liveness" && <PlaceLivenessPanel livenessFilter={loaderData.livenessFilter} livenessRows={loaderData.livenessRows} />}
      {loaderData.tab === "corrections" && <PlaceCorrectionPanel corrections={loaderData.corrections} />}
      {loaderData.tab === "duplicates" && <PlaceMergePanel places={loaderData.places} safeSameNameMergeGroups={loaderData.safeSameNameMergeGroups} revisions={loaderData.revisions} />}
    </div>
  </main>;
}
