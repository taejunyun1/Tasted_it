import { env } from "cloudflare:workers";
import { useEffect, useRef, useState } from "react";
import { Link, useFetcher } from "react-router";
import type { Route } from "./+types/verify-correction";
import { readBrowserAccountToken } from "../components/auth/TokenHashField";
import { createDb } from "../db/client.server";
import { verifyPlaceCorrectionRequest } from "../features/places/place-correction.server";

export async function action({ request }: Route.ActionArgs) {
  const token = String((await request.formData()).get("token") ?? "");
  try {
    await verifyPlaceCorrectionRequest(createDb(env.DB), { token, now: new Date() });
    return { ok: true };
  } catch {
    return { ok: false };
  }
}

export default function VerifyCorrection({ actionData }: Route.ComponentProps) {
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
  const ok = result?.ok === true;
  return (
    <main id="main" className="operation-form shell" aria-busy={pending}>
      <p className="eyebrow">CORRECTION / VERIFICATION</p>
      <h1>{pending ? "정정 요청 확인 중" : ok ? "정정 요청이 접수됐습니다." : "확인 링크를 사용할 수 없습니다"}</h1>
      <p role={pending || ok ? "status" : "alert"}>{pending ? "링크를 확인하고 있습니다."
        : ok ? "관리자 검토 후 입력한 이메일을 통해 결과를 안내합니다."
          : missingToken ? "메일에 담긴 확인 링크를 끝까지 열어 주세요. 링크가 없거나 올바르지 않습니다."
            : "링크가 만료되었거나 이미 사용되었습니다."}</p>
      {!pending && !ok && <p><Link className="inline-flex min-h-11 items-center underline underline-offset-4" to="/corrections/new">정정 요청 다시 작성하기</Link></p>}
      <Link className="inline-flex min-h-11 items-center underline underline-offset-4" to="/">지도로 돌아가기</Link>
    </main>
  );
}
