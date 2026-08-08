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
import { safeReturnTo } from "../features/auth/login";
import { createUserSession, getOptionalUser } from "../features/auth/session.server";

const schema = z.object({ email: z.email(), password: z.string().min(1), returnTo: z.string().optional() });
export function meta() { return [{ title: "로그인 — Re:Taste" }]; }
export async function loader({ request }: Route.LoaderArgs) {
  if (await getOptionalUser(request)) return redirect("/");
  const url = new URL(request.url);
  return {
    returnTo: safeReturnTo(url.searchParams.get("returnTo")),
    oauthError: oauthErrorMessage(url.searchParams.get("oauthError")),
  };
}
export async function action({ request }: Route.ActionArgs) {
  const parsed = schema.safeParse(Object.fromEntries(await request.formData()));
  if (!parsed.success) return data({ error: "이메일과 비밀번호를 확인해 주세요." }, { status: 400 });
  try {
    const now = new Date();
    const user = await authenticateAccount(createDb(env.DB), parsed.data);
    const cookie = await createUserSession({ userId: user.id, now, requestUrl: request.url });
    return redirect(safeReturnTo(parsed.data.returnTo), { headers: { "Set-Cookie": cookie } });
  } catch (error) {
    return data({ error: error instanceof Error && error.message === "EMAIL_NOT_VERIFIED" ? "이메일 인증을 먼저 완료해 주세요." : "이메일 또는 비밀번호가 올바르지 않습니다." }, { status: 400 });
  }
}
export default function Login({ actionData, loaderData }: Route.ComponentProps) {
  return <AuthPage eyebrow="WELCOME BACK" title="다시 취향을 이어가세요." description="가입한 이메일과 비밀번호로 로그인합니다.">
    {loaderData.oauthError && <p className="mt-8 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800" role="alert">{loaderData.oauthError}</p>}
    <div className="mt-8"><GoogleAuthButton returnTo={loaderData.returnTo} /></div>
    <AuthDivider />
    <Form method="post" action="/login" className="grid gap-5">
      <input type="hidden" name="returnTo" value={loaderData.returnTo} />
      <AuthInput label="이메일" name="email" type="email" autoComplete="email" />
      <AuthInput label="비밀번호" name="password" type="password" autoComplete="current-password" />
      {actionData?.error && <p className="text-sm font-normal text-red-700">{actionData.error}</p>}
      <button className="rounded-full bg-neutral-950 px-5 py-3 font-semibold text-white">로그인</button>
    </Form><div className="mt-5 flex justify-between text-sm font-normal"><Link className="underline" to="/signup">회원가입</Link><Link className="underline" to="/forgot-password">비밀번호 재설정</Link></div>
  </AuthPage>;
}
export function AuthPage({ eyebrow, title, description, children }: { eyebrow: string; title: string; description: string; children: React.ReactNode }) {
  return <main id="main" className="mx-auto min-h-screen max-w-xl px-6 py-20"><p className="mb-4 text-xs font-medium tracking-[0.2em] text-emerald-800">{eyebrow}</p><h1 className="text-4xl font-semibold tracking-tight">{title}</h1><p className="mt-4 font-normal text-neutral-600">{description}</p>{children}<p className="mt-8 text-sm font-normal text-neutral-600">계속하면 <Link className="underline" to="/terms">이용약관</Link>과 <Link className="underline" to="/privacy">개인정보 처리방침</Link>에 동의합니다.</p></main>;
}
export function AuthInput(props: { label: string; name: string; type: string; autoComplete: string }) {
  return <label className="grid gap-2"><span className="font-medium">{props.label}</span><input className="border border-neutral-300 bg-white px-4 py-3 font-normal" required {...props} /></label>;
}
