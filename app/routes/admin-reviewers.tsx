import { env } from "cloudflare:workers";
import { Form, Link } from "react-router";

import type { Route } from "./+types/admin-reviewers";
import { createDb } from "../db/client.server";
import { requireAdmin } from "../features/auth/session.server";
import { applyReviewerDormancy, changeReviewerStatus, listReviewerAdminRows, reviewReviewerApplication } from "../features/reviewers/reviewer.server";

const statusLabels: Record<string, string> = { ALL: "전체", APPLIED: "신청 대기", REVIEWING: "검토 중", ACTIVE: "활동", DORMANT: "휴면", SUSPENDED: "정지", REJECTED: "반려" };

export async function loader({ request }: Route.LoaderArgs) {
  await requireAdmin(request);
  const url = new URL(request.url);
  const status = url.searchParams.get("status") ?? "ALL";
  return { ...(await listReviewerAdminRows(createDb(env.DB), { status, query: url.searchParams.get("q") ?? undefined })), status, q: url.searchParams.get("q") ?? "" };
}

export async function action({ request }: Route.ActionArgs) {
  const admin = await requireAdmin(request);
  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");
  const db = createDb(env.DB);
  const now = new Date().toISOString();
  try {
    if (intent === "applyDormancy") return { ...(await applyReviewerDormancy(db, { actorUserId: admin.id, now })), error: null };
    if (["START_REVIEW", "APPROVE", "OVERRIDE_APPROVE", "REJECT"].includes(intent)) {
      await reviewReviewerApplication(db, { applicationId: String(form.get("applicationId") ?? ""), actorUserId: admin.id, decision: intent as "START_REVIEW" | "APPROVE" | "OVERRIDE_APPROVE" | "REJECT", reason: String(form.get("reason") ?? ""), now });
      return { changed: 1, error: null };
    }
    if (["ACTIVE", "DORMANT", "SUSPENDED"].includes(intent)) {
      await changeReviewerStatus(db, { userId: String(form.get("userId") ?? ""), actorUserId: admin.id, status: intent as "ACTIVE" | "DORMANT" | "SUSPENDED", reason: String(form.get("reason") ?? ""), now });
      return { changed: 1, error: null };
    }
    return { changed: 0, error: "처리할 작업을 선택하세요." };
  } catch (error) { return { changed: 0, error: adminError(error instanceof Error ? error.message : "처리 실패") }; }
}

