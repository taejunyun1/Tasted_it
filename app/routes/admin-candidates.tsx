import { env } from "cloudflare:workers";
import { asc, eq } from "drizzle-orm";
import { useEffect, useMemo, useState } from "react";
import { Form, Link, useFetcher, useNavigation, useSearchParams } from "react-router";

import type { Route } from "./+types/admin-candidates";
import { createDb } from "../db/client.server";
import { categories } from "../db/schema";
import { requireAdmin } from "../features/auth/session.server";
import { approveCandidateSelections, listBulkReviewGroups } from "../features/candidates/bulk-review.server";
import { reconcileCandidateSelection, selectCurrentPageCandidates } from "../features/candidates/bulk-selection";
import { excludeCandidates, listCandidateSubtypes, listExcludedCandidates, restoreExcludedCandidate } from "../features/candidates/candidate.server";
import type { PublicDataSource, RegionCode } from "../features/candidates/public-data";
import { assertNaverLocalSearchEnabled, createNaverLocalSearchAdapter } from "../features/candidates/naver-local-search.server";
import { verifyPendingCandidatesWithNaver } from "../features/candidates/naver-pending-candidate-verification.server";
import { CandidateEvidenceChain, EvidenceStatusRail } from "../features/candidates/candidate-evidence-ui";
import { listSelectableCategories, setCandidateCategory } from "../features/candidates/category-selection";
import { buildCandidatePageHref } from "../features/candidates/pagination";

const sources: Array<[PublicDataSource, string]> = [
  ["GENERAL_RESTAURANT", "일반음식점"], ["REST_CAFE", "휴게음식점"],
  ["BAKERY", "제과점"], ["ENTERTAINMENT_BAR", "주점"],
];
const states = ["AUTO", "MANUAL"] as const;
const confidenceLabels = { HIGH: "높음", MEDIUM: "보통", LOW: "낮음", CONFLICT: "충돌" } as const;
const stateMeta = {
  AUTO: { label: "분류 완료", className: "border-emerald-700 bg-emerald-50 text-emerald-900" },
  MANUAL: { label: "수동 확인", className: "border-amber-600 bg-amber-50 text-amber-900" },
  BLOCKED: { label: "승인 불가", className: "border-rose-600 bg-rose-50 text-rose-900" },
} as const;
const automaticExclusionLabels: Record<string, string> = {
  CHAIN_STORE: "체인점 자동 제외",
  ADULT_ENTERTAINMENT: "유흥업종 자동 제외",
  NOT_RESTAURANT: "비음식 시설 자동 제외",
};

function exclusionLabel(reason: string) {
  return automaticExclusionLabels[reason] ?? "관리자 예외 처리";
}

