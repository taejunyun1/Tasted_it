import { env } from "cloudflare:workers";
import { data } from "react-router";
import type { Route } from "./+types/forgot-password";
import { createDb } from "../db/client.server";
import { requestPasswordReset } from "../features/auth/account.server";
import { sendAccountEmail } from "../features/auth/email.server";
import { accountActionUrl } from "../features/auth/token-link";
import { consumeMailRateLimit, MAIL_RATE_LIMIT_MESSAGE } from "../features/security/rate-limit.server";
import { AuthInput, AuthPage } from "./login";
import { AuthForm } from "../features/auth/auth-form";
export async function action({ request }: Route.ActionArgs) {
  const email = String((await request.formData()).get("email") ?? "").trim().toLowerCase();
  const db = createDb(env.DB);
  const limited = await consumeMailRateLimit(db, {
    route: "RESET_PASSWORD",
    email,
    ip: request.headers.get("CF-Connecting-IP"),
    now: new Date(),
  });
  if (!limited.ok) {
    return data({ ok: false, message: MAIL_RATE_LIMIT_MESSAGE, email: email.slice(0, 320) }, {
      status: 429,
      headers: { "Retry-After": String(limited.retryAfterSeconds) },
    });
  }
  const reset = await requestPasswordReset(db, { email, now: new Date() });
  if (reset && env.RESEND_API_KEY && env.RESEND_FROM_EMAIL) {
    const baseUrl = env.APP_BASE_URL || new URL(request.url).origin;
    await sendAccountEmail({ apiKey: env.RESEND_API_KEY, from: env.RESEND_FROM_EMAIL, to: reset.email, purpose: "RESET_PASSWORD", url: accountActionUrl(baseUrl, "/reset-password", reset.token) });
  }
  return { message: "가입된 이메일이라면 비밀번호 재설정 안내를 전송했습니다." };
}
export default function Forgot({ actionData }: Route.ComponentProps) {
  const failed = actionData && "ok" in actionData && actionData.ok === false;
  const sent = Boolean(actionData?.message) && !failed;
  return <AuthPage eyebrow="PASSWORD RESET" title="비밀번호를 새로 설정하세요." description="가입 이메일로 30분 유효한 재설정 링크를 보냅니다.">
    {sent ? <p className="mt-8 border border-emerald-600 bg-emerald-50 px-4 py-3 text-sm" role="status">{actionData?.message}</p>
      : <AuthForm id="forgot-password" className="mt-10 grid gap-5" error={failed ? actionData.message : undefined} submitLabel="재설정 메일 보내기" pendingLabel="재설정 안내 요청 중…">
        <AuthInput label="이메일" name="email" type="email" autoComplete="email" defaultValue={actionData && "email" in actionData ? actionData.email : undefined} />
      </AuthForm>}
  </AuthPage>;
}