export default function AdminReviewers({ loaderData, actionData }: Route.ComponentProps) {
  return <main id="main" className="min-h-screen bg-[#f5f6f2] text-neutral-950"><header className="border-b border-neutral-300 bg-white"><div className="mx-auto flex max-w-[1450px] flex-col gap-6 px-5 py-8 md:flex-row md:items-end md:justify-between md:px-10"><div><p className="font-mono text-[11px] font-medium tracking-[0.2em] text-emerald-800">ADMIN / REVIEWER REGISTRY</p><h1 className="mt-2 text-4xl font-semibold tracking-[-0.05em] md:text-5xl">리뷰어 관리</h1><p className="mt-3 text-sm text-neutral-600">신청 근거와 활동 상태를 한 기록부에서 관리합니다.</p></div><div className="flex gap-2"><Link className="border border-neutral-300 px-4 py-2.5 text-sm font-medium" to="/admin/candidates">장소 검수</Link><Form method="post"><button name="intent" value="applyDormancy" className="bg-neutral-950 px-4 py-2.5 text-sm font-semibold text-white">휴면 대상 반영</button></Form></div></div></header><div className="mx-auto max-w-[1450px] px-5 py-7 md:px-10">
    <nav className="flex overflow-x-auto border-b border-neutral-900">{Object.entries(statusLabels).map(([status, label]) => <Link key={status} style={loaderData.status === status ? { color: "white" } : undefined} className={`shrink-0 border-x border-t border-neutral-900 px-4 py-3 text-sm font-medium ${loaderData.status === status ? "bg-neutral-950" : "bg-white"}`} to={status === "ALL" ? "/admin/reviewers" : `/admin/reviewers?status=${status}`}>{label}</Link>)}</nav>
    <Form method="get" className="mt-5 flex max-w-xl border border-neutral-300 bg-white"><input className="min-w-0 flex-1 px-4 py-3 text-sm" name="q" defaultValue={loaderData.q} placeholder="이름 또는 이메일" /><button className="bg-neutral-950 px-5 text-sm font-semibold text-white">검색</button></Form>
    {actionData && <p className={`mt-5 border px-4 py-3 text-sm ${actionData.error ? "border-rose-500 bg-rose-50 text-rose-800" : "border-emerald-700 bg-emerald-50 text-emerald-900"}`}>{actionData.error ?? `${actionData.changed}건 처리했습니다.`}</p>}
    <section className="mt-6 space-y-3">{loaderData.applications.map(({ application, displayName, email }) => <article key={application.id} className="grid gap-5 border border-neutral-300 bg-white p-5 lg:grid-cols-[220px_1fr_330px]"><div><span className="border border-amber-500 bg-amber-50 px-2 py-1 text-xs font-medium">{statusLabels[application.status]}</span><h2 className="mt-3 text-lg font-semibold">{displayName}</h2><p className="mt-1 text-xs text-neutral-500">{email}</p><p className="mt-3 font-mono text-xs">승인 제안 {application.approvedSuggestionCount} / 10</p></div><div><p className="text-sm leading-7">{application.statement}</p><p className="mt-3 text-xs text-neutral-500">{application.occupation} · {application.regionCode === "GWANGJU" ? "광주" : "전남"}</p></div><Form method="post" className="grid content-start gap-2"><input type="hidden" name="applicationId" value={application.id} /><input className="border border-neutral-300 px-3 py-2 text-sm" name="reason" placeholder="반려·예외 승인 사유" /><div className="grid grid-cols-2 gap-2"><button name="intent" value="START_REVIEW" className="border border-neutral-300 px-3 py-2 text-sm font-medium">검토 시작</button><button name="intent" value="APPROVE" className="border border-emerald-700 px-3 py-2 text-sm font-medium text-emerald-800">일반 승인</button><button name="intent" value="OVERRIDE_APPROVE" className="bg-emerald-800 px-3 py-2 text-sm font-semibold text-white">예외 승인</button><button name="intent" value="REJECT" className="border border-rose-500 px-3 py-2 text-sm font-medium text-rose-700">반려</button></div></Form></article>)}
      {loaderData.profiles.map(({ profile, displayName, email }) => <article key={profile.userId} className="grid gap-5 border border-neutral-300 bg-white p-5 lg:grid-cols-[220px_1fr_330px]"><div><span className="border border-neutral-400 px-2 py-1 text-xs font-medium">{statusLabels[profile.status]}</span><h2 className="mt-3 text-lg font-semibold">{displayName}</h2><p className="mt-1 text-xs text-neutral-500">{email}</p></div><div><p className="text-sm leading-7">{profile.tasteDirection}</p>{profile.status === "SUSPENDED" ? <p className="mt-3 text-xs text-neutral-500">공개 프로필 비공개</p> : <Link className="mt-3 inline-block text-xs font-medium text-emerald-800 underline" to={`/reviewers/${profile.slug}`}>공개 프로필</Link>}</div><Form method="post" className="grid content-start gap-2"><input type="hidden" name="userId" value={profile.userId} /><input className="border border-neutral-300 px-3 py-2 text-sm" name="reason" placeholder="상태 변경 사유" /><div className="grid grid-cols-3 gap-2"><button name="intent" value="ACTIVE" className="border border-emerald-700 px-2 py-2 text-xs font-medium">활성</button><button name="intent" value="DORMANT" className="border border-amber-500 px-2 py-2 text-xs font-medium">휴면</button><button name="intent" value="SUSPENDED" className="border border-rose-500 px-2 py-2 text-xs font-medium">정지</button></div></Form></article>)}
      {!loaderData.applications.length && !loaderData.profiles.length && <p className="border border-neutral-300 bg-white py-16 text-center text-sm text-neutral-500">현재 조건에 맞는 리뷰어 기록이 없습니다.</p>}
    </section></div></main>;
}
function adminError(message: string) { return ({ REVIEWER_REQUIREMENT_NOT_MET: "승인된 장소 제안 10곳이 필요합니다.", REVIEWER_OVERRIDE_REASON_REQUIRED: "예외 승인 사유를 입력하세요.", REVIEW_REASON_REQUIRED: "상태 변경 사유를 입력하세요." } as Record<string, string>)[message] ?? message; }
