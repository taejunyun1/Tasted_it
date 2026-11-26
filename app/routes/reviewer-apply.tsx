import { env } from "cloudflare:workers";
import { and, asc, eq, isNull } from "drizzle-orm";
import { cloneElement, useEffect, useRef } from "react";
import { data, Form, Link, useNavigation } from "react-router";

import type { Route } from "./+types/reviewer-apply";
import { createDb } from "../db/client.server";
import { categories } from "../db/schema";
import { requireUser } from "../features/auth/session.server";
import { isSameOriginMutation } from "../features/http/same-origin";
import { getReviewerDashboard, submitReviewerApplication } from "../features/reviewers/reviewer.server";
import { validateReviewerApplication } from "../features/reviewers/reviewer-policy";

export const headers: Route.HeadersFunction = () => ({ "Cache-Control": "private, no-store", Vary: "Cookie" });

export async function loader({ request }: Route.LoaderArgs) {
  const user = await requireUser(request);
  const db = createDb(env.DB);
  const [{ latestApplication, profile, approvedSuggestionCount }, parentCategories] = await Promise.all([
    getReviewerDashboard(db, user.id),
    db.select({ id: categories.id, slug: categories.slug, name: categories.name, emoji: categories.emoji })
      .from(categories).where(and(isNull(categories.parentId), eq(categories.isActive, true))).orderBy(asc(categories.sortOrder)),
  ]);
  return {
    dashboard: {
      latestApplication: latestApplication ?? null,
      profile: profile ? {
        status: profile.status,
        publicSlug: profile.status === "ACTIVE" && user.role === "REVIEWER" ? profile.slug : null,
      } : null,
      approvedSuggestionCount,
    },
    parentCategories,
  };
}

export async function action({ request }: Route.ActionArgs) {
  if (!isSameOriginMutation(request)) throw new Response("이 요청은 현재 서비스에서 다시 실행해 주세요.", { status: 403, statusText: "FORBIDDEN" });
  const user = await requireUser(request);
  const form = await request.formData();
  const values = {
    statement: String(form.get("statement") ?? ""), occupation: String(form.get("occupation") ?? ""),
    tasteDirection: String(form.get("tasteDirection") ?? ""), regionCode: String(form.get("regionCode") ?? "") as "GWANGJU" | "JEONNAM",
    specialtySlugs: form.getAll("specialtySlugs").map(String),
  };
  const fieldErrors = validateReviewerApplication(values);
  if (Object.keys(fieldErrors).length) {
    return data({ ok: false, applicationId: null, error: "입력 항목을 확인하세요.", fieldErrors, values }, { status: 400 });
  }
  try {
    const result = await submitReviewerApplication(createDb(env.DB), { userId: user.id, ...values, now: new Date().toISOString() });
    return { ok: true, applicationId: result.id, error: null, fieldErrors: {}, values };
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    const fieldErrors = message === "REVIEWER_SPECIALTY_NOT_FOUND" ? { specialtySlugs: "전문 카테고리를 다시 선택하세요." } : {};
    const status = message === "REVIEWER_APPLICATION_IN_PROGRESS" || message === "REVIEWER_PROFILE_EXISTS" ? 409 : message === "REVIEWER_SPECIALTY_NOT_FOUND" ? 400 : 500;
    return data({ ok: false, applicationId: null, error: reviewerError(message), fieldErrors, values }, { status });
  }
}