export async function loader({ request }: Route.LoaderArgs) {
  await requireAdmin(request);
  const url = new URL(request.url);
  const db = createDb(env.DB);
  const coordinates = url.searchParams.get("coordinates");
  const sort = url.searchParams.get("sort");
  const now = new Date().toISOString();
  const filters = {
    query: url.searchParams.get("q") || undefined,
    sourceType: (url.searchParams.get("source") || undefined) as PublicDataSource | undefined,
    regionCode: (url.searchParams.get("region") || undefined) as RegionCode | undefined,
    businessSubtype: url.searchParams.get("subtype") || undefined,
    coordinates: coordinates === "present" || coordinates === "missing" ? coordinates : undefined,
    sort: sort === "updated" || sort === "name" || sort === "region" || sort === "source" ? sort : "source",
  } as const;
  const [groups, categoryRows, subtypes, excludedRows] = await Promise.all([
    listBulkReviewGroups(db, filters),
    db.select().from(categories).where(eq(categories.isActive, true)).orderBy(asc(categories.sortOrder)),
    listCandidateSubtypes(db),
    listExcludedCandidates(db, filters),
  ]);
  const allRows = groups.flatMap((group) => group.candidates);
  const requestedState = url.searchParams.get("state");
  const categoryId = url.searchParams.get("category") ?? "";
  const confidence = url.searchParams.get("confidence") ?? "";
  const blockedRows = allRows.filter((row) => row.reviewState === "BLOCKED")
    .map((row) => ({ ...row, isExcluded: false as const, exclusionReason: null, chainName: null, matchedTerm: null, excludedAt: null }));
  const reviewableRows = allRows.filter((row) => row.reviewState !== "BLOCKED");
  const filteredRows = reviewableRows.filter((row) =>
    (!states.includes(requestedState as (typeof states)[number]) || row.reviewState === requestedState)
    && (!categoryId || row.categoryId === categoryId)
    && (!confidence || row.confidence === confidence))
    .map((row) => ({ ...row, isExcluded: false as const, exclusionReason: null, chainName: null, matchedTerm: null, excludedAt: null }));
  const excludedReviewRows = excludedRows.map((row) => ({
    ...row,
    address: row.roadAddress ?? row.lotAddress ?? "",
    categoryId: null,
    categorySlug: "",
    confidence: "LOW" as const,
    neighborhood: null,
    reasons: row.exclusionReason === "CHAIN_STORE"
      ? [`${row.chainName} 체인명과 일치`]
      : [exclusionLabel(row.exclusionReason)],
    classificationSource: "RULE_ONLY" as const,
    naverEvidence: { status: null, evidenceCodes: [], confidenceScore: null, failureCode: null },
    blockers: [],
    reviewReasons: [exclusionLabel(row.exclusionReason)],
    reviewState: "BLOCKED" as const,
    eligible: false,
    isExcluded: true as const,
  }));
  const automaticExclusionRows = excludedReviewRows.filter((row) => row.exclusionReason !== "ADMIN_EXCEPTION");
  const exceptionRows = excludedReviewRows.filter((row) => row.exclusionReason === "ADMIN_EXCEPTION");
  const displayedRows = requestedState === "EXCLUDED"
    ? automaticExclusionRows
    : requestedState === "EXCEPTION"
      ? [...exceptionRows, ...blockedRows]
      : filteredRows;
  const requestedSize = Number(url.searchParams.get("pageSize"));
  const pageSize = [25, 50, 100].includes(requestedSize) ? requestedSize : 25;
  const totalPages = Math.max(1, Math.ceil(displayedRows.length / pageSize));
  const page = Math.min(Math.max(1, Number(url.searchParams.get("page")) || 1), totalPages);
  return {
    rows: displayedRows.slice((page - 1) * pageSize, page * pageSize),
    counts: {
      ALL: reviewableRows.length,
      AUTO: reviewableRows.filter((row) => row.reviewState === "AUTO").length,
      MANUAL: reviewableRows.filter((row) => row.reviewState === "MANUAL").length,
      EXCEPTION: blockedRows.length + exceptionRows.length,
      EXCLUDED: automaticExclusionRows.length,
    },
    categories: categoryRows,
    subtypes,
    filters: Object.fromEntries(url.searchParams),
    pagination: { page, pageSize, total: displayedRows.length, totalPages },
  };
}

