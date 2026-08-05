import { env } from "cloudflare:workers";
import { useMemo, useState } from "react";
import { Form, Link, useNavigation } from "react-router";

import type { Route } from "./+types/admin-candidates-bulk";
import { createDb } from "../db/client.server";
import { requireAdmin } from "../features/auth/session.server";
import {
  bulkApproveCandidates,
  listBulkReviewGroups,
} from "../features/candidates/bulk-review.server";

const confidenceLabels = {
  HIGH: "높음",
  MEDIUM: "보통",
  LOW: "낮음",
  CONFLICT: "충돌",
} as const;

export async function loader({ request }: Route.LoaderArgs) {
  await requireAdmin(request);
  return { groups: await listBulkReviewGroups(createDb(env.DB)) };
}

export async function action({ request }: Route.ActionArgs) {
  const user = await requireAdmin(request);
  const form = await request.formData();
  return bulkApproveCandidates(createDb(env.DB), {
    candidateIds: form.getAll("candidateIds").map(String),
    actorUserId: user.id,
    now: new Date().toISOString(),
  });
}

export default function AdminCandidatesBulk({ loaderData, actionData }: Route.ComponentProps) {
  const eligibleIds = useMemo(() => loaderData.groups.flatMap((group) => group.candidates.filter((candidate) => candidate.eligible).map((candidate) => candidate.id)), [loaderData.groups]);
  const [selected, setSelected] = useState(() => new Set(eligibleIds.slice(0, 25)));
  const navigation = useNavigation();
  const isSubmitting = navigation.state === "submitting";
  const needsReview = loaderData.groups.reduce((total, group) => total + group.candidates.filter((candidate) => !candidate.eligible).length, 0);

  function toggleCandidate(id: string) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else if (next.size < 25) next.add(id);
      return next;
    });
  }

  function toggleGroup(ids: string[]) {
    setSelected((current) => {
      const next = new Set(current);
      const allSelected = ids.every((id) => next.has(id));
      if (allSelected) ids.forEach((id) => next.delete(id));
      else ids.forEach((id) => { if (next.size < 25) next.add(id); });
      return next;
    });
  }

  return (
    <main className="min-h-screen bg-[#f3f5f1] text-neutral-950">
      <header className="border-b border-neutral-300 bg-white">
        <div className="mx-auto flex max-w-[1480px] flex-col gap-6 px-5 py-8 md:flex-row md:items-end md:justify-between md:px-10">
          <div>
            <p className="text-xs font-medium tracking-[0.22em] text-emerald-800">ADMIN / AUTO CLASSIFICATION</p>
            <h1 className="mt-2 text-3xl font-semibold tracking-tight md:text-4xl">카테고리 일괄 검수</h1>
            <p className="mt-3 max-w-2xl text-sm font-normal leading-6 text-neutral-600">상호명과 공공데이터 업태가 일치하는 안전 후보만 골라 공개합니다. 충돌 후보는 개별 검수에서 확인하세요.</p>
          </div>
          <nav className="flex gap-2 text-sm font-medium">
            <Link className="border border-neutral-300 bg-white px-4 py-2.5 hover:border-neutral-900" to="/admin/candidates">개별 검수</Link>
            <Link className="border border-neutral-300 bg-white px-4 py-2.5 hover:border-neutral-900" to="/admin/data-sync">데이터 동기화</Link>
          </nav>
        </div>
      </header>

      <section className="mx-auto grid max-w-[1480px] grid-cols-2 border-x border-b border-neutral-300 bg-white md:grid-cols-4">
        <Summary label="전체 대기" value={loaderData.groups.reduce((total, group) => total + group.candidates.length, 0)} />
        <Summary label="일괄 승인 가능" value={eligibleIds.length} tone="safe" />
        <Summary label="개별 확인 필요" value={needsReview} tone="warning" />
        <Summary label="선택 / 최대" value={`${selected.size} / 25`} />
      </section>

      {actionData && (
        <section className="mx-auto mt-5 flex max-w-[1480px] gap-5 border border-emerald-700 bg-emerald-50 px-5 py-4 text-sm">
          <strong className="font-semibold">{actionData.approved.length}곳 공개 완료</strong>
          <span className="text-neutral-600">{actionData.skipped.length}곳 제외</span>
        </section>
      )}

      <Form method="post" className="mx-auto max-w-[1480px] px-5 py-8 md:px-10">
        {[...selected].map((id) => <input key={id} type="hidden" name="candidateIds" value={id} />)}
        <div className="mb-5 flex flex-col gap-3 border border-neutral-300 bg-[#202721] px-5 py-4 text-white md:flex-row md:items-center md:justify-between">
          <p className="text-sm font-normal text-neutral-200"><span className="font-semibold text-white">{selected.size}곳</span>을 자동 분류된 카테고리로 공개합니다.</p>
          <button className="bg-[#d8ff72] px-5 py-3 text-sm font-semibold text-neutral-950 disabled:cursor-not-allowed disabled:opacity-50" disabled={!selected.size || isSubmitting}>
            {isSubmitting ? "공개 처리 중…" : "선택한 장소 일괄 승인·공개"}
          </button>
        </div>

        <div className="space-y-5">
          {loaderData.groups.map((group) => {
            const groupEligibleIds = group.candidates.filter((candidate) => candidate.eligible).map((candidate) => candidate.id);
            const allSelected = groupEligibleIds.length > 0 && groupEligibleIds.every((id) => selected.has(id));
            return (
              <details open key={group.categorySlug} className="border border-neutral-300 bg-white">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-4 border-b border-neutral-200 px-5 py-4">
                  <div className="flex items-center gap-3">
                    <span className="text-xl" aria-hidden>{group.categoryEmoji}</span>
                    <div>
                      <p className="text-xs font-medium text-neutral-500">{group.parentName}</p>
                      <h2 className="text-lg font-semibold">{group.categoryName} <span className="font-normal text-neutral-400">{group.candidates.length}</span></h2>
                    </div>
                  </div>
                  <button type="button" disabled={!groupEligibleIds.length} onClick={(event) => { event.preventDefault(); toggleGroup(groupEligibleIds); }} className="border border-neutral-300 px-3 py-2 text-xs font-medium disabled:opacity-40">
                    {allSelected ? "이 분류 선택 해제" : "안전 후보 전체 선택"}
                  </button>
                </summary>
                <div className="divide-y divide-neutral-200">
                  {group.candidates.map((candidate) => (
                    <label key={candidate.id} className={`grid gap-4 px-5 py-4 md:grid-cols-[36px_minmax(220px,1.1fr)_minmax(260px,1.5fr)_minmax(180px,.8fr)] ${candidate.eligible ? "hover:bg-emerald-50/50" : "bg-neutral-50 text-neutral-500"}`}>
                      <input type="checkbox" checked={selected.has(candidate.id)} disabled={!candidate.eligible} onChange={() => toggleCandidate(candidate.id)} className="mt-1 size-4 accent-emerald-800" />
                      <div>
                        <p className="font-medium text-neutral-950">{candidate.businessName}</p>
                        <p className="mt-1 text-xs font-normal">{candidate.businessSubtype ?? "세부업태 없음"} · {candidate.regionCode === "GWANGJU" ? "광주" : "전남"}</p>
                      </div>
                      <div>
                        <p className="text-sm font-normal text-neutral-700">{candidate.address || "주소 없음"}</p>
                        <p className="mt-1 text-xs font-normal text-neutral-500">{candidate.neighborhood ?? "동네 추출 실패"} · {candidate.latitude?.toFixed(5) ?? "좌표 없음"}, {candidate.longitude?.toFixed(5) ?? "좌표 없음"}</p>
                      </div>
                      <div>
                        <span className={`inline-flex border px-2 py-1 text-[11px] font-medium ${candidate.confidence === "HIGH" ? "border-emerald-600 bg-emerald-50 text-emerald-800" : candidate.confidence === "CONFLICT" ? "border-red-400 bg-red-50 text-red-700" : "border-amber-400 bg-amber-50 text-amber-800"}`}>신뢰도 {confidenceLabels[candidate.confidence]}</span>
                        <p className="mt-2 text-xs font-normal leading-5">{candidate.eligible ? candidate.reasons.join(" · ") : candidate.blockers.join(" · ")}</p>
                      </div>
                    </label>
                  ))}
                </div>
              </details>
            );
          })}
          {!loaderData.groups.length && <p className="border border-neutral-300 bg-white px-5 py-12 text-center text-sm font-normal text-neutral-500">현재 검수 대기 중인 영업 장소가 없습니다.</p>}
        </div>
      </Form>
    </main>
  );
}

function Summary({ label, value, tone }: { label: string; value: string | number; tone?: "safe" | "warning" }) {
  return (
    <div className="border-r border-neutral-200 px-5 py-5 last:border-r-0">
      <p className="text-xs font-medium text-neutral-500">{label}</p>
      <p className={`mt-1 text-2xl font-semibold ${tone === "safe" ? "text-emerald-800" : tone === "warning" ? "text-amber-700" : "text-neutral-950"}`}>{value}</p>
    </div>
  );
}