export default function ReviewerApply({ loaderData, actionData }: Route.ComponentProps) {
  const navigation = useNavigation();
  const pending = navigation.state !== "idle" && Boolean(navigation.formData);
  const formRef = useRef<HTMLFormElement>(null);
  const errorRef = useRef<HTMLParagraphElement>(null);
  const submitGuard = useRef(false);
  useEffect(() => {
    if (navigation.state === "idle") submitGuard.current = false;
  }, [navigation.state, actionData]);
  useEffect(() => {
    if (!actionData?.error) return;
    const invalid = formRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]');
    (invalid?.querySelector<HTMLElement>("input, textarea, select") ?? invalid ?? errorRef.current)?.focus();
  }, [actionData]);
  const errors: ReturnType<typeof validateReviewerApplication> = actionData?.fieldErrors ?? {};
  const latest = loaderData.dashboard.latestApplication;
  const profile = loaderData.dashboard.profile;
  const canApply = !profile;
  const hasOpen = latest?.status === "APPLIED" || latest?.status === "REVIEWING";
  return <main id="main" className="mx-auto min-h-screen max-w-5xl px-5 py-12 md:px-10">
    <p className="font-mono text-[11px] font-medium tracking-[0.2em] text-emerald-800">REVIEWER / APPLICATION</p>
    <div className="mt-3 grid gap-8 border-b border-neutral-900 pb-8 md:grid-cols-[1fr_260px] md:items-end">
      <div><h1 className="text-[25.2px] font-semibold tracking-[-0.05em] md:text-[42px]">리뷰어 신청</h1><p className="mt-4 max-w-2xl leading-7 text-neutral-600">좋아하는 가게를 많이 아는 것보다, 같은 기준으로 오래 기록할 수 있는지를 봅니다.</p></div>
      <div className="border-l-4 border-emerald-800 bg-emerald-50 p-5"><p className="text-xs font-medium text-neutral-600">승인된 장소 제안</p><strong className="mt-1 block font-mono text-3xl font-semibold text-emerald-900">{loaderData.dashboard.approvedSuggestionCount} / 10곳</strong><p className="mt-2 text-xs leading-5 text-neutral-600">승인된 제안 건수를 심사 시 함께 확인합니다.</p></div>
    </div>
    {actionData?.error && <p ref={errorRef} tabIndex={-1} role="alert" className="mt-6 border border-rose-500 bg-rose-50 px-4 py-3 text-sm text-rose-800">{actionData.error}</p>}
    {actionData?.ok && <p role="status" className="mt-6 border border-emerald-700 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">신청이 접수됐습니다. 관리자 검토를 기다려 주세요.</p>}
    {profile ? <section className="mt-8 border border-neutral-300 bg-white p-6">
      <h2 className="text-xl font-semibold">{profile.status === "ACTIVE" ? "현재 활동 중인 리뷰어입니다." : profile.status === "DORMANT" ? "현재 휴면 상태입니다." : "현재 활동이 정지됐습니다."}</h2>
      <p className="mt-2 text-sm text-neutral-600">{profile.publicSlug ? "승인된 리뷰어 프로필과 활동 기록을 관리할 수 있습니다." : "새로 신청하지 않고 운영자 확인 후 상태를 변경합니다."}</p>
      {profile.publicSlug && <Link className="mt-4 inline-block border border-neutral-900 px-4 py-2 text-sm font-medium" to={`/reviewers/${encodeURIComponent(profile.publicSlug)}`}>공개 프로필 보기</Link>}
    </section>
      : hasOpen ? <StatusPanel status={latest.status} />
      : canApply && <Form ref={formRef} method="post" aria-busy={pending} onSubmit={(event) => {
        if (pending || submitGuard.current) event.preventDefault();
        else submitGuard.current = true;
      }} className="mt-8 grid gap-6 border border-neutral-300 bg-white p-5 md:p-8">
        <Field id="reviewer-statement" label="맛집 선정 기준 의견서" hint="100~1,000자" error={errors.statement}><textarea name="statement" rows={7} minLength={100} maxLength={1000} required defaultValue={actionData?.values.statement ?? ""} /></Field>
        <div className="grid gap-5 md:grid-cols-2"><Field id="reviewer-occupation" label="직업 또는 활동 소개" hint="최대 80자" error={errors.occupation}><input name="occupation" maxLength={80} required defaultValue={actionData?.values.occupation ?? ""} /></Field><Field id="reviewer-region" label="활동 지역" error={errors.regionCode}><select name="regionCode" required defaultValue={actionData?.values.regionCode ?? "GWANGJU"}><option value="GWANGJU">광주</option><option value="JEONNAM">전남</option></select></Field></div>
        <p className="text-sm leading-6 text-neutral-600">직업 또는 활동 소개는 리뷰어 심사에 사용합니다. 직접인증 참여자의 소개는 내부 심사에만 사용합니다. 일반 리뷰어의 소개는 승인 뒤 공개 프로필에 표시됩니다. 보관·삭제 기준은 <Link className="underline" to="/privacy">개인정보 처리방침</Link>에서 확인해 주세요.</p>
        <Field id="reviewer-taste" label="취향 방향" hint="최대 200자" error={errors.tasteDirection}><textarea name="tasteDirection" rows={3} maxLength={200} required defaultValue={actionData?.values.tasteDirection ?? ""} /></Field>
        <fieldset aria-invalid={errors.specialtySlugs ? true : undefined} aria-describedby={errors.specialtySlugs ? "reviewer-specialty-error" : undefined}><legend className="text-sm font-semibold">전문 카테고리 <span className="font-normal text-neutral-500">1~3개</span></legend><div className="mt-3 grid grid-cols-2 gap-2 md:grid-cols-4">{loaderData.parentCategories.map((category) => <label key={category.id} className="flex items-center gap-2 border border-neutral-300 px-3 py-3 text-sm"><input type="checkbox" name="specialtySlugs" value={category.slug} defaultChecked={actionData?.values.specialtySlugs.includes(category.slug)} /> <span>{category.emoji} {category.name}</span></label>)}</div>{errors.specialtySlugs && <p id="reviewer-specialty-error" className="mt-2 text-sm text-rose-800">{errors.specialtySlugs}</p>}</fieldset>
        <button type="submit" disabled={pending} className="bg-neutral-950 px-5 py-3 text-sm font-semibold text-white disabled:opacity-60">{pending ? "신청을 제출하고 있어요…" : "리뷰어 신청 제출"}</button>
      </Form>}
  </main>;
}

