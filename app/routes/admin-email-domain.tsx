import { env } from "cloudflare:workers";
import { data, Form, Link, redirect, useNavigation } from "react-router";
import { z } from "zod";
import type { Route } from "./+types/admin-email-domain";
import { readSessionId, requireAdmin } from "../features/auth/session.server";
import { emailDomainSchema, senderDomain } from "../features/auth/email-domain.server";
import { commitEmailDomainAction, prepareEmailDomainAction, readEmailDomainAction, readEmailDomainControl, refreshEmailDomain } from "../features/auth/email-domain-control.server";
import { isSameOriginMutation } from "../features/http/same-origin";

const privateHeaders = { "Cache-Control": "private, no-store", Vary: "Cookie", "X-Robots-Tag": "noindex, nofollow" };
export const headers: Route.HeadersFunction = () => privateHeaders;
async function authorize(request: Request) {
  try { return await requireAdmin(request); }
  catch (error) {
    if (error instanceof Response) {
      const headers = new Headers(error.headers);
      for (const [key, value] of Object.entries(privateHeaders)) headers.set(key, value);
      throw new Response(error.body, { status: error.status, statusText: error.statusText, headers });
    }
    throw error;
  }
}
function configuration() {
  const target = emailDomainSchema.safeParse(env.EMAIL_DOMAIN_REPAIR_TARGET);
  return { targetDomain: target.success ? target.data : null, apiConfigured: Boolean(env.RESEND_API_KEY),
    senderDomain: senderDomain(env.RESEND_FROM_EMAIL ?? "") };
}
export async function loader({ request }: Route.LoaderArgs) {
  const admin = await authorize(request), config = configuration();
  const configured = Boolean(config.targetDomain && config.apiConfigured);
  const control = configured ? await readEmailDomainControl(env.DB, config.targetDomain!) : null;
  let preview: Awaited<ReturnType<typeof readEmailDomainAction>> | null = null;
  const id = new URL(request.url).searchParams.get("operation"), sid = readSessionId(request);
  if (configured && id && sid && z.uuid().safeParse(id).success) {
    try { preview = await readEmailDomainAction(env.DB, { actorUserId: admin.id, sessionId: sid, now: new Date().toISOString(), operationId: id, targetDomain: config.targetDomain! }); }
    catch { /* An unavailable or expired preview is never a new request. */ }
  }
  return { ...config, configured, control, preview };
}
const formSchema = z.discriminatedUnion("intent", [
  z.object({ intent: z.literal("refresh") }).strict(),
  z.object({ intent: z.literal("prepare"), command: z.enum(["create", "verify"]) }).strict(),
  z.object({ intent: z.literal("confirm"), operationId: z.uuid() }).strict(),
]);
export async function action({ request }: Route.ActionArgs) {
  const admin = await authorize(request);
  if (request.method !== "POST") return data({ message: "POST 요청만 사용할 수 있습니다.", preview: null }, { status: 405, headers: { ...privateHeaders, Allow: "POST" } });
  if (!isSameOriginMutation(request)) return data({ message: "현재 서비스에서 다시 요청해 주세요.", preview: null }, { status: 403, headers: privateHeaders });
  const parsed = formSchema.safeParse(Object.fromEntries(await request.formData()));
  if (!parsed.success) return data({ message: "요청 형식을 확인해 주세요.", preview: null }, { status: 400, headers: privateHeaders });
  const config = configuration(), sessionId = readSessionId(request);
  if (!config.targetDomain || !config.apiConfigured || !sessionId) return data({ message: "배포 설정이 없어 메일 도메인 작업을 사용할 수 없습니다.", preview: null }, { status: 503, headers: privateHeaders });
  const input = { actorUserId: admin.id, sessionId, now: new Date().toISOString(), targetDomain: config.targetDomain, apiKey: env.RESEND_API_KEY! };
  try {
    if (parsed.data.intent === "refresh") {
      await refreshEmailDomain(env.DB, input);
      return data({ message: "지정 도메인 상태를 조회했습니다. 실제 메일 전달 여부는 별도입니다.", preview: null }, { headers: privateHeaders });
    }
    if (parsed.data.intent === "prepare") {
      const p = await prepareEmailDomainAction(env.DB, { ...input, intent: parsed.data.command });
      const preview = await readEmailDomainAction(env.DB, { ...input, operationId: p.operationId });
      return data({ message: "대상과 요청을 확인해 주세요. 아직 공급자에 변경을 요청하지 않았습니다.", preview }, { headers: privateHeaders });
    }
    const result = await commitEmailDomainAction(env.DB, { ...input, operationId: parsed.data.operationId });
    const state = result.actions.find((a) => a.operationId === result.operationId)?.state;
    return data({ message: state === "CREATED" ? "도메인 생성 응답을 받았습니다. DNS 검증과 메일 전달은 별도입니다."
      : state === "ACCEPTED" ? "검증 요청이 접수됐습니다. 검증 완료는 상태 조회로 확인해 주세요."
      : "요청 상태를 확인했습니다. 결과가 불명확하면 같은 변경을 반복하지 않고 상태를 조회해 주세요.", preview: null }, { headers: privateHeaders });
  } catch (error) {
    const code = error instanceof Error ? error.message : "";
    if (code === "ADMIN_RECENT_AUTH_REQUIRED" && parsed.data.intent === "confirm") {
      throw redirect(`/admin/reauth?returnTo=${encodeURIComponent(`/admin/operations/email-domain?operation=${parsed.data.operationId}`)}`, { headers: privateHeaders });
    }
    const messages: Record<string, string> = {
      EMAIL_DOMAIN_OBSERVATION_REQUIRED: "먼저 최근 도메인 상태를 조회해 주세요.",
      EMAIL_DOMAIN_RESULT_PENDING: "결과 확인이 필요한 요청이 있습니다. 상태 조회부터 진행해 주세요.",
      EMAIL_DOMAIN_ACTION_UNAVAILABLE: "현재 관측 상태에서는 이 작업을 실행할 수 없습니다.",
      ADMIN_OPERATION_CONFLICT: "조회 이후 상태가 달라졌습니다. 다시 조회하고 검토해 주세요.",
      EMAIL_DOMAIN_LIST_INCOMPLETE: "공급자 목록이 불완전해 도메인 부재를 확정하지 않았습니다.",
    };
    return data({ message: messages[code] ?? "요청 결과를 확인할 수 없습니다. 상태를 다시 조회해 주세요.", preview: null }, { status: 409, headers: privateHeaders });
  }
}
export const meta: Route.MetaFunction = () => [{ title: "메일 도메인 — Re:Taste Admin" }];
const statusLabels: Record<string, string> = { ABSENT: "도메인 없음", not_started: "검증 전", pending: "검증 대기", verified: "검증됨", failed: "검증 실패", temporary_failure: "일시 오류" };
const actionLabels: Record<string, string> = { REQUESTED: "요청 저장됨", CREATED: "생성 응답 확인", ACCEPTED: "검증 요청 접수", UNKNOWN: "결과 불명 · 상태 조회 필요", OBSERVED_PRESENT: "도메인 존재 확인 · 요청 기여 불명", OBSERVED_VERIFIED: "현재 검증 상태 확인", OBSERVED_FAILED: "현재 검증 실패 확인" };
export default function AdminEmailDomain({ loaderData, actionData }: Route.ComponentProps) {
  const busy = useNavigation().state !== "idle", preview = actionData?.preview ?? loaderData.preview;
  const observation = loaderData.control?.observation;
  const canPrepare = loaderData.configured && observation && !loaderData.control?.mutationBlocked;
  return <main className="mx-auto max-w-4xl space-y-6 px-4 py-8">
    <div><Link to="/admin" className="text-sm underline">관리자 홈</Link><h1 className="mt-3 text-2xl font-bold">메일 도메인</h1>
      <p className="mt-2 text-sm text-stone-600">지정 도메인의 관측 상태와 요청 영수증을 확인합니다. 이 화면은 메일을 발송하지 않습니다.</p></div>
    {actionData?.message && <p role="status" className="rounded-lg border p-4">{actionData.message}</p>}
    <section className="space-y-3 rounded-xl border p-5"><h2 className="font-semibold">배포 설정</h2>
      <dl className="grid gap-2 break-all sm:grid-cols-2"><dt>대상 도메인</dt><dd>{loaderData.targetDomain ?? "미설정"}</dd><dt>발신 도메인</dt><dd>{loaderData.senderDomain ?? "미설정"}</dd><dt>API 구성</dt><dd>{loaderData.apiConfigured ? "구성됨" : "미설정"}</dd><dt>도메인 일치</dt><dd>{loaderData.targetDomain && loaderData.senderDomain ? loaderData.targetDomain === loaderData.senderDomain ? "일치" : "불일치" : "확인 불가"}</dd></dl>
      {!loaderData.configured && <p>배포 설정이 없어 작업이 잠겨 있습니다. 설정값과 발신주소 원문은 표시하지 않습니다.</p>}
    </section>
    <section className="space-y-3 rounded-xl border p-5"><h2 className="font-semibold">공급자 관측</h2>
      <p>{observation ? statusLabels[observation.status ?? ""] ?? "상태 확인 필요" : "아직 관측하지 않았습니다."}</p>
      {observation && <p className="text-sm break-all">조회시각(UTC): {observation.observedAt}</p>}
      <Form method="post"><input type="hidden" name="intent" value="refresh" /><button disabled={busy || !loaderData.configured} className="rounded border px-4 py-2 disabled:opacity-50">상태 새로 조회</button></Form>
      <p className="text-sm text-stone-600">조회당 최대 2회 요청합니다. 결과 불명 상태를 자동 재시도하지 않습니다. 도메인 검증은 실제 메일 전달 성공을 뜻하지 않습니다.</p>
      {canPrepare && <Form method="post"><input type="hidden" name="intent" value="prepare" /><input type="hidden" name="command" value={observation.domainPresent ? "verify" : "create"} /><button disabled={busy || observation.status === "verified"} className="rounded border px-4 py-2 disabled:opacity-50">{observation.domainPresent ? "검증 요청 검토" : "도메인 생성 검토"}</button></Form>}
    </section>
    {preview?.status === "PENDING" && <section className="space-y-3 rounded-xl border border-amber-400 p-5"><h2 className="font-semibold">변경 미리보기</h2><p className="break-all">{preview.targetDomain} · {preview.intent === "create" ? "생성" : "검증 요청"}</p><p>확정에는 최근 인증이 필요합니다. 접수 이후 결과가 불명확하면 상태 조회로 확인합니다.</p><Form method="post"><input type="hidden" name="intent" value="confirm" /><input type="hidden" name="operationId" value={preview.operationId} /><button disabled={busy} className="rounded bg-stone-900 px-4 py-2 text-white">요청 확정</button></Form></section>}
    <section className="space-y-3"><h2 className="font-semibold">최근 요청</h2>{loaderData.control?.actions.length ? <ul className="space-y-3">{loaderData.control.actions.map((a) => <li key={a.operationId} className="break-all rounded-lg border p-4"><p>{a.intent === "create" ? "도메인 생성" : "검증 요청"} · {actionLabels[a.state] ?? "상태 확인 필요"}</p><p className="mt-1 text-sm">요청시각(UTC): {a.requestedAt}</p><Link to={`/admin/activity?view=operations&operation=${encodeURIComponent(a.operationId)}`} className="text-sm underline">감사 영수증</Link></li>)}</ul> : <p className="text-sm">저장된 요청이 없습니다.</p>}</section>
  </main>;
}
