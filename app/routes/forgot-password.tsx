import { env } from "cloudflare:workers";
import { data, Form } from "react-router";
import type { Route } from "./+types/forgot-password";
import { createDb } from "../db/client.server";
import { requestPasswordReset } from "../features/auth/account.server";
import { sendAccountEmail } from "../features/auth/email.server";
import { consumeMailRateLimit, MAIL_RATE_LIMIT_MESSAGE } from "../features/security/rate-limit.server";
import { AuthInput, AuthPage } from "./login";
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
    return data({ ok: false, message: MAIL_RATE_LIMIT_MESSAGE }, {
      status: 429,
      headers: { "Retry-After": String(limited.retryAfterSeconds) },
    });
  }
  const reset = await requestPasswordReset(db, { email, now: new Date() });
  if (reset && env.RESEND_API_KEY && env.RESEND_FROM_EMAIL) {
    const baseUrl = env.APP_BASE_URL || new URL(request.url).origin;
    await sendAccountEmail({ apiKey: env.RESEND_API_KEY, from: env.RESEND_FROM_EMAIL, to: reset.email, purpose: "RESET_PASSWORD", url: `${baseUrl}/reset-password?token=${encodeURIComponent(reset.token)}` });
  }
  return { message: "가입된 이메일이라면 비밀번호 재설정 안내를 전송했습니다." };
}
export default function Forgot({ actionData }: Route.ComponentProps) { return <AuthPage eyebrow="PASSWORD RESET" title="비밀번호를 새로 설정하세요." description="가입 이메일로 30분 유효한 재설정 링크를 보냅니다.">{actionData?.message ? <p className={`mt-8 border px-4 py-3 text-sm ${"ok" in actionData && actionData.ok === false ? "border-red-500 bg-red-50" : "border-emerald-600 bg-emerald-50"}`}>{actionData.message}</p> : <Form method="post" className="mt-10 grid gap-5"><AuthInput label="이메일" name="email" type="email" autoComplete="email" /><button className="bg-neutral-950 px-5 py-3 font-semibold text-white">재설정 메일 보내기</button></Form>}</AuthPage>; }
