import { useEffect, useMemo, useState } from "react";
import { Form, Link, useNavigation } from "react-router";

import type { ReviewStage } from "../../features/places/place-review-pipeline";
import type { PlaceReviewQuery } from "../../features/places/place-review-pagination";
import type { PlaceReviewPage, PlaceReviewStageCounts } from "../../features/places/place-review-query.server";
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

export function PlaceReviewPipeline({ query, page, counts, naverDailyUsage, naverDailyLimit, message, error }: {
  query: PlaceReviewQuery;
  page: PlaceReviewPage;
  counts: PlaceReviewStageCounts;
  naverDailyUsage: number;
  naverDailyLimit: number;
  message?: string;
  error?: string;
}) {
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const navigation = useNavigation();
  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds]);
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
      <Link className="secondary" to="/admin/place-operations?flow=operations&tab=liveness">공개 후 운영</Link>
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
        {page.rows.map((row) => <PlaceReviewCard key={row.workItemId} row={row} checked={selectedSet.has(row.workItemId)} onToggle={() => toggle(row.workItemId)} />)}
      </div>
      {!page.rows.length && <p className="place-review-empty">이 조건에 해당하는 검수 항목이 없습니다.</p>}
      <div className="place-review-actions">
        <label>보류·제외 사유<input name="reason" maxLength={300} placeholder="보류 또는 제외 사유 입력" /></label>
        <button className="secondary" name="intent" value="hold-review-items" disabled={!selectedIds.length}>선택 항목 보류</button>
        <button className="danger" name="intent" value="exclude-review-items" disabled={!selectedIds.length}>선택 항목 제외</button>
        <button name="intent" value={query.step === 2 ? "verify-review-items-with-naver" : "advance-review-items"} disabled={!selectedIds.length || query.step === 5}>{query.step === 2 ? "선택 장소 NAVER 근거 확인" : nextAction[query.step]}</button>
      </div>
    </Form>
    <PlaceReviewToolbar query={query} page={page} />
    <AdminBlockingOverlay active={submitting} label={actionMessage} />
  </section>;
}
