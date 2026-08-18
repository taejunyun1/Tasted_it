import { env } from "cloudflare:workers";
import { useEffect, useRef } from "react";
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
  useEffect(() => {
    if (submitted.current || actionData || fetcher.data) return;
    const token = readBrowserAccountToken();
    if (!token) return;
    submitted.current = true;
    fetcher.submit({ token }, { method: "post" });
  }, [actionData, fetcher]);

  const result = actionData ?? fetcher.data;
  const ok = result?.ok !== false;
  return (
    <main id="main" className="operation-form shell">
      <p className="eyebrow">VERIFIED</p>
      <h1>{result ? (ok ? "정정 요청이 접수됐습니다." : "확인 링크를 사용할 수 없습니다") : "정정 요청 확인 중"}</h1>
      <p>{result
        ? (ok ? "관리자 검토 후 입력한 이메일을 통해 결과를 안내합니다." : "링크가 만료되었거나 이미 사용되었습니다.")
        : "링크를 확인하고 있습니다."}</p>
      <Link to="/">지도로 돌아가기</Link>
    </main>
  );
}
