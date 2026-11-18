import { env } from "cloudflare:workers";
import { data, Link } from "react-router";
import { z } from "zod";
import type { Route } from "./+types/signup";
import { createDb } from "../db/client.server";
import { registerAccount } from "../features/auth/account.server";
import { sendAccountEmail } from "../features/auth/email.server";
import { AuthDivider, GoogleAuthButton } from "../features/auth/google-auth-ui";
import { retainedAuthFields, safeReturnTo } from "../features/auth/login";
import { describeSignupFailure } from "../features/auth/signup-failure";
import { verificationEmailUrl } from "../features/auth/verification-link";
import { consumeMailRateLimit, MAIL_RATE_LIMIT_MESSAGE } from "../features/security/rate-limit.server";
import { AuthInput, AuthPage } from "./login";
import { NaverAuthButton } from "../features/auth/naver-auth-ui";
import { AuthForm } from "../features/auth/auth-form";

const schema = z.object({ displayName: z.string().trim().min(2).max(40), email: z.email(), password: z.string().min(10) });
export function meta() { return [{ title: "회원가입 — Re:Taste" }]; }
export async function loader({ request }: Route.LoaderArgs) {
  return { returnTo: safeReturnTo(new URL(request.url).searchParams.get("returnTo")) };
}
export async function action({ request }: Route.ActionArgs) {
  const form = Object.fromEntries(await request.formData());
  const fields = retainedAuthFields(form);
  const returnTo = safeReturnTo(typeof form.returnTo === "string"
    ? form.returnTo : new URL(request.url).searchParams.get("returnTo"));
  if (String(form.ageConfirmed ?? "") !== "yes") {
    return data({ ok: false, message: "만 14세 이상만 가입할 수 있습니다.", ...fields }, { status: 400 });
  }
  const parsed = schema.safeParse(form);
  if (!parsed.success) return data({ ok: false, message: "이름은 2자 이상, 비밀번호는 10자 이상 입력해 주세요.", ...fields }, { status: 400 });
  const limited = await consumeMailRateLimit(createDb(env.DB), {
    route: "SIGNUP",
    email: parsed.data.email,
    ip: request.headers.get("CF-Connecting-IP"),
    now: new Date(),
  });
  if (!limited.ok) {
    return data({ ok: false, message: MAIL_RATE_LIMIT_MESSAGE, ...fields }, {
      status: 429,
      headers: { "Retry-After": String(limited.retryAfterSeconds) },
    });
  }
  try {
    const account = await registerAccount(createDb(env.DB), { ...parsed.data, adminEmail: env.ADMIN_EMAIL, now: new Date() });
    if (!env.RESEND_API_KEY || !env.RESEND_FROM_EMAIL) throw new Error("EMAIL_NOT_CONFIGURED");
    const baseUrl = env.APP_BASE_URL || new URL(request.url).origin;
    await sendAccountEmail({ apiKey: env.RESEND_API_KEY, from: env.RESEND_FROM_EMAIL, to: account.email, purpose: "VERIFY_EMAIL", url: verificationEmailUrl(baseUrl, account.token, returnTo) });
  } catch (error) {
    const failure = describeSignupFailure(error);
    console.error("SIGNUP_FAILED", failure.logCode);
    return data({ ok: failure.ok, message: failure.message, ...fields }, { status: failure.status });
  }
  return { ok: true, message: "가입 가능 여부와 관계없이 인증 안내가 등록된 이메일로 전송됩니다.", email: "", displayName: "" };
}
export default function Signup({ actionData, loaderData }: Route.ComponentProps) {
  return <AuthPage eyebrow="JOIN RE:TASTE" title="취향 기록을 시작하세요." description="Google·네이버 계정 또는 이메일로 간단하게 시작합니다."><div className="mt-8 grid gap-3"><GoogleAuthButton returnTo={loaderData.returnTo} /><NaverAuthButton returnTo={loaderData.returnTo} /></div><AuthDivider />{actionData?.ok && <p className="mb-5 rounded-2xl border border-emerald-600 bg-emerald-50 px-4 py-3 text-sm" role="status">{actionData.message}</p>}{actionData?.ok ? null : <AuthForm id="signup" className="grid gap-5" error={actionData?.message} submitLabel="인증 메일 받고 가입하기" pendingLabel="가입 안내 요청 중…"><AuthInput label="이름" name="displayName" type="text" autoComplete="name" minLength={2} maxLength={40} defaultValue={actionData?.displayName} /><AuthInput label="이메일" name="email" type="email" autoComplete="email" defaultValue={actionData?.email} /><AuthInput label="비밀번호 · 10자 이상" name="password" type="password" autoComplete="new-password" minLength={10} /><label className="flex min-h-11 items-start gap-2 text-sm font-normal text-neutral-700"><input name="ageConfirmed" type="checkbox" value="yes" required className="mt-1" /><span>만 14세 이상입니다. 생년월일은 받지 않습니다.</span></label></AuthForm>}<p className="mt-5 text-sm"><Link className="inline-flex min-h-11 items-center underline" to={loaderData.returnTo === "/" ? "/login" : `/login?returnTo=${encodeURIComponent(loaderData.returnTo)}`}>이미 계정이 있어요</Link></p></AuthPage>;
}
