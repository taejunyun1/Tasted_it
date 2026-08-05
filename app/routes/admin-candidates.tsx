import { env } from "cloudflare:workers";
import { asc, eq } from "drizzle-orm";
import { useEffect, useMemo, useState } from "react";
import { Form, Link, useNavigation, useSearchParams } from "react-router";

import type { Route } from "./+types/admin-candidates";
import { createDb } from "../db/client.server";
import { categories } from "../db/schema";
import { requireAdmin } from "../features/auth/session.server";
import { approveCandidateSelections, listBulkReviewGroups } from "../features/candidates/bulk-review.server";
import { reconcileCandidateSelection } from "../features/candidates/bulk-selection";
import { listCandidateSubtypes, rejectCandidate } from "../features/candidates/candidate.server";
import type { PublicDataSource, RegionCode } from "../features/candidates/public-data";

const sources: Array<[PublicDataSource, string]> = [
  ["GENERAL_RESTAURANT", "일반음식점"], ["REST_CAFE", "휴게음식점"],
  ["BAKERY", "제과점"], ["ENTERTAINMENT_BAR", "주점"],
];
const states = ["AUTO", "MANUAL", "BLOCKED"] as const;
const confidenceLabels = { HIGH: "높음", MEDIUM: "보통", LOW: "낮음", CONFLICT: "충돌" } as const;
const stateMeta = {
  AUTO: { label: "자동 승인", className: "border-emerald-700 bg-emerald-50 text-emerald-900" },
  MANUAL: { label: "수동 확인", className: "border-amber-600 bg-amber-50 text-amber-900" },
  BLOCKED: { label: "승인 불가", className: "border-rose-600 bg-rose-50 text-rose-900" },
} as const;

export async function loader({ request }: Route.LoaderArgs) {
  await requireAdmin(request);
  const url = new URL(request.url);
  const db = createDb(env.DB);
  const coordinates = url.searchParams.get("coordinates");
  const sort = url.searchParams.get("sort");
  const [groups, categoryRows, subtypes] = await Promise.all([
    listBulkReviewGroups(db, {
      query: url.searchParams.get("q") || undefined,
      sourceType: (url.searchParams.get("source") || undefined) as PublicDataSource | undefined,
      regionCode: (url.searchParams.get("region") || undefined) as RegionCode | undefined,
      businessSubtype: url.searchParams.get("subtype") || undefined,
      coordinates: coordinates === "present" || coordinates === "missing" ? coordinates : undefined,
      sort: sort === "updated" || sort === "name" || sort === "region" || sort === "source" ? sort : "source",
    }),
    db.select().from(categories).where(eq(categories.isActive, true)).orderBy(asc(categories.sortOrder)),
    listCandidateSubtypes(db),
  ]);
  const allRows = groups.flatMap((group) => group.candidates);
  const requestedState = url.searchParams.get("state");
  const categoryId = url.searchParams.get("category") ?? "";
  const confidence = url.searchParams.get("confidence") ?? "";
  const filteredRows = allRows.filter((row) =>
    (!states.includes(requestedState as (typeof states)[number]) || row.reviewState === requestedState)
    && (!categoryId || row.categoryId === categoryId)
    && (!confidence || row.confidence === confidence));
  const requestedSize = Number(url.searchParams.get("pageSize"));
  const pageSize = [25, 50, 100].includes(requestedSize) ? requestedSize : 25;
  const totalPages = Math.max(1, Math.ceil(filteredRows.length / pageSize));
  const page = Math.min(Math.max(1, Number(url.searchParams.get("page")) || 1), totalPages);
  return {
    rows: filteredRows.slice((page - 1) * pageSize, page * pageSize),
    counts: {
      ALL: allRows.length,
      AUTO: allRows.filter((row) => row.reviewState === "AUTO").length,
      MANUAL: allRows.filter((row) => row.reviewState === "MANUAL").length,
      BLOCKED: allRows.filter((row) => row.reviewState === "BLOCKED").length,
    },
    categories: categoryRows,
    subtypes,
    filters: Object.fromEntries(url.searchParams),
    pagination: { page, pageSize, total: filteredRows.length, totalPages },
  };
}