export async function action({ request }: Route.ActionArgs) {
  const user = await requireAdmin(request);
  const form = await request.formData();
  const restoreCandidateId = String(form.get("restoreCandidateId") ?? "");
  const candidateIds = [...new Set(form.getAll("candidateIds").map(String).filter(Boolean))];
  if (candidateIds.length > 25) throw new Response("한 번에 최대 25곳까지 처리할 수 있습니다.", { status: 400 });
  const db = createDb(env.DB);
  const now = new Date().toISOString();
  const intent = String(form.get("intent") ?? "");
  if (intent === "verifyNaverSelected") {
    try {
      assertNaverLocalSearchEnabled(env);
      const adapter = createNaverLocalSearchAdapter(env);
      const result = await verifyPendingCandidatesWithNaver(db, {
        candidateIds,
        limit: 25,
        now,
        adapter,
        dailyLimit: Number(env.NAVER_LOCAL_SEARCH_DAILY_LIMIT ?? 200),
        actorUserId: user.id,
      });
      return { approved: [], skipped: [], rejected: 0, error: null, naverVerification: result };
    } catch (error) {
      const detail = error instanceof Error ? error.message : "UNKNOWN_ERROR";
      const message = detail === "NAVER_LOCAL_SEARCH_DISABLED"
        ? "NAVER 지역검색이 아직 비활성화되어 있습니다. 운영 설정을 확인해 주세요."
        : detail === "NAVER_LOCAL_SEARCH_QUOTA"
          ? "NAVER 지역검색 일일 한도에 도달했습니다. 내일 다시 시도해 주세요."
          : "NAVER 지도 검증을 완료하지 못했습니다. 잠시 후 다시 시도해 주세요.";
      return { approved: [], skipped: [], rejected: 0, error: `${message} (${detail})`, naverVerification: null };
    }
  }
  if (restoreCandidateId) {
    await restoreExcludedCandidate(db, { candidateId: restoreCandidateId, actorUserId: user.id, now });
    return { approved: [], skipped: [], rejected: 0, error: null, restored: 1, naverVerification: null };
  }
  if (intent === "excludeSelected") {
    try {
      const result = await excludeCandidates(db, {
        candidateIds,
        category: String(form.get("exclusionCategory") ?? ""),
        note: String(form.get("exclusionNote") ?? ""),
        actorUserId: user.id,
        now,
      });
      return { approved: [], skipped: [], rejected: 0, error: null, excluded: result.excludedIds.length, naverVerification: null };
    } catch (error) {
      const message = error instanceof Error ? error.message : "UNKNOWN_ERROR";
      const errorMessage = message === "EXCLUSION_NOTE_REQUIRED" ? "기타 사유는 메모를 입력해 주세요."
        : message === "EXCLUSION_CATEGORY_INVALID" ? "예외 사유를 선택해 주세요."
          : message === "CANDIDATE_SELECTION_REQUIRED" ? "예외 처리할 장소를 선택해 주세요."
            : "예외 처리 중 오류가 발생했습니다.";
      return { approved: [], skipped: [], rejected: 0, error: errorMessage, excluded: 0, naverVerification: null };
    }
  }
  const result = await approveCandidateSelections(db, {
    selections: candidateIds.map((candidateId) => ({ candidateId, categoryId: String(form.get(`category:${candidateId}`) ?? "") })),
    actorUserId: user.id,
    now,
  });
  return { ...result, rejected: 0, error: null, naverVerification: null };
}

