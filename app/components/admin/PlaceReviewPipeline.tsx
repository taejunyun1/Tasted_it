import { useEffect, useMemo, useState } from "react";
import { Form, useNavigation } from "react-router";

import type { ReviewStage } from "../../features/places/place-review-pipeline";
import type { PlaceReviewQuery } from "../../features/places/place-review-pagination";
import type { PlaceReviewPage, PlaceReviewStageCounts } from "../../features/places/place-review-query.server";
import type { ReviewDuplicateCandidate } from "../../features/places/place-review-duplicates.server";
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

export function PlaceReviewPipeline({ query, page, counts, categories, duplicateCandidates, naverDailyUsage, naverDailyLimit, message, error }: {
  query: PlaceReviewQuery;
  page: PlaceReviewPage;
  counts: PlaceReviewStageCounts;
  categories: Array<{ id: string; name: string; parentId: string | null }>;
  duplicateCandidates: ReviewDuplicateCandidate[];
  naverDailyUsage: number;
  naverDailyLimit: number;
  message?: string;
  error?: string;
}) {
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const navigation = useNavigation();
  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds]);
  const duplicatesByWorkItem = useMemo(() => duplicateCandidates.reduce<Record<string, ReviewDuplicateCandidate[]>>((groups, candidate) => {
    groups[candidate.workItemId] = [...(groups[candidate.workItemId] ?? []), candidate];
    return groups;
  }, {}), [duplicateCandidates]);
  const pageKey = `${query.step}:${query.page}:${query.pageSize}:${query.status ?? ""}:${query.region ?? ""}:${query.query}`;
  useEffect(() => setSelectedIds([]), [pageKey]);

  const toggle = (id: string) => setSelectedIds((current) => current.includes(id)
    ? current.filter((item) => item !== id)
    : current.length >= 25 ? current : [...current, id]);
  const selectPage = () => setSelectedIds(page.rows.slice(0, 25).map((row) => row.workItemId));
  const submitting = navigation.state !== "idle" && navigation.formData?.get("intent") != null;
  const actionMessage = query.step === 2 ? "NAVER 근거를 확인하는 중입니다" : "검수 결과를 저장하는 중입니다";

  return <section className="place-review-flow">
    <div className="place-review-flow-head">
      <div><p className="eyebrow">REVIEW PIPELINE / 01—05</p><h2>{query.step === 2 ? "NAVER 근거 확인" : query.step === 5 ? "선택 승인·공개" : `${String(query.step).padStart(2, "0")} ${nextAction[query.step]}`}</h2><p>앞 단계 근거를 통과한 항목만 다음 단계로 이동합니다. NAVER 확인만으로는 공개되지 않습니다.</p></div>
    </div>
    {message && <p className="admin-notice" role="status">{message}</p>}
    {error && <p className="operation-error" role="alert">{error}</p>}
    <PlaceReviewStepNav currentStep={query.step} counts={counts} />
    <div className="place-review-quota"><span>오늘 NAVER 요청</span><strong>{naverDailyUsage.toLocaleString()} / {naverDailyLimit.toLocaleString()}회</strong><p>한 번에 최대 25곳만 검증하며, 응답 원문은 저장하지 않습니다.</p></div>
    <PlaceReviewToolbar query={query} page={page} />
    <Form method="post" className="place-review-batch-form">
      <input type="hidden" name="expectedStage" value={stageByStep[query.step]} />
      {selectedIds.map((id) => {
        const row = page.rows.find((item) => item.workItemId === id);
        return <span key={id}><input type="hidden" name="workItem" value={`${id}|${row?.stageVersion ?? 0}`} /><input type="hidden" name="workItemId" value={id} /></span>;
      })}
      <div className="place-review-selection-bar">
        <strong>{selectedIds.length} / 25 선택</strong><span>페이지를 바꾸면 선택은 해제됩니다.</span>
        <button type="button" className="secondary" onClick={selectPage}>현재 페이지 25곳 선택</button>
        <button type="button" className="secondary" onClick={() => setSelectedIds([])}>선택 해제</button>
      </div>
      <div className="place-review-grid">
        {page.rows.map((row) => <div key={row.workItemId} className="place-review-card-wrap"><PlaceReviewCard row={row} checked={selectedSet.has(row.workItemId)} onToggle={() => toggle(row.workItemId)} />
          {query.step === 3 && selectedSet.has(row.workItemId) && <label className="place-review-category-select">최종 카테고리<select name={`category:${row.workItemId}`} defaultValue={row.selectedCategoryId ?? ""}><option value="">카테고리 선택</option>{categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}</select></label>}
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
        <label>보류·제외 사유<input name="reason" maxLength={300} placeholder="보류 또는 제외 사유 입력" /></label>
        {query.step === 5 && <label className="place-review-publish-confirm"><span><input type="checkbox" name="confirmPublish" /> 선택한 장소만 공개하며, 이 동작은 되돌릴 수 있음을 확인합니다.</span></label>}
        <button className="secondary" name="intent" value="hold-review-items" disabled={!selectedIds.length}>선택 항목 보류</button>
        <button className="danger" name="intent" value="exclude-review-items" disabled={!selectedIds.length}>선택 항목 제외</button>
        {query.step === 4 && <button className="secondary" name="intent" value="resolve-review-duplicates" disabled={!selectedIds.length}>선택 중복 판정 저장</button>}
        <button name="intent" value={query.step === 5 ? "publish-review-items" : query.step === 2 ? "verify-review-items-with-naver" : query.step === 3 ? "confirm-review-categories" : "advance-review-items"} disabled={!selectedIds.length}>{query.step === 2 ? "선택 장소 NAVER 근거 확인" : query.step === 3 ? "선택 카테고리 확정" : nextAction[query.step]}</button>
      </div>
    </Form>
    <PlaceReviewToolbar query={query} page={page} />
    <AdminBlockingOverlay active={submitting} label={actionMessage} />
  </section>;
}
