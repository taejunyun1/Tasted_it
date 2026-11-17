import { env } from "cloudflare:workers";
import { data, Form, isRouteErrorResponse, Link } from "react-router";
import { ZodError } from "zod";
import type { Route } from "./+types/admin-rating-config";
import { createDb } from "../db/client.server";
import { requireAdminSession } from "../features/auth/session.server";
import { readAdminRatingConfig } from "../features/ratings/admin-rating-config.server";
import { previewRatingConfig } from "../features/ratings/rating-config-preview";
import "../styles/admin-home.css";
import "../styles/admin-rating-config.css";

const PRIVATE = { "Cache-Control": "private, no-store", Vary: "Cookie", "X-Robots-Tag": "noindex, nofollow" };
const DEFAULTS = { minimumVisibleSamples: 8, alphaPrior: 2, betaPrior: 2, reviewerMaxShare: 0.3, userPositive: 6, userNegative: 2, reviewerPositive: 8, reviewerNegative: 0 };
export const headers: Route.HeadersFunction = () => PRIVATE;
export const meta: Route.MetaFunction = () => [{ title: "평가 설정 비교 | Re:Taste" }, { name: "robots", content: "noindex, nofollow" }];
export async function loader({ request }: Route.LoaderArgs) {
  await requireAdminSession(request);
  try {
    const url = new URL(request.url), entries = [...url.searchParams];
    if (url.search.length > 2048 || new Set(entries.map(([key]) => key)).size !== entries.length) throw new Response(null, { status: 400, headers: PRIVATE });
    const preview = previewRatingConfig(entries.length ? Object.fromEntries(entries) : DEFAULTS);
    const config = await readAdminRatingConfig(createDb(env.DB), new Date().toISOString());
    return data({ ...config, preview }, { headers: PRIVATE });
  } catch (error) {
    if (error instanceof Response) throw error;
    throw new Response(null, { status: error instanceof ZodError ? 400 : 503, headers: PRIVATE });
  }
}
export async function action({ request }: Route.ActionArgs) {
  await requireAdminSession(request);
  return new Response(null, { status: 405, headers: { ...PRIVATE, Allow: "GET, HEAD" } });
}
const WARNINGS: Record<string, string> = {
  NO_SELECTED_CONFIG: "현재 실행 경로가 선택할 설정 메타데이터가 없습니다.",
  SELECTED_FUTURE_CONFIG: "미래 시작일의 메타데이터가 현재 선택되고 있습니다. 실제 산식은 아래 코드 기준입니다.",
  SELECTED_INVALID_TIME: "선택된 설정의 적용 시각을 확인할 수 없습니다.",
  SELECTED_UNSUPPORTED_VERSION: "선택된 버전과 실제 계산 버전이 다릅니다. 새 산식이 적용됐다는 의미가 아닙니다.",
  SELECTED_POLICY_DIFFERS: "저장값과 점수 계산값이 다릅니다. 최소 표본 저장값은 신뢰 비교에만 사용되므로 영향 범위를 구분하세요.",
};
const STATE = { FUTURE: "시작 전", ENDED: "종료", CURRENT_WINDOW: "적용 기간 안", INVALID_TIME: "시각 확인 필요" };
const countFields = [["userPositive", "일반 긍정"], ["userNegative", "일반 부정"], ["reviewerPositive", "리뷰어 긍정"], ["reviewerNegative", "리뷰어 부정"]] as const;
const policyFields = [["minimumVisibleSamples", "최소 공개 표본", 1, 100, 1], ["alphaPrior", "사전값 α", 0.01, 100, 0.01], ["betaPrior", "사전값 β", 0.01, 100, 0.01], ["reviewerMaxShare", "리뷰어 비중 상한", 0, 0.95, 0.01]] as const;
const percent = (value: number) => `${(value * 100).toFixed(1)}%`;
export default function AdminRatingConfig({ loaderData: state }: Route.ComponentProps) {
  const { preview } = state;
  return <main id="main" className="admin-home rating-config">
    <header className="admin-home__header"><div><p className="admin-home__eyebrow">RE:TASTE / ADMIN</p><h1>평가 설정 비교</h1><p>현재 계산 기준과 저장된 설정을 확인하고 합성 표본으로만 비교합니다.</p></div><Link to="/admin/ratings">평가 운영</Link></header>
    {state.warnings.length > 0 && <section role="status" aria-label="설정 확인 사항"><h2>설정 확인 사항</h2><ul>{state.warnings.map(code => <li key={code}>{WARNINGS[code]}</li>)}</ul></section>}
    <section aria-labelledby="effective-title"><h2 id="effective-title">현재 실효 기준</h2><p>실제 점수 산식 <strong>{state.effectiveVersion}</strong> · 선택 메타데이터 <code>{state.selectedConfigId ?? "없음"}</code></p>
      <div className="rating-config__scroll" tabIndex={0} role="region" aria-label="실효값과 저장값 비교"><table><thead><tr><th>항목</th><th>점수 계산값</th><th>선택 DB값</th><th>DB값의 실제 소비</th></tr></thead><tbody>{state.fields.map(field => <tr key={field.key}><th scope="row">{field.label}</th><td>{field.runtimeValue}</td><td>{field.selectedValue ?? "없음"}{field.matching === false && " · 차이 있음"}</td><td>{field.databaseConsumer === "REVIEWER_CONSENSUS" ? "리뷰어 신뢰 비교에 사용할 일반표의 최소 수" : "설정 메타데이터 · 점수 계산은 코드값 사용"}</td></tr>)}</tbody></table></div>
      <p>신뢰 보정은 비교 표본 5개 미만에서 1.0, 이후 0.6–1.4입니다. 유사도는 겹침 10개·일치 80%와 1/√k 감쇠를 유지합니다.</p>
    </section>
    <section aria-labelledby="preview-title"><h2 id="preview-title">합성 영향 비교</h2><p>후보값은 저장하거나 활성화하지 않습니다. 모든 리뷰어의 신뢰·감쇠 가중치는 1로 고정하며, 공개 적격성·신뢰 재보정·군집 변화는 예측하지 않습니다.</p>
      <Form method="get" className="rating-config__form"><fieldset><legend>합성 표본 · 총 400표 이하</legend>{countFields.map(([key, label]) => <label key={key}>{label}<input name={key} type="number" min="0" max="200" step="1" required defaultValue={preview.input[key]} key={`${key}-${preview.input[key]}`}/></label>)}</fieldset><fieldset><legend>비교할 후보값 · 운영 정책 아님</legend>{policyFields.map(([key, label, min, max, step]) => <label key={key}>{label}<input name={key} type="number" min={min} max={max} step={step} required defaultValue={preview.input[key]} key={`${key}-${preview.input[key]}`}/></label>)}</fieldset><button type="submit">합성 표본 비교</button></Form>
      <div className="rating-config__scroll" tabIndex={0} role="region" aria-label="합성 비교 결과"><table><thead><tr><th>합성 결과</th><th>현재 코드 기준</th><th>후보값</th></tr></thead><tbody><tr><th scope="row">전체 점수</th><td>{preview.baseline.overall.displayScore ?? "표본 부족"}</td><td>{preview.candidate.overall.displayScore ?? "표본 부족"}</td></tr><tr><th scope="row">점수 표시 기준</th><td>{preview.baseline.overall.sampleStatus === "VISIBLE" ? "표본 충족" : "표본 부족"}</td><td>{preview.candidate.overall.sampleStatus === "VISIBLE" ? "표본 충족" : "표본 부족"}</td></tr><tr><th scope="row">리뷰어 실효 비중</th><td>{percent(preview.baseline.reviewerWeightShare)}</td><td>{percent(preview.candidate.reviewerWeightShare)}</td></tr></tbody></table></div>
      <p role="status">점수 차이 {preview.scoreDelta === null ? "비교 불가 · 표본 부족" : preview.scoreDelta} · 표시 기준 변경 {preview.visibilityChanged ? "있음" : "없음"}. 실제 설정·점수·표·재계산 작업은 변경하지 않았습니다.</p>
    </section>
    <section aria-labelledby="versions-title"><h2 id="versions-title">저장된 버전 메타데이터</h2>{state.configs.length === 0 ? <p>저장된 설정이 없습니다.</p> : <ul className="rating-config__versions">{state.configs.map(config => <li key={config.id}><strong>{config.algorithmVersion}</strong><p><code>{config.id}</code> · {STATE[config.state]}{config.selectedByRuntime && " · 현재 실행 경로가 선택"}{!config.versionSupported && " · 계산 버전과 다름"}{!config.policyMatches && " · 점수 기준과 값이 다름"}</p><p>시작 {config.activeFrom} · 종료 {config.activeUntil ?? "미지정"}</p></li>)}</ul>}{state.truncated && <p>최신 50건만 표시했습니다. 전체 목록이 아닙니다.</p>}<p className="admin-home__note">정책 결정 필요: 설정 활성화·복원은 제공하지 않습니다. 설정의 날짜·버전 선택 일관성을 먼저 확인해야 합니다.</p></section>
  </main>;
}
export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  const status = isRouteErrorResponse(error) ? error.status : 503;
  return <main id="main" className="admin-home"><h1>{status === 400 ? "비교 입력을 확인해 주세요." : status === 403 ? "관리자만 조회할 수 있습니다." : "평가 설정을 불러올 수 없습니다."}</h1><p>{status === 400 ? "모든 항목에 허용 범위의 숫자를 입력해 주세요. 중복·알 수 없는 항목은 사용할 수 없습니다." : "잠시 후 다시 조회해 주세요."}</p><Link to="/admin/rating-config">기본 합성 표본으로 돌아가기</Link></main>;
}