export default function AdminCandidates({ loaderData, actionData }: Route.ComponentProps) {
  const navigation = useNavigation();
  const naverVerification = useFetcher<typeof action>();
  const [params] = useSearchParams();
  const excludedMode = params.get("state") === "EXCLUDED";
  const exceptionMode = params.get("state") === "EXCEPTION";
  const reviewMode = !excludedMode && !exceptionMode;
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [chosenCategories, setChosenCategories] = useState<Record<string, string>>(() =>
    Object.fromEntries(loaderData.rows.map((row) => [row.id, row.categoryId ?? ""])));
  const parents = loaderData.categories.filter((category) => !category.parentId);
  const children = loaderData.categories.filter((category) => category.parentId);
  const selectableCategories = listSelectableCategories(loaderData.categories);
  const leafParents = selectableCategories.filter((category) => !category.parentId);
  const isSubmitting = navigation.state === "submitting";
  const selectedRows = loaderData.rows.filter((row) => selected.has(row.id));
  const selectableIds = useMemo(() => loaderData.rows.filter((row) => !row.isExcluded && row.reviewState !== "BLOCKED").map((row) => row.id), [loaderData.rows]);
  const pageSelectionIds = selectableIds.slice(0, 25);
  const pageSelected = pageSelectionIds.length > 0 && pageSelectionIds.every((id) => selected.has(id));

  useEffect(() => {
    setSelected((current) => reconcileCandidateSelection(current, selectableIds));
  }, [selectableIds]);

  useEffect(() => {
    setChosenCategories(Object.fromEntries(loaderData.rows.map((row) => [row.id, row.categoryId ?? ""])));
  }, [loaderData.rows]);

  function toggle(id: string) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else if (next.size < 25) next.add(id);
      return next;
    });
  }

  function tabHref(state?: string) {
    const next = new URLSearchParams(params);
    next.delete("page");
    if (state) next.set("state", state); else next.delete("state");
    return `/admin/candidates${next.size ? `?${next}` : ""}`;
  }

  return (
    <main className="admin-page candidate-workbench">
      <header className="candidate-workbench__header">
        <div className="admin-page-frame">
          <div>
            <p className="candidate-eyebrow">ADMIN / EVIDENCE WORKBENCH</p>
            <h1 className="text-[21px] md:text-[33.6px]">장소 검수</h1>
            <p>공공데이터 후보를 NAVER 상호·위치·카테고리 근거와 함께 확인합니다. 자동 변경은 상호·위치·상세 카테고리·원천 업태가 모두 일치할 때만 허용됩니다.</p>
          </div>
        </div>
      </header>

      <section className="admin-page-frame candidate-workbench__summary">
        <Summary label="전체 대기" value={loaderData.counts.ALL} />
        <Summary label="분류 완료" value={loaderData.counts.AUTO} tone="text-emerald-800" />
        <Summary label="수동 확인" value={loaderData.counts.MANUAL} tone="text-amber-700" />
        <Summary label="승인 불가·예외" value={loaderData.counts.EXCEPTION} tone="text-rose-700" />
        <Summary label="자동 제외" value={loaderData.counts.EXCLUDED} tone="text-violet-700" />
      </section>

      <div className="admin-page-frame candidate-workbench__body">
        <nav aria-label="검수 상태" className="mb-5 flex overflow-x-auto border-b border-neutral-900 text-sm font-medium">
          <Tab to={tabHref()} active={!params.get("state")} label="전체" count={loaderData.counts.ALL} />
          {states.map((state) => <Tab key={state} to={tabHref(state)} active={params.get("state") === state} label={stateMeta[state].label} count={loaderData.counts[state]} />)}
          <Tab to={tabHref("EXCEPTION")} active={exceptionMode} label="승인 불가·예외" count={loaderData.counts.EXCEPTION} />
          <Tab to={tabHref("EXCLUDED")} active={excludedMode} label="자동 제외" count={loaderData.counts.EXCLUDED} />
        </nav>

        {reviewMode && <EvidenceStatusRail rows={loaderData.rows} />}

        <Form method="get" className="candidate-filter-panel">
          <Filter label="검색"><input name="q" defaultValue={loaderData.filters.q ?? ""} placeholder="상호명 또는 주소" /></Filter>
          <Filter label="지역"><select name="region" defaultValue={loaderData.filters.region ?? ""}><option value="">광주·전남 전체</option><option value="GWANGJU">광주</option><option value="JEONNAM">전남</option></select></Filter>
          <Filter label="공공데이터"><select name="source" defaultValue={loaderData.filters.source ?? ""}><option value="">전체</option>{sources.map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></Filter>
          <details className="candidate-filter-panel__details"><summary>상세 필터</summary><div>
            <Filter label="원천 세부업태"><select name="subtype" defaultValue={loaderData.filters.subtype ?? ""}><option value="">전체</option>{loaderData.subtypes.map((value) => <option key={value}>{value}</option>)}</select></Filter>
            {reviewMode && <Filter label="추천 카테고리"><select name="category" defaultValue={loaderData.filters.category ?? ""}><option value="">전체</option>{selectableCategories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}</select></Filter>}
            {reviewMode && <Filter label="신뢰도"><select name="confidence" defaultValue={loaderData.filters.confidence ?? ""}><option value="">전체</option>{Object.entries(confidenceLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></Filter>}
            <Filter label="페이지 크기"><select name="pageSize" defaultValue={String(loaderData.pagination.pageSize)}><option>25</option><option>50</option><option>100</option></select></Filter>
          </div></details>
          {params.get("state") && <input type="hidden" name="state" value={params.get("state")!} />}
          <div className="flex items-end gap-2"><button className="h-10 flex-1 whitespace-nowrap bg-neutral-950 px-3 text-xs font-semibold text-white">필터 적용</button><Link className="grid h-10 place-items-center whitespace-nowrap border border-neutral-300 px-3 text-xs" to="/admin/candidates">초기화</Link></div>
        </Form>

        {(() => {
          const feedback = actionData;
          return feedback && <div className={`candidate-workbench__notice ${feedback.error || feedback.skipped.length ? "is-warning" : ""}`}>
            <p>{feedback.error ?? (feedback.naverVerification ? `NAVER 근거 확인 ${feedback.naverVerification.scanned}곳 · 검증 ${feedback.naverVerification.verified}곳 · 자동 분류 ${feedback.naverVerification.automatic}곳 · 수동 확인 ${feedback.naverVerification.manual}곳` : "restored" in feedback && feedback.restored ? "검수 대기로 복원했습니다." : "excluded" in feedback && feedback.excluded ? `${feedback.excluded}곳을 승인 불가·예외로 이동했습니다.` : `${feedback.approved.length}곳 승인·공개 · ${feedback.skipped.length}곳 확인 필요`)}</p>
            {feedback.skipped.length > 0 && <ul className="mt-2 list-disc space-y-1 pl-5 text-xs">{feedback.skipped.map((item) => <li key={item.candidateId}><strong>{loaderData.rows.find((row) => row.id === item.candidateId)?.businessName ?? item.candidateId}</strong> · {item.reason}</li>)}</ul>}
          </div>;
        })()}
        {naverVerification.data && <div className={`candidate-workbench__notice ${naverVerification.data.error ? "is-warning" : ""}`}>
          <p>{naverVerification.data.error ?? (naverVerification.data.naverVerification ? `NAVER 근거 확인 ${naverVerification.data.naverVerification.scanned}곳 · 검증 ${naverVerification.data.naverVerification.verified}곳 · 자동 분류 ${naverVerification.data.naverVerification.automatic}곳 · 수동 확인 ${naverVerification.data.naverVerification.manual}곳` : "NAVER 근거 확인을 마쳤습니다.")}</p>
        </div>}

        <Pagination pagination={loaderData.pagination} params={params} position="top" />

        <Form method="post">
          {[...selected].map((id) => <input key={id} type="hidden" name="candidateIds" value={id} />)}
          {selectedRows.map((row) => <input key={`category-${row.id}`} type="hidden" name={`category:${row.id}`} value={chosenCategories[row.id] ?? ""} />)}
          {reviewMode && <div className="candidate-selection-workbench">
            <div className="flex flex-wrap items-center gap-3"><p className="text-sm"><span className="font-semibold">{selected.size} / 25</span> 선택 · 차단 후보 제외</p><button type="button" className="border border-neutral-500 px-3 py-2 text-xs text-neutral-200" onClick={() => setSelected(pageSelected ? new Set() : selectCurrentPageCandidates(selectableIds))}>{pageSelected ? "현재 페이지 선택 해제" : "현재 페이지 선택"}</button></div>
            <div className="grid gap-2 sm:grid-cols-[160px_220px_auto]">
              <label className="grid gap-1 text-[10px] text-neutral-200"><span>예외 사유</span><select aria-label="예외 사유" name="exclusionCategory" defaultValue="" className="h-9 bg-white px-2 text-xs text-neutral-950"><option value="">사유 선택</option><option value="BUSINESS_TYPE">업종 제외</option><option value="NOT_RESTAURANT">음식점 아님</option><option value="BAD_OR_DUPLICATE_DATA">중복·잘못된 데이터</option><option value="POLICY">운영 정책 제외</option><option value="OTHER">기타</option></select></label>
              <label className="grid gap-1 text-[10px] text-neutral-200"><span>예외 메모</span><input aria-label="예외 메모" name="exclusionNote" placeholder="기타 선택 시 필수" className="h-9 bg-white px-2 text-xs text-neutral-950" /></label>
              <button className="self-end border border-rose-200 bg-rose-50 px-4 py-2 text-sm font-semibold text-rose-900 disabled:opacity-40" name="intent" value="excludeSelected" disabled={!selected.size || isSubmitting}>선택 장소 예외 처리</button>
            </div>
            <div className="flex flex-col gap-2 sm:flex-row">
              <button type="button" className="border border-white px-4 py-2 text-sm font-semibold text-white disabled:opacity-40" onClick={() => { const data = new FormData(); data.set("intent", "verifyNaverSelected"); for (const candidateId of selected) data.append("candidateIds", candidateId); void naverVerification.submit(data, { method: "post" }); }} disabled={!selected.size || naverVerification.state !== "idle"}>{naverVerification.state === "submitting" ? "근거 확인 중…" : "선택 장소 NAVER 근거 확인"}</button>
              <button className="bg-[#d7f28a] px-4 py-2 text-sm font-semibold text-neutral-950 disabled:opacity-40" name="intent" value="approveSelected" disabled={!selected.size || isSubmitting}>{isSubmitting ? "처리 중…" : "선택 장소 승인·공개"}</button>
            </div>
          </div>}

          <section aria-label="검수 후보 목록" className="overflow-hidden border border-neutral-300 bg-white">
            <div className={`hidden border-b border-neutral-900 bg-neutral-100 px-4 py-3 text-[11px] font-semibold text-neutral-600 xl:grid ${excludedMode || exceptionMode ? "grid-cols-[150px_minmax(220px,1fr)_minmax(260px,1.3fr)_200px_160px]" : "grid-cols-[42px_120px_minmax(210px,1fr)_minmax(260px,1.3fr)_220px_150px]"}`}>
              {excludedMode || exceptionMode ? <><span>제외 상태</span><span>장소</span><span>주소</span><span>제외 근거</span><span>관리</span></> : <><span>선택</span><span>상태</span><span>장소</span><span>주소·동네</span><span>대표 카테고리</span><span>신뢰도</span></>}
            </div>
            {loaderData.rows.map((row) => {
              if (row.isExcluded) return <article key={row.id} className="grid gap-3 border-b border-neutral-200 bg-violet-50/30 px-4 py-4 last:border-b-0 xl:grid-cols-[150px_minmax(220px,1fr)_minmax(260px,1.3fr)_200px_160px]">
                <div><span className="inline-flex rounded-full border border-violet-500 bg-violet-50 px-3 py-1 text-xs font-semibold text-violet-800">{exclusionLabel(row.exclusionReason)}</span></div>
                <div><p className="text-[10px] font-medium text-neutral-500">{sources.find(([id]) => id === row.sourceType)?.[1] ?? row.sourceType} · {row.regionCode === "GWANGJU" ? "광주" : "전남"}</p><h2 className="mt-1 text-base font-semibold tracking-[-0.02em]">{row.businessName}</h2><p className="mt-0.5 text-[11px] text-neutral-500">{row.businessSubtype ?? "세부업태 미상"}</p></div>
                <div><p className="text-sm leading-6">{row.address || "주소 없음"}</p><p className="mt-1 font-mono text-[11px] text-neutral-500">제외일 {row.excludedAt.slice(0, 10)}</p></div>
                <div><p className="font-semibold text-violet-900">{row.exclusionReason === "CHAIN_STORE" ? row.chainName : row.exclusionReason === "ADULT_ENTERTAINMENT" ? "유흥업종 제외" : row.exclusionReason === "NOT_RESTAURANT" ? "비음식 시설 제외" : ({ BUSINESS_TYPE: "업종 제외", NOT_RESTAURANT: "음식점 아님", BAD_OR_DUPLICATE_DATA: "중복·잘못된 데이터", POLICY: "운영 정책 제외", OTHER: "기타" } as const)[row.exclusionCategory as "BUSINESS_TYPE" | "NOT_RESTAURANT" | "BAD_OR_DUPLICATE_DATA" | "POLICY" | "OTHER"]}</p><p className="mt-1 text-xs text-neutral-600">{row.exclusionReason === "CHAIN_STORE" ? `일치 표현: ${row.matchedTerm}` : row.note ?? row.matchedRule}</p></div>
                <div><button aria-label={`${row.businessName} 검수 대기로 복원`} name="restoreCandidateId" value={row.id} className="border border-neutral-900 bg-white px-3 py-2 text-xs font-semibold">검수 대기로 복원</button></div>
              </article>;
              const blocked = row.reviewState === "BLOCKED";
              return <article key={row.id} className={`grid gap-3 border-b border-neutral-200 px-4 py-3 last:border-b-0 xl:grid-cols-[42px_110px_minmax(200px,1fr)_minmax(250px,1.3fr)_210px_140px] ${blocked ? "bg-neutral-50" : "bg-white"}`}>
                <div><input type="checkbox" aria-label={`${row.businessName} 선택`} checked={selected.has(row.id)} disabled={blocked} onChange={() => toggle(row.id)} className="h-5 w-5 accent-emerald-800" /></div>
                <div><span className={`inline-flex border-l-4 px-2 py-1 text-xs font-semibold ${stateMeta[row.reviewState].className}`}>{stateMeta[row.reviewState].label}</span></div>
                <div><p className="text-[10px] font-medium text-neutral-500">{sources.find(([id]) => id === row.sourceType)?.[1] ?? row.sourceType} · {row.regionCode === "GWANGJU" ? "광주" : "전남"}</p><h2 className="mt-1 text-base font-semibold tracking-[-0.02em]">{row.businessName}</h2><p className="mt-0.5 text-[11px] text-neutral-500">{row.businessSubtype ?? "세부업태 미상"}</p></div>
                <div><p className="text-sm leading-6">{row.address || "주소 없음"}</p><p className="mt-1 font-mono text-[11px] text-neutral-500">{row.neighborhood ?? "동네 추출 실패"} · {row.latitude?.toFixed(5) ?? "—"}, {row.longitude?.toFixed(5) ?? "—"}</p>{row.blockers.length > 0 && <ul className="mt-2 flex flex-wrap gap-1">{row.blockers.map((blocker) => <li key={blocker} className="border border-rose-300 bg-rose-50 px-2 py-1 text-[11px] text-rose-800">{blocker}</li>)}</ul>}</div>
                <div>{!blocked ? <label className="grid gap-1 text-[10px] font-medium text-neutral-600"><span>{row.reviewState === "AUTO" ? "자동 추천" : "추천"} · {loaderData.categories.find((category) => category.id === row.categoryId)?.name ?? "분류 없음"}</span><select aria-label={`${row.businessName} 대표 카테고리`} value={chosenCategories[row.id] ?? ""} onChange={(event) => { const categoryId = event.currentTarget.value; setChosenCategories((current) => setCandidateCategory(current, row.id, categoryId)); }} className={`w-full border px-2 py-1.5 text-xs text-neutral-950 ${row.reviewState === "AUTO" ? "border-emerald-500 bg-emerald-50" : "border-amber-500 bg-amber-50"}`}><option value="">직접 선택</option>{leafParents.map((category) => <option key={category.id} value={category.id}>{category.emoji} {category.name}</option>)}{parents.filter((parent) => children.some((child) => child.parentId === parent.id)).map((parent) => <optgroup key={parent.id} label={`${parent.emoji} ${parent.name}`}>{children.filter((child) => child.parentId === parent.id).map((child) => <option key={child.id} value={child.id}>{child.name}</option>)}</optgroup>)}</select></label> : <p className="text-sm font-medium">{loaderData.categories.find((category) => category.id === row.categoryId)?.name ?? "분류 없음"}</p>}</div>
                <div><span className={`inline-flex border px-2 py-1 text-xs font-medium ${row.confidence === "HIGH" ? "border-emerald-500 text-emerald-800" : row.confidence === "CONFLICT" ? "border-rose-500 text-rose-800" : "border-amber-500 text-amber-800"}`}>신뢰도 {confidenceLabels[row.confidence]}</span><p className="mt-2 font-mono text-[10px] text-neutral-500">{row.classificationSource}</p><CandidateEvidenceChain row={row} /><details className="mt-2 text-xs text-neutral-600"><summary className="cursor-pointer font-medium">분류 근거</summary><ul className="mt-1 list-disc space-y-1 pl-4">{[...row.reasons, ...row.reviewReasons].map((reason, index) => <li key={`${index}-${reason}`}>{reason}</li>)}</ul></details></div>
              </article>;
            })}
            {!loaderData.rows.length && <p className="px-5 py-16 text-center text-sm text-neutral-500">현재 조건에 맞는 검수 후보가 없습니다.</p>}
          </section>
        </Form>

        <Pagination pagination={loaderData.pagination} params={params} position="bottom" />
      </div>
    </main>
  );
}

function Summary({ label, value, tone = "text-neutral-950" }: { label: string; value: number; tone?: string }) {
  return <div className="border-r border-neutral-300 px-5 py-5 last:border-r-0"><p className="text-xs font-medium text-neutral-500">{label}</p><strong className={`mt-1 block font-mono text-3xl font-semibold ${tone}`}>{value}</strong></div>;
}

function Tab({ to, active, label, count }: { to: string; active: boolean; label: string; count: number }) {
  return <Link to={to} aria-current={active ? "page" : undefined} style={active ? { color: "white" } : undefined} className={`shrink-0 border-x border-t border-neutral-900 px-4 py-3 ${active ? "bg-neutral-950" : "bg-white"}`}>{label} <span className="ml-1 font-mono text-xs">{count}</span></Link>;
}

function Filter({ label, children }: { label: string; children: React.ReactElement }) {
  return <label className="grid gap-1 text-[11px] font-medium text-neutral-600"><span>{label}</span><span className="[&>*]:h-10 [&>*]:w-full [&>*]:border [&>*]:border-neutral-300 [&>*]:bg-white [&>*]:px-3 [&>*]:text-sm [&>*]:text-neutral-950">{children}</span></label>;
}

function Pagination({ pagination, params, position }: { pagination: { page: number; pageSize: number; total: number; totalPages: number }; params: URLSearchParams; position: "top" | "bottom" }) {
  return <nav aria-label={`${position === "top" ? "상단" : "하단"} 페이지 이동`} className={`${position === "top" ? "mb-3" : "mt-5"} flex items-center justify-between border border-neutral-300 bg-white px-4 py-3 text-sm`}><p className="text-neutral-600">총 {pagination.total}곳 · <strong className="font-medium text-neutral-950">{pagination.page}/{pagination.totalPages} 페이지</strong></p><div className="flex gap-2"><Link aria-disabled={pagination.page === 1} className={`border border-neutral-300 bg-white px-4 py-2 ${pagination.page === 1 ? "pointer-events-none opacity-40" : ""}`} to={buildCandidatePageHref(params, Math.max(1, pagination.page - 1))}>이전</Link><Link aria-disabled={pagination.page === pagination.totalPages} className={`border border-neutral-900 bg-neutral-950 px-4 py-2 text-white ${pagination.page === pagination.totalPages ? "pointer-events-none opacity-40" : ""}`} to={buildCandidatePageHref(params, Math.min(pagination.totalPages, pagination.page + 1))}>다음</Link></div></nav>;
}
