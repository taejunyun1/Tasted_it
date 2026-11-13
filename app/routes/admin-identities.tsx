import { env } from "cloudflare:workers";
import { data, Form, Link, redirect } from "react-router";
import { z } from "zod";
import type { Route } from "./+types/admin-identities";
import { getAdminAssurance } from "../features/auth/admin-assurance.server";
import { commitAdminIdentityChange, getAdminIdentityPreview, listAdminIdentities, prepareAdminIdentityChange } from "../features/auth/admin-identity.server";
import { requireAdminSession } from "../features/auth/session.server";
import { isSameOriginMutation } from "../features/http/same-origin";

const prepareSchema = z.object({ targetUserId: z.string().min(1).max(100), action: z.enum(["GRANT_ADMIN", "REVOKE_ADMIN", "REVOKE_SESSIONS"]), selectedSessionRef: z.string().regex(/^[a-f0-9]{64}$/).optional() });
const commitSchema = z.object({ operationId: z.string().uuid(), kind: z.enum(["ADMIN_ROLE_CHANGE", "ADMIN_SESSIONS_REVOKE"]) });
const PRIVATE_HEADERS = { "Cache-Control": "private, no-store", Vary: "Cookie" };
export function headers() { return PRIVATE_HEADERS; }
export function ErrorBoundary() { return <main id="main" className="mx-auto max-w-xl px-6 py-12"><h1 className="text-2xl font-semibold">요청을 처리할 수 없습니다.</h1><p className="mt-4">관리자 계정과 접속 상태를 확인해 주세요.</p><Link to="/admin" className="mt-6 inline-block underline">관리자 홈</Link></main>; }
export function meta() { return [{ title: "회원 권한·세션 — Re:Taste 관리자" }]; }
export async function loader({ request }: Route.LoaderArgs) {
  const { user, sessionId } = await requireAdminSession(request);
  const url = new URL(request.url);
  const input = { actorUserId: user.id, sessionId, now: new Date() };
  const list = await listAdminIdentities(env.DB, { ...input, search: url.searchParams.get("q") ?? "", targetUserId: url.searchParams.get("user") ?? undefined });
  const operationId = url.searchParams.get("operation");
  const kind = url.searchParams.get("kind");
  let preview = null;
  if (operationId && (kind === "ADMIN_ROLE_CHANGE" || kind === "ADMIN_SESSIONS_REVOKE")) {
    try { preview = await getAdminIdentityPreview(env.DB, { ...input, operationId, kind }); } catch { /* Expired previews require a fresh selection. */ }
  }
  return data({ ...list, preview, kind, currentUserId: user.id, search: url.searchParams.get("q") ?? "", assurance: await getAdminAssurance(env.DB, input), saved: url.searchParams.has("saved") }, { headers: PRIVATE_HEADERS });
}
export async function action({ request }: Route.ActionArgs) {
  const { user, sessionId } = await requireAdminSession(request);
  if (!isSameOriginMutation(request)) return data({ error: "요청 출처를 확인할 수 없습니다." }, { status: 403, headers: PRIVATE_HEADERS });
  if (Number(request.headers.get("Content-Length") ?? 0) > 4096) return data({ error: "입력값이 너무 깁니다." }, { status: 413, headers: PRIVATE_HEADERS });
  const form = Object.fromEntries(await request.formData());
  const input = { actorUserId: user.id, sessionId, now: new Date() };
  try {
    if (form.intent === "commit") {
      const parsed = commitSchema.parse(form);
      await commitAdminIdentityChange(env.DB, { ...input, ...parsed });
      return redirect("/admin/identities?saved=1", { headers: PRIVATE_HEADERS });
    }
    const parsed = prepareSchema.parse(form);
    const operation = await prepareAdminIdentityChange(env.DB, { ...input, ...parsed });
    const kind = parsed.action === "REVOKE_SESSIONS" ? "ADMIN_SESSIONS_REVOKE" : "ADMIN_ROLE_CHANGE";
    return redirect(`/admin/identities?user=${encodeURIComponent(parsed.targetUserId)}&operation=${encodeURIComponent(operation.operationId)}&kind=${kind}`, { headers: PRIVATE_HEADERS });
  } catch (error) {
    if (error instanceof Error && /ADMIN_(?:REAUTH|RECENT_AUTH)_REQUIRED/.test(error.message)) return redirect("/admin/reauth?returnTo=%2Fadmin%2Fidentities", { headers: PRIVATE_HEADERS });
    return data({ error: "변경할 수 없습니다. 재인증과 대상의 현재 상태를 확인하고 다시 미리보기를 실행해 주세요." }, { status: 409, headers: PRIVATE_HEADERS });
  }
}
export default function AdminIdentities({ loaderData, actionData }: Route.ComponentProps) {
  const { target, preview } = loaderData;
  return <main id="main" className="mx-auto max-w-6xl px-4 py-10 sm:px-8">
    <Link to="/admin" className="text-sm underline">관리자 홈</Link>
    <h1 className="mt-5 text-2xl font-semibold">회원 권한·세션</h1>
    <p className="mt-2 text-neutral-600">관리자 권한과 로그인 세션을 관리합니다. 모든 변경은 미리보기 후 확정하며 감사 이력에 남습니다.</p>
    {!loaderData.assurance && <p className="mt-5 rounded-xl bg-amber-50 p-4">변경하려면 먼저 <Link className="font-semibold underline" to="/admin/reauth?returnTo=%2Fadmin%2Fidentities">재인증</Link>이 필요합니다.</p>}
    {loaderData.saved && <p role="status" className="mt-5 rounded-xl bg-emerald-50 p-4">변경을 적용했습니다.</p>}
    {actionData?.error && <p role="alert" className="mt-5 rounded-xl bg-red-50 p-4 text-red-800">{actionData.error}</p>}
    {preview && <section className="mt-6 rounded-2xl border-2 border-amber-500 bg-amber-50 p-5"><h2 className="text-lg font-semibold">변경 미리보기</h2>
      <p className="mt-3 break-words">{preview.displayName}: {preview.action === "REVOKE_SESSIONS" ? "로그인 세션 회수" : `${preview.beforeRole} → ${preview.afterRole}`}</p>
      <p className="mt-2">회수할 세션 {preview.sessionCount}개. 현재 작업 중인 세션은 유지됩니다.</p>
      <Form method="post" className="mt-4 flex flex-wrap gap-3"><input type="hidden" name="intent" value="commit" /><input type="hidden" name="operationId" value={preview.operationId} /><input type="hidden" name="kind" value={loaderData.kind ?? ""} /><button className="rounded-xl bg-red-800 px-5 py-3 font-semibold text-white">변경 확정</button><Link to="/admin/identities" className="rounded-xl border px-5 py-3">취소</Link></Form>
    </section>}
    <Form method="get" className="mt-6 flex gap-2"><label className="min-w-0 flex-1"><span className="sr-only">회원 이름 또는 이메일 검색</span><input name="q" defaultValue={loaderData.search} maxLength={100} placeholder="이름 또는 이메일 검색" className="w-full rounded-xl border px-4 py-3" /></label><button className="rounded-xl border px-5 py-3">검색</button></Form>
    <div className="mt-6 grid gap-6 lg:grid-cols-2"><section><h2 className="text-lg font-semibold">회원 목록</h2><ul className="mt-3 divide-y rounded-2xl border">{loaderData.users.map((user) => <li key={user.id}><Link to={`/admin/identities?user=${encodeURIComponent(user.id)}&q=${encodeURIComponent(loaderData.search)}`} className="block p-4 hover:bg-neutral-50"><span className="font-semibold">{user.displayName}</span><span className="ml-2 text-xs">{user.role}</span><p className="break-all text-sm text-neutral-600">{user.email}</p></Link></li>)}</ul><p className="mt-2 text-sm text-neutral-500">최대 50명. 검색어로 범위를 좁힐 수 있습니다.</p></section>
      {target && <section className="rounded-2xl border p-5"><h2 className="break-words text-lg font-semibold">{target.displayName}</h2><p className="mt-2 break-all text-sm text-neutral-600">{target.email}</p><p className="mt-2">현재 권한: {target.role}</p>
        {target.id !== loaderData.currentUserId && target.verified ? <Form method="post" className="mt-4"><input type="hidden" name="targetUserId" value={target.id} /><input type="hidden" name="action" value={target.role === "ADMIN" ? "REVOKE_ADMIN" : "GRANT_ADMIN"} /><button className="rounded-xl border px-4 py-3">{target.role === "ADMIN" ? "관리자 권한 회수" : "관리자 권한 부여"} 미리보기</button></Form> : <p className="mt-4 text-sm text-neutral-600">본인 권한 변경과 이메일 미인증 계정의 권한 부여는 제한됩니다.</p>}
        <h3 className="mt-8 font-semibold">활성 로그인 세션</h3><ul className="mt-3 space-y-3">{loaderData.sessions.map((session) => <li key={session.ref} className="rounded-xl bg-neutral-50 p-3"><p className="text-sm">로그인: {new Date(session.createdAt).toLocaleString("ko-KR", { timeZone: "Asia/Seoul" })}</p>{session.isCurrent ? <p className="text-sm font-semibold">현재 세션 · 유지</p> : <Form method="post" className="mt-2"><input type="hidden" name="targetUserId" value={target.id} /><input type="hidden" name="action" value="REVOKE_SESSIONS" /><input type="hidden" name="selectedSessionRef" value={session.ref} /><button className="text-sm underline">이 세션 회수 미리보기</button></Form>}</li>)}</ul>
        {loaderData.sessions.some((session) => !session.isCurrent) && <Form method="post" className="mt-4"><input type="hidden" name="targetUserId" value={target.id} /><input type="hidden" name="action" value="REVOKE_SESSIONS" /><button className="rounded-xl border px-4 py-3">다른 활성 세션 모두 회수 미리보기</button></Form>}
      </section>}
    </div>
  </main>;
}
