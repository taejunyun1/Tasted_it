import { useEffect, useMemo, useRef, useState } from "react";
import { Form, Link, useFetcher, useNavigation } from "react-router";

import { NAVER_REVIEW_RUN_MAX, REVIEW_SELECTION_LIMIT } from "../../features/places/place-review-io";
import type { ReviewStage } from "../../features/places/place-review-pipeline";
import { buildPlaceReviewNextStepHref, type PlaceReviewQuery } from "../../features/places/place-review-pagination";
import type { PlaceReviewPage, PlaceReviewStageCounts } from "../../features/places/place-review-query.server";
import type { ReviewDuplicateCandidate } from "../../features/places/place-review-duplicates.server";
import type { RegionCode } from "../../features/regions/region-pack";
import { AdminBlockingOverlay } from "./AdminBlockingOverlay";
import { PlaceReviewCard } from "./PlaceReviewCard";
import { PlaceReviewStepNav } from "./PlaceReviewStepNav";
import { PlaceReviewToolbar } from "./PlaceReviewToolbar";

const stageByStep: Record<PlaceReviewQuery["step"], ReviewStage> = {
  1: "SOURCE_REVIEW",
  2: "NAVER_VERIFICATION",
  3: "CATEGORY_CONFIRMATION",
  4: "DUPLICATE_REVIEW",
  5: "FINAL_APPROVAL",
};

const nextAction: Record<PlaceReviewQuery["step"], string> = {
  1: "NAVER 검증 대기로 이동",
  2: "카테고리 확정으로 이동",
  3: "중복 검토로 이동",
  4: "승인·공개 대기로 이동",
  5: "선택 장소 승인·공개",
};

type NaverBatch = {
  id: string;
  items: Array<{ workItemId: string; stageVersion: number }>;
  nextIndex: number;
  awaiting: boolean;
  passed: number;
  attention: number;
  failed: number;
};

type NaverBatchActionData = { ok?: boolean; batchId?: string; error?: string; passed?: number; attention?: number; failed?: number };

const overlayCopyByIntent: Record<string, string> = {
  "approve-manual-review-evidence": "수동 근거로 이동하는 중입니다",
  "update-review-item-addresses": "주소를 저장하는 중입니다",
  "advance-review-items": "다음 단계로 이동하는 중입니다",
  "hold-review-items": "선택한 항목을 보류하는 중입니다",
  "exclude-review-items": "선택한 항목을 제외하는 중입니다",
  "auto-exclude-non-food-review-items": "비음식점을 제외하는 중입니다",
  "advance-confident-review-items": "근거 있는 항목만 다음 단계로 옮기는 중입니다",
};