export async function action({ request }: Route.ActionArgs) {
  const user = await requireAdmin(request);
  const form = await request.formData();
  const candidateIds = [...new Set(form.getAll("candidateIds").map(String).filter(Boolean))];
  if (candidateIds.length > 25) throw new Response("한 번에 최대 25곳까지 처리할 수 있습니다.", { status: 400 });
  const db = createDb(env.DB);
  const now = new Date().toISOString();
  if (form.get("intent") === "rejectSelected") {
    const reason = String(form.get("reason") ?? "").trim();
    if (!reason) return { approved: [], skipped: [], rejected: 0, error: "반려 사유를 입력하세요." };
    await Promise.all(candidateIds.map((candidateId) => rejectCandidate(db, { candidateId, actorUserId: user.id, reason, now })));
    return { approved: [], skipped: [], rejected: candidateIds.length, error: null };
  }
  const result = await approveCandidateSelections(db, {
    selections: candidateIds.map((candidateId) => ({ candidateId, categoryId: String(form.get(`category:${candidateId}`) ?? "") })),
    actorUserId: user.id,
    now,
  });
  return { ...result, rejected: 0, error: null };
}

export default function AdminCandidates({ loaderData, actionData }: Route.ComponentProps) {
  const navigation = useNavigation();
  const [params] = useSearchParams();
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [chosenCategories, setChosenCategories] = useState<Record<string, string>>(() =>
    Object.fromEntries(loaderData.rows.map((row) => [row.id, row.categoryId ?? ""])));
  const parents = loaderData.categories.filter((category) => !category.parentId);
  const children = loaderData.categories.filter((category) => category.parentId);
  const isSubmitting = navigation.state === "submitting";
  const selectedRows = loaderData.rows.filter((row) => selected.has(row.id));
  const selectableIds = useMemo(() => loaderData.rows.filter((row) => row.reviewState !== "BLOCKED").map((row) => row.id), [loaderData.rows]);

  useEffect(() => {
    setSelected((current) => reconcileCandidateSelection(current, selectableIds));
  }, [selectableIds]);

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
    <main className="min-h-screen bg-[#f5f6f2] text-neutral-950">
      <header className="border-b border-neutral-300 bg-white">
        <div className="mx-auto flex max-w-[1500px] flex-col gap-6 px-5 py-8 md:flex-row md:items-end md:justify-between md:px-10">
          <div>
            <p className="font-mono text-[11px] font-medium tracking-[0.2em] text-emerald-800">ADMIN / PLACE REVIEW</p>
            <h1 className="mt-2 text-3xl font-semibold tracking-[-0.04em] md:text-5xl">장소 검수 목록</h1>
            <p className="mt-3 max-w-2xl text-sm leading-6 text-neutral-600">자동 분류 결과를 목록에서 확인하고, 애매한 후보만 카테고리를 직접 정합니다. 동네는 주소에서 자동 계산됩니다.</p>
          </div>
          <nav className="flex flex-wrap gap-2 text-sm font-medium">
            <Link className="border border-neutral-300 bg-white px-4 py-2.5 hover:border-neutral-900" to="/admin/places">공개 장소</Link>
            <Link className="border border-neutral-300 bg-white px-4 py-2.5 hover:border-neutral-900" to="/admin/data-sync">데이터 동기화</Link>
          </nav>
        </div>
      </header>

      <section className="mx-auto grid max-w-[1500px] grid-cols-2 border-x border-b border-neutral-300 bg-white md:grid-cols-4">
        <Summary label="전체 대기" value={loaderData.counts.ALL} />
        <Summary label="자동 승인" value={loaderData.counts.AUTO} tone="text-emerald-800" />
        <Summary label="수동 확인" value={loaderData.counts.MANUAL} tone="text-amber-700" />
        <Summary label="승인 불가" value={loaderData.counts.BLOCKED} tone="text-rose-700" />
      </section>

      <div className="mx-auto max-w-[1500px] px-5 py-7 md:px-10">
        <nav aria-label="검수 상태" className="mb-5 flex overflow-x-auto border-b border-neutral-900 text-sm font-medium">
          <Tab to={tabHref()} active={!params.get("state")} label="전체" count={loaderData.counts.ALL} />
          {states.map((state) => <Tab key={state} to={tabHref(state)} active={params.get("state") === state} label={stateMeta[state].label} count={loaderData.counts[state]} />)}
        </nav>

        <Form method="get" className="mb-6 grid gap-2 border border-neutral-300 bg-white p-4 md:grid-cols-4 xl:grid-cols-8">
          <Filter label="검색"><input name="q" defaultValue={loaderData.filters.q ?? ""} placeholder="상호명 또는 주소" /></Filter>
          <Filter label="지역"><select name="region" defaultValue={loaderData.filters.region ?? ""}><option value="">광주·전남 전체</option><option value="GWANGJU">광주</option><option value="JEONNAM">전남</option></select></Filter>
          <Filter label="공공데이터"><select name="source" defaultValue={loaderData.filters.source ?? ""}><option value="">전체</option>{sources.map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></Filter>
          <Filter label="원천 세부업태"><select name="subtype" defaultValue={loaderData.filters.subtype ?? ""}><option value="">전체</option>{loaderData.subtypes.map((value) => <option key={value}>{value}</option>)}</select></Filter>
          <Filter label="추천 카테고리"><select name="category" defaultValue={loaderData.filters.category ?? ""}><option value="">전체</option>{children.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}</select></Filter>
          <Filter label="신뢰도"><select name="confidence" defaultValue={loaderData.filters.confidence ?? ""}><option value="">전체</option>{Object.entries(confidenceLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></Filter>
          <Filter label="페이지 크기"><select name="pageSize" defaultValue={String(loaderData.pagination.pageSize)}><option>25</option><option>50</option><option>100</option></select></Filter>
          {params.get("state") && <input type="hidden" name="state" value={params.get("state")!} />}
          <div className="flex items-end gap-2"><button className="h-10 flex-1 whitespace-nowrap bg-neutral-950 px-3 text-xs font-semibold text-white">필터 적용</button><Link className="grid h-10 place-items-center whitespace-nowrap border border-neutral-300 px-3 text-xs" to="/admin/candidates">초기화</Link></div>
        </Form>

        {actionData && <div className={`mb-5 border px-4 py-3 text-sm ${actionData.error ? "border-rose-600 bg-rose-50" : "border-emerald-700 bg-emerald-50"}`}>{actionData.error ?? `${actionData.approved.length}곳 공개 · ${actionData.rejected}곳 반려 · ${actionData.skipped.length}곳 제외`}</div>}

        <Form method="post">
          {[...selected].map((id) => <input key={id} type="hidden" name="candidateIds" value={id} />)}
          {selectedRows.map((row) => <input key={`category-${row.id}`} type="hidden" name={`category:${row.id}`} value={chosenCategories[row.id] ?? ""} />)}
          <div className="sticky top-0 z-20 mb-3 flex flex-col gap-3 border border-neutral-900 bg-[#1f2a24] px-4 py-3 text-white shadow-sm md:flex-row md:items-center md:justify-between">
            <p className="text-sm"><span className="font-semibold">{selected.size} / 25</span> 선택 · 차단 후보는 선택할 수 없습니다.</p>
            <div className="flex flex-col gap-2 sm:flex-row">
              <input className="min-w-0 border border-neutral-500 bg-white px-3 py-2 text-sm text-neutral-950" name="reason" placeholder="일괄 반려 사유" />
              <button className="border border-white px-4 py-2 text-sm font-medium disabled:opacity-40" name="intent" value="rejectSelected" disabled={!selected.size || isSubmitting}>선택 반려</button>
              <button className="bg-[#d7f28a] px-4 py-2 text-sm font-semibold text-neutral-950 disabled:opacity-40" name="intent" value="approveSelected" disabled={!selected.size || isSubmitting}>{isSubmitting ? "처리 중…" : "선택 승인·공개"}</button>
            </div>
          </div>

          <section aria-label="검수 후보 목록" className="overflow-hidden border border-neutral-300 bg-white">
            <div className="hidden grid-cols-[42px_120px_minmax(210px,1fr)_minmax(260px,1.3fr)_220px_150px] border-b border-neutral-900 bg-neutral-100 px-4 py-3 text-[11px] font-semibold text-neutral-600 xl:grid">
              <span>선택</span><span>상태</span><span>장소</span><span>주소·동네</span><span>대표 카테고리</span><span>신뢰도</span>
            </div>
            {loaderData.rows.map((row) => {
              const blocked = row.reviewState === "BLOCKED";
              return <article key={row.id} className={`grid gap-4 border-b border-neutral-200 px-4 py-5 last:border-b-0 xl:grid-cols-[42px_120px_minmax(210px,1fr)_minmax(260px,1.3fr)_220px_150px] ${blocked ? "bg-neutral-50" : "bg-white"}`}>
                <div><input type="checkbox" aria-label={`${row.businessName} 선택`} checked={selected.has(row.id)} disabled={blocked} onChange={() => toggle(row.id)} className="h-5 w-5 accent-emerald-800" /></div>
                <div><span className={`inline-flex border-l-4 px-2 py-1 text-xs font-semibold ${stateMeta[row.reviewState].className}`}>{stateMeta[row.reviewState].label}</span></div>
                <div><p className="text-[11px] font-medium text-neutral-500">{sources.find(([id]) => id === row.sourceType)?.[1] ?? row.sourceType} · {row.regionCode === "GWANGJU" ? "광주" : "전남"}</p><h2 className="mt-1 text-lg font-semibold tracking-[-0.02em]">{row.businessName}</h2><p className="mt-1 text-xs text-neutral-500">{row.businessSubtype ?? "세부업태 미상"}</p></div>
                <div><p className="text-sm leading-6">{row.address || "주소 없음"}</p><p className="mt-1 font-mono text-[11px] text-neutral-500">{row.neighborhood ?? "동네 추출 실패"} · {row.latitude?.toFixed(5) ?? "—"}, {row.longitude?.toFixed(5) ?? "—"}</p>{row.blockers.length > 0 && <ul className="mt-2 flex flex-wrap gap-1">{row.blockers.map((blocker) => <li key={blocker} className="border border-rose-300 bg-rose-50 px-2 py-1 text-[11px] text-rose-800">{blocker}</li>)}</ul>}</div>
                <div>{row.reviewState === "MANUAL" ? <label className="grid gap-1 text-[11px] font-medium text-neutral-600"><span>{row.businessName} 대표 카테고리</span><select aria-label={`${row.businessName} 대표 카테고리`} value={chosenCategories[row.id] ?? ""} onChange={(event) => setChosenCategories((current) => ({ ...current, [row.id]: event.currentTarget.value }))} className="w-full border border-amber-500 bg-amber-50 px-2 py-2 text-sm text-neutral-950"><option value="">직접 선택</option>{parents.map((parent) => <optgroup key={parent.id} label={`${parent.emoji} ${parent.name}`}>{children.filter((child) => child.parentId === parent.id).map((child) => <option key={child.id} value={child.id}>{child.name}</option>)}</optgroup>)}</select></label> : <p className="text-sm font-medium">{loaderData.categories.find((category) => category.id === row.categoryId)?.name ?? "분류 없음"}</p>}</div>
                <div><span className={`inline-flex border px-2 py-1 text-xs font-medium ${row.confidence === "HIGH" ? "border-emerald-500 text-emerald-800" : row.confidence === "CONFLICT" ? "border-rose-500 text-rose-800" : "border-amber-500 text-amber-800"}`}>신뢰도 {confidenceLabels[row.confidence]}</span><details className="mt-2 text-xs text-neutral-600"><summary className="cursor-pointer font-medium">분류 근거</summary><ul className="mt-1 list-disc space-y-1 pl-4">{[...row.reasons, ...row.reviewReasons].map((reason) => <li key={reason}>{reason}</li>)}</ul></details></div>
              </article>;
            })}
            {!loaderData.rows.length && <p className="px-5 py-16 text-center text-sm text-neutral-500">현재 조건에 맞는 검수 후보가 없습니다.</p>}
          </section>
        </Form>

        <Pagination pagination={loaderData.pagination} params={params} />
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

function Pagination({ pagination, params }: { pagination: { page: number; pageSize: number; total: number; totalPages: number }; params: URLSearchParams }) {
  const href = (page: number) => { const next = new URLSearchParams(params); next.set("page", String(page)); return `?${next}`; };
  return <div className="mt-5 flex items-center justify-between text-sm"><p className="text-neutral-600">총 {pagination.total}곳 · {pagination.page}/{pagination.totalPages} 페이지</p><div className="flex gap-2"><Link aria-disabled={pagination.page === 1} className={`border border-neutral-300 bg-white px-4 py-2 ${pagination.page === 1 ? "pointer-events-none opacity-40" : ""}`} to={href(Math.max(1, pagination.page - 1))}>이전</Link><Link aria-disabled={pagination.page === pagination.totalPages} className={`border border-neutral-300 bg-white px-4 py-2 ${pagination.page === pagination.totalPages ? "pointer-events-none opacity-40" : ""}`} to={href(Math.min(pagination.totalPages, pagination.page + 1))}>다음</Link></div></div>;
}
