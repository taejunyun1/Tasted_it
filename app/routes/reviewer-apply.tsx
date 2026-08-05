import { env } from "cloudflare:workers";
import { asc, eq, isNull } from "drizzle-orm";
import { Form, Link } from "react-router";

import type { Route } from "./+types/reviewer-apply";
import { createDb } from "../db/client.server";
import { categories } from "../db/schema";
import { requireUser } from "../features/auth/session.server";
import { getReviewerDashboard, submitReviewerApplication } from "../features/reviewers/reviewer.server";

export async function loader({ request }: Route.LoaderArgs) {
  const user = await requireUser(request);
  const db = createDb(env.DB);
  const [dashboard, parentCategories] = await Promise.all([
    getReviewerDashboard(db, user.id),
    db.select().from(categories).where(isNull(categories.parentId)).orderBy(asc(categories.sortOrder)),
  ]);
  return { user, dashboard, parentCategories: parentCategories.filter((category) => category.isActive) };
}

export async function action({ request }: Route.ActionArgs) {
  const user = await requireUser(request);
  const form = await request.formData();
  const values = {
    statement: String(form.get("statement") ?? ""), occupation: String(form.get("occupation") ?? ""),
    tasteDirection: String(form.get("tasteDirection") ?? ""), regionCode: String(form.get("regionCode") ?? "") as "GWANGJU" | "JEONNAM",
    specialtySlugs: form.getAll("specialtySlugs").map(String),
  };
  try {
    const result = await submitReviewerApplication(createDb(env.DB), { userId: user.id, ...values, now: new Date().toISOString() });
    return { ok: true, applicationId: result.id, error: null, values };
  } catch (error) {
    const message = error instanceof Error ? error.message : "신청을 저장하지 못했습니다.";
    return { ok: false, applicationId: null, error: message.startsWith("REVIEWER_APPLICATION_INVALID:") ? "입력 항목을 확인하세요." : reviewerError(message), values };
  }
}

export default function ReviewerApply({ loaderData, actionData }: Route.ComponentProps) {
  const latest = loaderData.dashboard.latestApplication;
  const profile = loaderData.dashboard.profile;
  const canApply = !profile;
  const hasOpen = latest?.status === "APPLIED" || latest?.status === "REVIEWING";
  return <main id="main" className="mx-auto min-h-screen max-w-5xl px-5 py-12 md:px-10">
    <p className="font-mono text-[11px] font-medium tracking-[0.2em] text-emerald-800">REVIEWER / APPLICATION</p>
    <div className="mt-3 grid gap-8 border-b border-neutral-900 pb-8 md:grid-cols-[1fr_260px] md:items-end">
      <div><h1 className="text-4xl font-semibold tracking-[-0.05em] md:text-6xl">리뷰어 신청</h1><p className="mt-4 max-w-2xl leading-7 text-neutral-600">좋아하는 가게를 많이 아는 것보다, 같은 기준으로 오래 기록할 수 있는지를 봅니다.</p></div>
      <div className="border-l-4 border-emerald-800 bg-emerald-50 p-5"><p className="text-xs font-medium text-neutral-600">승인된 장소 제안</p><strong className="mt-1 block font-mono text-3xl font-semibold text-emerald-900">{loaderData.dashboard.approvedSuggestionCount} / 10곳</strong><p className="mt-2 text-xs leading-5 text-neutral-600">제안 기능 연결 전에는 0곳으로 표시됩니다.</p></div>
    </div>
    {actionData?.error && <p className="mt-6 border border-rose-500 bg-rose-50 px-4 py-3 text-sm text-rose-800">{actionData.error}</p>}
    {actionData?.ok && <p className="mt-6 border border-emerald-700 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">신청이 접수됐습니다. 관리자 검토를 기다려 주세요.</p>}
    {profile ? <section className="mt-8 border border-neutral-300 bg-white p-6"><h2 className="text-xl font-semibold">{profile.status === "ACTIVE" ? "현재 활동 중인 리뷰어입니다." : profile.status === "DORMANT" ? "현재 휴면 상태입니다." : "현재 활동이 정지됐습니다."}</h2><p className="mt-2 text-sm text-neutral-600">{profile.status === "ACTIVE" ? "승인된 리뷰어 프로필과 활동 기록을 관리할 수 있습니다." : "새로 신청하지 않고 운영자 확인 후 상태를 변경합니다."}</p>{profile.status !== "SUSPENDED" && <Link className="mt-4 inline-block border border-neutral-900 px-4 py-2 text-sm font-medium" to={`/reviewers/${profile.slug}`}>공개 프로필 보기</Link>}</section>
      : hasOpen ? <StatusPanel status={latest.status} />
      : canApply && <Form method="post" className="mt-8 grid gap-6 border border-neutral-300 bg-white p-5 md:p-8">
        <Field label="맛집 선정 기준 의견서" hint="100~1,000자"><textarea name="statement" rows={7} minLength={100} maxLength={1000} required defaultValue={actionData?.values.statement ?? ""} /></Field>
        <div className="grid gap-5 md:grid-cols-2"><Field label="직업 또는 활동 소개" hint="최대 80자"><input name="occupation" maxLength={80} required defaultValue={actionData?.values.occupation ?? ""} /></Field><Field label="활동 지역"><select name="regionCode" required defaultValue={actionData?.values.regionCode ?? "GWANGJU"}><option value="GWANGJU">광주</option><option value="JEONNAM">전남</option></select></Field></div>
        <Field label="취향 방향" hint="최대 200자"><textarea name="tasteDirection" rows={3} maxLength={200} required defaultValue={actionData?.values.tasteDirection ?? ""} /></Field>
        <fieldset><legend className="text-sm font-semibold">전문 카테고리 <span className="font-normal text-neutral-500">1~3개</span></legend><div className="mt-3 grid grid-cols-2 gap-2 md:grid-cols-4">{loaderData.parentCategories.map((category) => <label key={category.id} className="flex items-center gap-2 border border-neutral-300 px-3 py-3 text-sm"><input type="checkbox" name="specialtySlugs" value={category.slug} /> <span>{category.emoji} {category.name}</span></label>)}</div></fieldset>
        <button className="bg-neutral-950 px-5 py-3 text-sm font-semibold text-white">리뷰어 신청 제출</button>
      </Form>}
  </main>;
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactElement }) { return <label className="grid gap-2 text-sm font-semibold"><span>{label} {hint && <small className="font-normal text-neutral-500">{hint}</small>}</span><span className="[&>*]:w-full [&>*]:border [&>*]:border-neutral-300 [&>*]:bg-white [&>*]:px-3 [&>*]:py-3 [&>*]:font-normal">{children}</span></label>; }
function StatusPanel({ status }: { status: string }) { return <section className="mt-8 border border-amber-500 bg-amber-50 p-6"><h2 className="text-xl font-semibold">{status === "REVIEWING" ? "관리자가 검토 중입니다." : "신청이 접수됐습니다."}</h2><p className="mt-2 text-sm text-neutral-600">결정이 완료되면 이 화면에서 상태를 확인할 수 있습니다.</p></section>; }
function reviewerError(message: string) { return ({ REVIEWER_APPLICATION_IN_PROGRESS: "이미 검토 중인 신청이 있습니다.", REVIEWER_PROFILE_EXISTS: "이미 리뷰어 이력이 있습니다. 운영자에게 상태 확인을 요청하세요.", REVIEWER_SPECIALTY_NOT_FOUND: "전문 카테고리를 다시 선택하세요." } as Record<string, string>)[message] ?? message; }
