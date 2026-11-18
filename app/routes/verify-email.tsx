import { env } from "cloudflare:workers";
import { useEffect, useRef, useState } from "react";
import { Link, useFetcher } from "react-router";
import type { Route } from "./+types/verify-email";
import { readBrowserAccountToken } from "../components/auth/TokenHashField";
import { createDb } from "../db/client.server";
import { verifyEmailToken } from "../features/auth/account.server";
import { safeReturnTo } from "../features/auth/login";
import { verificationLoginHref } from "../features/auth/verification-link";

export function loader({ request }: Route.LoaderArgs) {
  return { returnTo: safeReturnTo(new URL(request.url).searchParams.get("returnTo")) };
}

export async function action({ request }: Route.ActionArgs) {
  const token = String((await request.formData()).get("token") ?? "");
  try {
    await verifyEmailToken(createDb(env.DB), { token, now: new Date() });
    return { ok: true };
  } catch {
    return { ok: false };
  }
}

export default function VerifyEmail({ actionData, loaderData }: Route.ComponentProps) {
  const fetcher = useFetcher<typeof action>();
  const submitted = useRef(false);
  const [missingToken, setMissingToken] = useState(false);
  useEffect(() => {
    if (submitted.current || actionData || fetcher.data) return;
    submitted.current = true;
    const token = readBrowserAccountToken();
    if (!token) {
      setMissingToken(true);
      return;
    }
    fetcher.submit({ token }, { method: "post" });
  }, [actionData, fetcher]);

  const result = actionData ?? fetcher.data;
  const pending = !missingToken && !result;
  return (
    <main id="main" className="mx-auto min-h-screen max-w-xl px-6 py-20" aria-busy={pending}>
      <h1 className="text-[25.2px] font-semibold">
        {pending ? "이메일 인증 확인 중" : result?.ok ? "이메일 인증 완료" : "인증 링크를 사용할 수 없습니다"}
      </h1>
      <p className="mt-4 text-neutral-600" role={pending || result?.ok ? "status" : "alert"}>
        {pending
          ? "링크를 확인하고 있습니다."
          : result?.ok
            ? "이제 로그인하고 취향을 기록할 수 있습니다."
            : missingToken ? "메일에 담긴 인증 링크를 끝까지 열어 주세요. 링크가 없거나 올바르지 않습니다."
              : "링크가 만료되었거나 이미 사용되었습니다."}
      </p>
      <Link className="mt-8 inline-block bg-neutral-950 px-5 py-3 text-white" to={verificationLoginHref(loaderData.returnTo)}>로그인으로</Link>
    </main>
  );
}
