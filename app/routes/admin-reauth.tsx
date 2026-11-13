import { env } from "cloudflare:workers";
import { data, Form, Link, redirect } from "react-router";
import type { Route } from "./+types/admin-reauth";
import { createAdminEmailChallenge, consumeAdminEmailChallenge, getAdminAssurance, reauthenticateAdminPassword } from "../features/auth/admin-assurance.server";
import { consumeAdminReauthRateLimit } from "../features/auth/admin-reauth-rate-limit.server";
import { startAdminOAuthReauth } from "../features/auth/admin-reauth-oauth.server";
import { sendAdminReauthEmail } from "../features/auth/admin-reauth-mail.server";
import { requireAdminSession } from "../features/auth/session.server";
import { isSameOriginMutation } from "../features/http/same-origin";

function adminReturnTo(value: unknown) {
  return typeof value === "string" && /^\/admin(?:[/?]|$)/.test(value) && !value.includes("\\") ? value : "/admin/identities";
}
const PRIVATE_HEADERS = { "Cache-Control": "private, no-store", Vary: "Cookie" };
export function headers() { return PRIVATE_HEADERS; }
export function ErrorBoundary() { return <main id="main" className="mx-auto max-w-xl px-6 py-12"><h1 className="text-2xl font-semibold">재인증을 시작할 수 없습니다.</h1><p className="mt-4">관리자 계정과 접속 상태를 확인해 주세요.</p><Link to="/admin" className="mt-6 inline-block underline">관리자 홈</Link></main>; }
export function meta() { return [{ title: "관리자 재인증 — Re:Taste" }]; }
export async function loader({ request }: Route.LoaderArgs) {
  const { user, sessionId } = await requireAdminSession(request);
  const account = await env.DB.prepare("SELECT password_hash IS NOT NULL AS hasPassword, email_verified_at IS NOT NULL AS hasEmail FROM users WHERE id = ?").bind(user.id).first<{ hasPassword: number; hasEmail: number }>();
  const providers = await env.DB.prepare("SELECT provider FROM auth_identities WHERE user_id = ?").bind(user.id).all<{ provider: string }>();
  const url = new URL(request.url);
  return data({
    hasPassword: !!account?.hasPassword, hasEmail: !!account?.hasEmail,
    providers: providers.results.map((row) => row.provider),
    assurance: await getAdminAssurance(env.DB, { actorUserId: user.id, sessionId, now: new Date() }),
    returnTo: adminReturnTo(url.searchParams.get("returnTo")),
    error: url.searchParams.get("error") === "google_fresh_auth"
      ? "Google에서 최근 인증 시각을 확인할 수 없습니다. 이메일 인증을 이용해 주세요."
      : url.searchParams.has("error") ? "재인증을 완료하지 못했습니다. 다시 시도해 주세요." : null,
  }, { headers: PRIVATE_HEADERS });
}
export async function action({ request }: Route.ActionArgs) {
  const { user, sessionId } = await requireAdminSession(request);
  if (!isSameOriginMutation(request)) return data({ error: "요청 출처를 확인할 수 없습니다.", challengeId: null }, { status: 403, headers: PRIVATE_HEADERS });
  if (Number(request.headers.get("Content-Length") ?? 0) > 4096) return data({ error: "입력값이 너무 깁니다.", challengeId: null }, { status: 413, headers: PRIVATE_HEADERS });
  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");
  const returnTo = adminReturnTo(form.get("returnTo"));
  const input = { actorUserId: user.id, sessionId, now: new Date() };
  if (!await consumeAdminReauthRateLimit(env.DB, { ...input, kind: intent === "email-send" ? "SEND" : "VERIFY", ip: request.headers.get("CF-Connecting-IP") })) {
    return data({ error: "요청이 너무 많습니다. 잠시 후 다시 시도해 주세요.", challengeId: null }, { status: 429, headers: PRIVATE_HEADERS });
  }
  try {
    if (intent === "password") {
      const password = String(form.get("password") ?? "");
      if (password.length > 1024) throw new Error("ADMIN_CREDENTIAL_INVALID");
      await reauthenticateAdminPassword(env.DB, { ...input, password });
    } else if (intent === "email-send") {
      if (!env.RESEND_API_KEY || !env.RESEND_FROM_EMAIL) throw new Error("ADMIN_EMAIL_UNAVAILABLE");
      const challenge = await createAdminEmailChallenge(env.DB, input);
      await sendAdminReauthEmail({ apiKey: env.RESEND_API_KEY, from: env.RESEND_FROM_EMAIL, to: challenge.email, code: challenge.code });
      return data({ error: null, challengeId: challenge.id }, { headers: PRIVATE_HEADERS });
    } else if (intent === "email-verify") {
      await consumeAdminEmailChallenge(env.DB, { ...input, id: String(form.get("challengeId") ?? ""), code: String(form.get("code") ?? "") });
    } else if (intent === "GOOGLE" || intent === "NAVER") {
      return await startAdminOAuthReauth(env.DB, { ...input, provider: intent, requestUrl: request.url, returnTo });
    } else throw new Error("ADMIN_CREDENTIAL_INVALID");
    return redirect(returnTo, { headers: PRIVATE_HEADERS });
  } catch {
    return data({ error: "재인증을 완료하지 못했습니다. 인증 정보 또는 이메일 코드를 확인해 주세요.", challengeId: intent === "email-verify" ? String(form.get("challengeId") ?? "") : null }, { status: 400, headers: PRIVATE_HEADERS });
  }
}
export default function AdminReauth({ loaderData, actionData }: Route.ComponentProps) {
  return <main id="main" className="mx-auto min-h-screen max-w-xl px-6 py-12">
    <Link to="/admin" className="text-sm underline">관리자 홈</Link>
    <h1 className="mt-6 text-2xl font-semibold">관리자 재인증</h1>
    <p className="mt-3 text-neutral-600">중요한 운영 변경 전 본인임을 확인합니다. 확인은 현재 브라우저 세션에서 10분 동안 유효합니다.</p>
    {loaderData.assurance && <p className="mt-4 rounded-xl bg-emerald-50 p-4">재인증이 유효합니다. <Link className="underline" to={loaderData.returnTo}>계속하기</Link></p>}
    {(actionData?.error || loaderData.error) && <p role="alert" className="mt-4 rounded-xl bg-red-50 p-4 text-red-800">{actionData?.error || loaderData.error}</p>}
    {loaderData.hasPassword && <Form method="post" className="mt-6 grid gap-3">
      <input type="hidden" name="intent" value="password" /><input type="hidden" name="returnTo" value={loaderData.returnTo} />
      <label className="grid gap-2">현재 비밀번호<input name="password" type="password" autoComplete="current-password" maxLength={1024} required className="rounded-xl border px-4 py-3" /></label>
      <button className="rounded-xl bg-neutral-950 px-5 py-3 text-white">비밀번호로 확인</button>
    </Form>}
    {loaderData.hasEmail && <section className="mt-8 border-t pt-6"><h2 className="font-semibold">이메일로 확인</h2>
      <p className="mt-2 text-sm text-neutral-600">등록된 인증 이메일로 8자리 코드를 보냅니다. 비밀번호는 변경되지 않습니다.</p>
      {actionData?.challengeId ? <Form method="post" className="mt-4 grid gap-3">
        <input type="hidden" name="intent" value="email-verify" /><input type="hidden" name="returnTo" value={loaderData.returnTo} /><input type="hidden" name="challengeId" value={actionData.challengeId} />
        <label className="grid gap-2">이메일 인증 코드<input name="code" autoComplete="one-time-code" inputMode="numeric" pattern="[0-9]{8}" maxLength={8} required className="rounded-xl border px-4 py-3" /></label>
        <button className="rounded-xl bg-neutral-950 px-5 py-3 text-white">코드 확인</button>
      </Form> : <Form method="post" className="mt-4"><input type="hidden" name="intent" value="email-send" /><input type="hidden" name="returnTo" value={loaderData.returnTo} /><button className="w-full rounded-xl border px-5 py-3">인증 코드 보내기</button></Form>}
    </section>}
    {loaderData.providers.length > 0 && <section className="mt-8 grid gap-3 border-t pt-6"><h2 className="font-semibold">연결된 계정으로 확인</h2>
      {loaderData.providers.map((provider) => <Form method="post" key={provider}><input type="hidden" name="intent" value={provider} /><input type="hidden" name="returnTo" value={loaderData.returnTo} /><button className="w-full rounded-xl border px-5 py-3">{provider === "GOOGLE" ? "Google" : "네이버"}에서 다시 인증</button></Form>)}
      {loaderData.providers.includes("GOOGLE") && <p className="text-sm text-neutral-600">Google에서 최근 인증 시각을 제공하지 않으면 위 이메일 인증을 이용하세요.</p>}
    </section>}
  </main>;
}
