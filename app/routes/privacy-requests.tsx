import { env } from "cloudflare:workers";
import { data, Form, Link, useNavigation } from "react-router";
import type { Route } from "./+types/privacy-requests";
import { requireUser } from "../features/auth/session.server";
import { isSameOriginMutation } from "../features/http/same-origin";
import { createPrivacyRequest, listOwnPrivacyRequests } from "../features/privacy/privacy-request.server";
import { privacyKindLabels, privacyStatusLabels, privacyTime } from "../features/privacy/privacy";

const PRIVATE = { "Cache-Control": "private, no-store", Vary: "Cookie", "X-Robots-Tag": "noindex, nofollow" };
export const headers: Route.HeadersFunction = () => PRIVATE;
export const meta: Route.MetaFunction = () => [{ title: "개인정보 요청 | Re:Taste" }];
export async function loader({ request }: Route.LoaderArgs) {
  const user = await requireUser(request);
  return data({ requests: await listOwnPrivacyRequests(env.DB, user.id) }, { headers: PRIVATE });
}
export async function action({ request }: Route.ActionArgs) {
  const user = await requireUser(request);
  if (!isSameOriginMutation(request)) return data({ message: "요청 출처를 확인할 수 없습니다." }, { status: 403, headers: PRIVATE });
  const form = await request.formData();
  try {
    const result = await createPrivacyRequest(env.DB, { userId: user.id, kind: String(form.get("kind") ?? ""), now: new Date().toISOString() });
    return data({ message: result.created ? "요청 유형을 접수했습니다. 아직 자료를 열람·정정·삭제하거나 처리를 정지하지 않았습니다." : "같은 유형의 요청을 이미 검토 중입니다. 기존 접수 상태를 확인해 주세요." }, { headers: PRIVATE });
  } catch {
    return data({ message: "요청을 접수하지 못했습니다. 로그인 계정의 인증 상태와 요청 유형을 확인해 주세요." }, { status: 400, headers: PRIVATE });
  }
}
export default function PrivacyRequests({ loaderData, actionData }: Route.ComponentProps) {
  const pending = useNavigation().state !== "idle";
  return <main id="main" className="legal shell"><h1>개인정보 요청</h1>
    <p>현재 로그인한 계정의 요청 유형만 접수합니다. 신분증·사진·추가 연락처를 올리는 기능은 제공하지 않습니다.</p>
    <p>접수는 처리 완료가 아닙니다. 자료별 보유기간과 추가 삭제 범위는 정책 확인이 필요하며, 확인되지 않은 처리 기한을 약속하지 않습니다.</p>
    <p><Link to="/me">나의 취향·계정 탈퇴</Link> · <Link to="/privacy">개인정보 처리방침</Link></p>
    {actionData?.message && <p role="status">{actionData.message}</p>}
    <Form method="post"><label>요청 유형<select name="kind">{Object.entries(privacyKindLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><button disabled={pending}>요청 유형 접수</button></Form>
    <h2>내 요청 · 최근 최대 20건</h2>
    {loaderData.requests.length ? <ul>{loaderData.requests.map((row) => <li key={row.id}><strong>{privacyKindLabels[row.kind]} · {privacyStatusLabels[row.status]}</strong><p>접수 {privacyTime(row.receivedAt)} · 갱신 {privacyTime(row.updatedAt)} (KST)</p><p style={{ overflowWrap: "anywhere" }}>접수 번호 {row.id}</p></li>)}</ul> : <p>접수한 요청이 없습니다.</p>}
  </main>;
}