function Field({ id, label, hint, error, children }: { id: string; label: string; hint?: string; error?: string; children: React.ReactElement<{ id?: string; "aria-invalid"?: boolean; "aria-describedby"?: string }> }) {
  return <div className="grid gap-2 text-sm font-semibold"><label htmlFor={id}>{label} {hint && <small id={`${id}-hint`} className="font-normal text-neutral-500">{hint}</small>}</label><span className="[&>*]:w-full [&>*]:border [&>*]:border-neutral-300 [&>*]:bg-white [&>*]:px-3 [&>*]:py-3 [&>*]:font-normal">{cloneElement(children, { id, "aria-invalid": error ? true : undefined, "aria-describedby": [hint && `${id}-hint`, error && `${id}-error`].filter(Boolean).join(" ") || undefined })}</span>{error && <p id={`${id}-error`} className="text-sm text-rose-800">{error}</p>}</div>;
}
function StatusPanel({ status }: { status: string }) { return <section className="mt-8 border border-amber-500 bg-amber-50 p-6"><h2 className="text-xl font-semibold">{status === "REVIEWING" ? "관리자가 검토 중입니다." : "신청이 접수됐습니다."}</h2><p className="mt-2 text-sm text-neutral-600">결정이 완료되면 이 화면에서 상태를 확인할 수 있습니다.</p></section>; }
function reviewerError(message: string) { return ({ REVIEWER_APPLICATION_IN_PROGRESS: "이미 검토 중인 신청이 있습니다.", REVIEWER_PROFILE_EXISTS: "이미 리뷰어 이력이 있습니다. 운영자에게 상태 확인을 요청하세요.", REVIEWER_SPECIALTY_NOT_FOUND: "전문 카테고리를 다시 선택하세요." } as Record<string, string>)[message] ?? "신청을 저장하지 못했어요. 잠시 후 다시 시도해 주세요."; }
