import { env } from "cloudflare:workers";
import { data, Link } from "react-router";
import type { Route } from "./+types/reset-password";
import { TokenHashField } from "../components/auth/TokenHashField";
import { createDb } from "../db/client.server";
import { resetPassword } from "../features/auth/account.server";
import { authEntryHref, safeReturnTo } from "../features/auth/login";
import { AuthInput, AuthPage } from "./login";
import { AuthForm } from "../features/auth/auth-form";

export function loader({ request }: Route.LoaderArgs) {
  return { returnTo: safeReturnTo(new URL(request.url).searchParams.get("returnTo")) };
}

export async function action({ request }: Route.ActionArgs) {
  const form = await request.formData();
  try {
    await resetPassword(createDb(env.DB), {
      token: String(form.get("token") ?? ""),
      password: String(form.get("password") ?? ""),
      now: new Date(),
    });
    return { ok: true, message: "새 비밀번호가 저장되었습니다." };
  } catch (error) {
    if (error instanceof Error && (error.message === "TOKEN_INVALID" || error.message === "PASSWORD_TOO_SHORT")) {
      return data({ ok: false, message: "링크가 만료되었거나 비밀번호가 10자 미만입니다." }, { status: 400 });
    }
    return data({ ok: false, message: "비밀번호를 저장하지 못했습니다. 같은 링크에서 다시 시도해 주세요." }, { status: 503 });
  }
}

export default function Reset({ actionData, loaderData }: Route.ComponentProps) {
  return <AuthPage eyebrow="NEW PASSWORD" title="새 비밀번호 설정" description="이 링크는 한 번만 사용할 수 있습니다.">
    {actionData?.ok ? <div className="mt-8">
      <p role="status">{actionData.message}</p>
      <Link className="mt-3 inline-flex min-h-11 items-center underline" to={authEntryHref("/login", loaderData.returnTo)}>로그인하기</Link>
    </div> : <AuthForm id="reset-password" className="mt-10 grid gap-5" error={actionData?.message} submitLabel="비밀번호 저장" pendingLabel="비밀번호 저장 중…">
      <TokenHashField />
      <AuthInput label="새 비밀번호 · 10자 이상" name="password" type="password" autoComplete="new-password" minLength={10} />
    </AuthForm>}
  </AuthPage>;
}
