import { env } from "cloudflare:workers";
import { data, Form, Link, redirect } from "react-router";
import { z } from "zod";
import type { Route } from "./+types/login";
import { createDb } from "../db/client.server";
import { authenticateAccount } from "../features/auth/account.server";
import {
  AuthDivider,
  GoogleAuthButton,
  oauthErrorMessage,
} from "../features/auth/google-auth-ui";
import { publicLoginError, retainedAuthFields, safeReturnTo } from "../features/auth/login";
import { NaverAuthButton, naverOAuthErrorMessage } from "../features/auth/naver-auth-ui";
import { createUserSession, getOptionalUser } from "../features/auth/session.server";
import { ACCOUNT_RESTRICTED_MESSAGE, isAccountRestrictedError } from "../features/auth/member-access.server";
import { appendGuestTasteMergeCookie } from "../features/onboarding/guest-merge.server";
import { consumeLoginRateLimit, MAIL_RATE_LIMIT_MESSAGE } from "../features/security/rate-limit.server";

const schema = z.object({ email: z.email(), password: z.string().min(1), returnTo: z.string().optional() });
export function meta() { return [{ title: "로그인 — Re:Taste" }]; }
export async function loader({ request }: Route.LoaderArgs) {
  const url = new URL(request.url);
  if (await getOptionalUser(request)) return redirect(safeReturnTo(url.searchParams.get("returnTo")));
  return {
    returnTo: safeReturnTo(url.searchParams.get("returnTo")),
    oauthError:
      url.searchParams.get("oauthProvider") === "naver"
        ? naverOAuthErrorMessage(url.searchParams.get("oauthError"))
        : oauthErrorMessage(url.searchParams.get("oauthError")),
  };
}
export async function action({ request }: Route.ActionArgs) {
  const form = Object.fromEntries(await request.formData());
  const fields = retainedAuthFields(form);
  const parsed = schema.safeParse(form);
  if (!parsed.success) return data({ error: "이메일과 비밀번호를 확인해 주세요.", ...fields }, { status: 400 });
  try {
    const now = new Date();
    const db = createDb(env.DB);
    const limited = await consumeLoginRateLimit(db, {
      email: parsed.data.email,
      ip: request.headers.get("CF-Connecting-IP"),
      now,
    });
    if (!limited.ok) {
      return data({ error: MAIL_RATE_LIMIT_MESSAGE, ...fields }, {
        status: 429,
        headers: { "Retry-After": String(limited.retryAfterSeconds) },
      });
    }
    const user = await authenticateAccount(db, parsed.data);
    const headers = new Headers();
    headers.append("Set-Cookie", await createUserSession({ userId: user.id, now, requestUrl: request.url }));
    await appendGuestTasteMergeCookie({
      headers,
      db,
      request,
      userId: user.id,
      now: now.toISOString(),
    });
    return redirect(safeReturnTo(parsed.data.returnTo), { headers });
  } catch (error) {
    if (isAccountRestrictedError(error)) return data({ error: ACCOUNT_RESTRICTED_MESSAGE, ...fields }, { status: 403, headers: { "Cache-Control": "private, no-store", Vary: "Cookie" } });
    return data({ error: publicLoginError(error), ...fields }, { status: 400 });
  }
}
export default function Login({ actionData, loaderData }: Route.ComponentProps) {
  return <AuthPage eyebrow="WELCOME BACK" title="다시 취향을 이어가세요." description="가입한 이메일과 비밀번호로 로그인합니다.">
    {loaderData.oauthError && <p className="mt-8 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800" role="alert">{loaderData.oauthError}</p>}
    <div className="mt-8 grid gap-3"><GoogleAuthButton returnTo={loaderData.returnTo} /><NaverAuthButton returnTo={loaderData.returnTo} /></div>
    <AuthDivider />
    <Form method="post" action="/login" className="grid gap-5">
      <input type="hidden" name="returnTo" value={loaderData.returnTo} />
      <AuthInput label="이메일" name="email" type="email" autoComplete="email" defaultValue={actionData?.email} />
      <AuthInput label="비밀번호" name="password" type="password" autoComplete="current-password" />
      {actionData?.error && <p className="text-sm font-normal text-red-700">{actionData.error}</p>}
      <button className="rounded-full bg-neutral-950 px-5 py-3 font-semibold text-white">로그인</button>
    </Form><div className="mt-5 flex justify-between text-sm font-normal"><Link className="underline" to={loaderData.returnTo === "/" ? "/signup" : `/signup?returnTo=${encodeURIComponent(loaderData.returnTo)}`}>회원가입</Link><Link className="underline" to="/forgot-password">비밀번호 재설정</Link></div>
  </AuthPage>;
}
export function AuthPage({ eyebrow, title, description, children }: { eyebrow: string; title: string; description: string; children: React.ReactNode }) {
  return <main id="main" className="mx-auto min-h-screen max-w-xl px-6 py-20"><p className="mb-4 text-xs font-medium tracking-[0.2em] text-emerald-800">{eyebrow}</p><h1 className="text-[25.2px] font-semibold tracking-tight">{title}</h1><p className="mt-4 font-normal text-neutral-600">{description}</p>{children}<p className="mt-8 text-sm font-normal text-neutral-600">계속하면 <Link className="underline" to="/terms">이용약관</Link>과 <Link className="underline" to="/privacy">개인정보 처리방침</Link>에 동의하며, 만 14세 이상임을 확인합니다.</p></main>;
}
export function AuthInput(props: { label: string; name: string; type: string; autoComplete: string; defaultValue?: string }) {
  return <label className="grid gap-2"><span className="font-medium">{props.label}</span><input className="border border-neutral-300 bg-white px-4 py-3 font-normal" required {...props} /></label>;
}