export function PlaceReviewPipeline({ query, page, counts, categories, duplicateCandidates, naverRegionUsage, message, error, nextStep, processedWorkItemIds, confidentAdvanceEnabled }: {
  query: PlaceReviewQuery;
  page: PlaceReviewPage;
  counts: PlaceReviewStageCounts;
  categories: Array<{ id: string; name: string; parentId: string | null }>;
  duplicateCandidates: ReviewDuplicateCandidate[];
  naverRegionUsage: Array<{ regionCode: RegionCode; displayName: string; used: number; budget: number; enabled: boolean }>;
  message?: string;
  error?: string;
  nextStep?: 3;
  processedWorkItemIds: string[];
  confidentAdvanceEnabled: boolean;
}) {
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [naverBatch, setNaverBatch] = useState<NaverBatch | null>(null);
  const [naverBatchMessage, setNaverBatchMessage] = useState<string | null>(null);
  const navigation = useNavigation();
  const naverBatchFetcher = useFetcher<NaverBatchActionData>();
  const naverFetcherState = useRef(naverBatchFetcher.state);
  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds]);
  const duplicatesByWorkItem = useMemo(() => duplicateCandidates.reduce<Record<string, ReviewDuplicateCandidate[]>>((groups, candidate) => {
    groups[candidate.workItemId] = [...(groups[candidate.workItemId] ?? []), candidate];
    return groups;
  }, {}), [duplicateCandidates]);
  const pageKey = `${query.step}:${query.page}:${query.pageSize}:${query.status ?? ""}:${query.region ?? ""}:${query.query}`;
  const selectionLimit = REVIEW_SELECTION_LIMIT;
  useEffect(() => setSelectedIds([]), [pageKey]);
  useEffect(() => {
    if (!processedWorkItemIds.length) return;
    const processed = new Set(processedWorkItemIds);
    setSelectedIds((current) => current.filter((id) => !processed.has(id)));
  }, [processedWorkItemIds]);
  useEffect(() => {
    if (!naverBatch || naverBatch.awaiting || naverBatchFetcher.state !== "idle") return;
    const item = naverBatch.items[naverBatch.nextIndex];
    if (!item) return;
    const requestId = `${naverBatch.id}:${naverBatch.nextIndex}`;
    const formData = new FormData();
    formData.set("intent", "auto-verify-review-item-with-naver");
    formData.set("batchId", requestId);
    formData.set("expectedStage", stageByStep[query.step]);
    formData.append("workItem", `${item.workItemId}|${item.stageVersion}`);
    setNaverBatch((current) => current?.id === naverBatch.id ? { ...current, awaiting: true } : current);
    naverBatchFetcher.submit(formData, { method: "post" });
  }, [naverBatch, naverBatchFetcher, query.step]);
  useEffect(() => {
    const previousState = naverFetcherState.current;
    naverFetcherState.current = naverBatchFetcher.state;
    if (!naverBatch?.awaiting || naverBatchFetcher.state !== "idle" || previousState === "idle") return;
    const expectedRequestId = `${naverBatch.id}:${naverBatch.nextIndex}`;
    const data = naverBatchFetcher.data;
    const matched = data?.batchId === expectedRequestId && data.ok === true;
    const next = { passed: naverBatch.passed, attention: naverBatch.attention, failed: naverBatch.failed };
    if (!matched) next.failed += 1;
    else if ((data.passed ?? 0) > 0) next.passed += 1;
    else if ((data.failed ?? 0) > 0) next.failed += 1;
    else next.attention += 1;
    const nextIndex = naverBatch.nextIndex + 1;
    if (nextIndex < naverBatch.items.length) {
      setNaverBatch({ ...naverBatch, nextIndex, awaiting: false, ...next });
      return;
    }
    setSelectedIds((current) => current.filter((id) => !naverBatch.items.some((item) => item.workItemId === id)));
    setNaverBatchMessage(`NAVER 순차 검증 완료 · 통과 ${next.passed}곳 · 확인 필요 ${next.attention}곳 · 실패 ${next.failed}곳`);
    setNaverBatch(null);
  }, [naverBatch, naverBatchFetcher.data, naverBatchFetcher.state]);

  const toggle = (id: string) => setSelectedIds((current) => current.includes(id)
    ? current.filter((item) => item !== id)
    : current.length >= selectionLimit ? current : [...current, id]);
  const togglePageSelection = () => setSelectedIds((current) => current.length
    ? []
    : page.rows.slice(0, selectionLimit).map((row) => row.workItemId));
  const startNaverBatch = () => {
    const items = selectedIds.slice(0, NAVER_REVIEW_RUN_MAX).flatMap((workItemId) => {
      const row = page.rows.find((item) => item.workItemId === workItemId);
      return row ? [{ workItemId, stageVersion: row.stageVersion }] : [];
    });
    if (!items.length) return;
    setNaverBatchMessage(null);
    setNaverBatch({ id: `${Date.now()}-${Math.random()}`, items, nextIndex: 0, awaiting: false, passed: 0, attention: 0, failed: 0 });
  };
  const submitting = navigation.state !== "idle" && navigation.formData?.get("intent") != null;
  const actionMessage = overlayCopyByIntent[String(navigation.formData?.get("intent") ?? "")] ?? "검수 결과를 저장하는 중입니다";

  return <section className="place-review-flow">
    <div className="place-review-flow-head">
      <div><p className="eyebrow">REVIEW PIPELINE / 01—05</p><h2>{query.step === 2 ? "NAVER 근거 확인" : query.step === 5 ? "선택 승인·공개" : `${String(query.step).padStart(2, "0")} ${nextAction[query.step]}`}</h2><p>앞 단계 근거를 통과한 항목만 다음 단계로 이동합니다. NAVER 확인만으로는 공개되지 않습니다.</p></div>
    </div>
    {message && <p className="admin-notice" role="status">{message}</p>}
    {naverBatchMessage && <p className="admin-notice" role="status">{naverBatchMessage}</p>}
    {error && <p className="operation-error" role="alert">{error}</p>}
    <PlaceReviewStepNav currentStep={query.step} counts={counts} />
    <div className="place-review-quota"><span>오늘 NAVER 요청</span>{naverRegionUsage.map((row) => <strong key={row.regionCode}>{row.displayName} {row.enabled ? "켜짐" : "꺼짐"} {row.used.toLocaleString()} / {row.budget.toLocaleString()}회</strong>)}<p>지역 예산은 팩 필드입니다. 한 지역이 소진돼도 다른 지역은 계속됩니다. {selectionLimit}곳까지 선택할 수 있습니다. NAVER 검증은 최대 {NAVER_REVIEW_RUN_MAX}곳을 한 곳씩 순차 처리합니다. 노매치는 자동으로 넘어가지 않으며 확인필요로 남습니다. 조건부 이동 스위치(`REVIEW_CONFIDENT_ADVANCE_ENABLED`)는 {confidentAdvanceEnabled ? "켜짐" : "꺼짐"}입니다. 꺼져 있으면 근거 버튼은 0곳입니다. NAVER 호출과 공개는 하지 않습니다.</p></div>
    <PlaceReviewToolbar query={query} page={page} />
    <Form method="post" className="place-review-batch-form">
      <input type="hidden" name="expectedStage" value={stageByStep[query.step]} />
      {query.step === 1 && page.rows.map((row) => <input key={`auto:${row.workItemId}`} type="hidden" name="autoWorkItem" value={row.workItemId} />)}
      {selectedIds.map((id) => {
        const row = page.rows.find((item) => item.workItemId === id);
        return <span key={id}><input type="hidden" name="workItem" value={`${id}|${row?.stageVersion ?? 0}`} /><input type="hidden" name="workItemId" value={id} /></span>;
      })}
      <div className="place-review-selection-bar">
        <strong>{selectedIds.length} / {selectionLimit} 선택</strong><span>페이지를 바꾸면 선택은 해제됩니다.</span>
        <button type="button" className="secondary" onClick={togglePageSelection}>{selectedIds.length ? "선택 해제" : `현재 페이지 ${Math.min(page.rows.length, selectionLimit)}곳 선택`}</button>
        {query.step === 1 && <button className="danger" name="intent" value="auto-exclude-non-food-review-items" disabled={!page.rows.length}>비음식점 자동 제외</button>}
      </div>
      <div className="place-review-grid">
        {page.rows.map((row) => <div key={row.workItemId} className="place-review-card-wrap"><PlaceReviewCard row={row} checked={selectedSet.has(row.workItemId)} onToggle={() => toggle(row.workItemId)} addressEditable={query.step === 2} />
          {query.step === 3 && selectedSet.has(row.workItemId) && <label className="place-review-category-select">최종 카테고리<select name={`category:${row.workItemId}`} defaultValue={row.selectedCategoryId ?? row.naverMappedCategoryId ?? ""}><option value="">카테고리 선택</option>{categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}</select></label>}
          {query.step === 4 && selectedSet.has(row.workItemId) && <div className="place-review-duplicates">
            {!(duplicatesByWorkItem[row.workItemId]?.length) && <p>프랜차이즈를 제외한 동일 상호·동일 위치 후보가 없습니다. 다음 단계로 이동할 수 있습니다.</p>}
            {duplicatesByWorkItem[row.workItemId]?.map((candidate) => <fieldset key={candidate.candidatePlaceId}>
              <input type="hidden" name="duplicateCandidate" value={`${candidate.workItemId}|${candidate.candidatePlaceId}`} />
              <legend>{candidate.name} <span>{candidate.reason === "SAME_ADDRESS" ? "동일 주소" : `${candidate.distanceMeters}m`}</span></legend>
              <p>{candidate.address}</p>
              <label>판정<select name={`duplicateDecision:${candidate.workItemId}|${candidate.candidatePlaceId}`} defaultValue={candidate.decision ?? "DISTINCT"}><option value="DISTINCT">별도 장소</option><option value="LINK_EXISTING">기존 장소에 연결</option><option value="MERGE">병합 검토</option></select></label>
              <label>근거<input name={`duplicateReason:${candidate.workItemId}|${candidate.candidatePlaceId}`} defaultValue={candidate.decision ? "기존 판정 유지" : ""} minLength={10} maxLength={300} placeholder="판정 근거를 10자 이상 입력" /></label>
            </fieldset>)}
          </div>}
        </div>)}
      </div>
      {!page.rows.length && <p className="place-review-empty">이 조건에 해당하는 검수 항목이 없습니다.</p>}
      <div className="place-review-actions">
        <label>보류·제외·수동 근거<input name="reason" maxLength={300} placeholder="보류·제외 사유, 또는 강제 이동 시 20자 이상" /></label>
        {query.step === 5 && <label className="place-review-publish-confirm"><span><input type="checkbox" name="confirmPublish" /> 선택한 장소만 공개하며, 이 동작은 되돌릴 수 있음을 확인합니다.</span></label>}
        <button className="secondary" name="intent" value="hold-review-items" disabled={!selectedIds.length}>선택 항목 보류</button>
        <button className="danger" name="intent" value="exclude-review-items" disabled={!selectedIds.length}>선택 항목 제외</button>
        {query.step === 4 && <button className="secondary" name="intent" value="resolve-review-duplicates" disabled={!selectedIds.length}>선택 중복 판정 저장</button>}
        {(query.step === 1 || query.step === 2) && <button type="button" onClick={startNaverBatch} disabled={!selectedIds.length || Boolean(naverBatch)}>선택 중 {Math.min(selectedIds.length, NAVER_REVIEW_RUN_MAX)}곳 NAVER 검증</button>}
        {query.step !== 5 && <button className="secondary" name="intent" value="advance-confident-review-items" disabled={!selectedIds.length || Boolean(naverBatch)}>근거 있는 항목만 다음 단계</button>}
        {query.step === 1 && <button className="secondary" name="intent" value="advance-review-items" disabled={!selectedIds.length || Boolean(naverBatch)}>수동으로 NAVER 검증 대기로 이동</button>}
        {query.step === 2 && <button className="secondary" name="intent" value="update-review-item-addresses" disabled={!selectedIds.length || Boolean(naverBatch)}>선택 주소 저장</button>}
        {query.step === 2 && <button className="secondary" name="intent" value="advance-review-items" disabled={!selectedIds.length || Boolean(naverBatch)}>선택 항목을 카테고리 확정으로 이동</button>}
        {query.step === 2 && <button name="intent" value="approve-manual-review-evidence" disabled={!selectedIds.length || Boolean(naverBatch)}>수동 근거로 카테고리 단계 이동</button>}
        {query.step !== 1 && query.step !== 2 && <button name="intent" value={query.step === 5 ? "publish-review-items" : query.step === 3 ? "confirm-review-categories" : "advance-review-items"} disabled={!selectedIds.length}>{query.step === 3 ? "선택 카테고리 확정" : nextAction[query.step]}</button>}
        {query.step === 2 && !naverBatch && <Link className="secondary" to={buildPlaceReviewNextStepHref(query)}>{nextStep === 3 ? "NAVER 확인 후 카테고리 확정 단계 보기" : "카테고리 확정 단계로 이동"}</Link>}
      </div>
    </Form>
    <PlaceReviewToolbar query={query} page={page} />
    <AdminBlockingOverlay active={submitting || Boolean(naverBatch)} label={naverBatch ? `NAVER 근거를 순차 확인하는 중입니다 (${naverBatch.nextIndex + 1}/${naverBatch.items.length})` : actionMessage} />
  </section>;
}
