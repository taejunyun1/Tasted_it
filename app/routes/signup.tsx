import { env } from "cloudflare:workers";
import { data, Form, Link } from "react-router";
import { z } from "zod";
import type { Route } from "./+types/signup";
import { createDb } from "../db/client.server";
import { registerAccount } from "../features/auth/account.server";
import { sendAccountEmail } from "../features/auth/email.server";
import { AuthInput, AuthPage } from "./login";

const schema = z.object({ displayName: z.string().trim().min(2).max(40), email: z.email(), password: z.string().min(10) });
export async function action({ request }: Route.ActionArgs) {
  const parsed = schema.safeParse(Object.fromEntries(await request.formData()));
  if (!parsed.success) return data({ ok: false, message: "이름은 2자 이상, 비밀번호는 10자 이상 입력해 주세요." }, { status: 400 });
  try {
    const account = await registerAccount(createDb(env.DB), { ...parsed.data, adminEmail: env.ADMIN_EMAIL, now: new Date() });
    if (!env.RESEND_API_KEY || !env.RESEND_FROM_EMAIL) throw new Error("EMAIL_NOT_CONFIGURED");
    const baseUrl = env.APP_BASE_URL || new URL(request.url).origin;
    await sendAccountEmail({ apiKey: env.RESEND_API_KEY, from: env.RESEND_FROM_EMAIL, to: account.email, purpose: "VERIFY_EMAIL", url: `${baseUrl}/verify-email?token=${encodeURIComponent(account.token)}` });
  } catch (error) {
    if (error instanceof Error && error.message === "EMAIL_NOT_CONFIGURED") return data({ ok: false, message: "이메일 발송 설정이 필요합니다." }, { status: 503 });
  }
  return { ok: true, message: "가입 가능 여부와 관계없이 인증 안내가 등록된 이메일로 전송됩니다." };
}
export default function Signup({ actionData }: Route.ComponentProps) {
  return <AuthPage eyebrow="JOIN RE:TASTE" title="취향 기록을 시작하세요." description="이름, 이메일, 비밀번호만 입력합니다.">{actionData?.message ? <p className={`mt-8 border px-4 py-3 text-sm ${actionData.ok ? "border-emerald-600 bg-emerald-50" : "border-red-500 bg-red-50"}`}>{actionData.message}</p> : <Form method="post" className="mt-10 grid gap-5"><AuthInput label="이름" name="displayName" type="text" autoComplete="name" /><AuthInput label="이메일" name="email" type="email" autoComplete="email" /><AuthInput label="비밀번호 · 10자 이상" name="password" type="password" autoComplete="new-password" /><button className="bg-neutral-950 px-5 py-3 font-semibold text-white">인증 메일 받고 가입하기</button></Form>}<p className="mt-5 text-sm"><Link className="underline" to="/login">이미 계정이 있어요</Link></p></AuthPage>;
}
