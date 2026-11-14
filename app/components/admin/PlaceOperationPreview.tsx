import { Form, Link, useNavigation } from "react-router";

import { PLACE_ADMIN_CHANGE_LABELS, PLACE_ADMIN_IMPACT_LABELS, type PlaceAdminView } from "../../features/places/place-admin";

const statusLabels: Record<string, string> = { DRAFT: "비공개 초안", PUBLISHED: "공개", HIDDEN: "숨김" };
const roleLabels = { TARGET: "남길 장소", SOURCE: "흡수할 장소", PLACE: "대상 장소" };
type ImpactKey = keyof typeof PLACE_ADMIN_IMPACT_LABELS;
const connectionKeys = new Set<string>(["generalVotes", "reviewerVotes", "memberSaves", "guestSaves", "reviewPhotos", "reviews", "sourceLinks", "corrections", "categories"]);
const isCondition = (key: string) => /^(target|source)(Public|Recommendation|ReviewerEligibility)(Before|After)$/.test(key);
const isVisibleCount = (key: string) => /^(target|source)(ReviewsVisible|ReviewPhotosVisible)(Before|After)$/.test(key);
function ImpactRows({ keys, impact }: { keys: ImpactKey[]; impact: PlaceAdminView["impact"] }) {
  return <dl className="liveness-evidence">{keys.map((key) => {
    const value = impact[key]!;
    const label = PLACE_ADMIN_IMPACT_LABELS[key].replace(/ · 현재$/, " · 변경 전");
    const formatted = value === -1 ? "확인 불가" : isCondition(key) ? value === 1 ? "충족" : value === 0 ? "미충족" : "확인 불가" : `${value.toLocaleString()}건`;
    return <div key={key} style={{ gridTemplateColumns: "minmax(0, 1fr) auto", gap: 12 }}><dt>{label}</dt><dd>{formatted}</dd></div>;
  })}</dl>;
}
function kst(value: string) {
  return new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", dateStyle: "short", timeStyle: "short" }).format(new Date(value));
}

export function PlaceOperationPreview({ view }: { view?: PlaceAdminView | null }) {
  const pending = useNavigation().state !== "idle";
  if (!view) return null;
  const committed = view.status === "COMMITTED";
  const stale = !committed && view.stale === true;
  const operationUrl = `/admin/place-operations?${new URLSearchParams({ operation: view.operationId })}`;
  const impactKeys = (Object.keys(PLACE_ADMIN_IMPACT_LABELS) as ImpactKey[]).filter((key) => typeof view.impact[key] === "number" && Number.isFinite(view.impact[key]));
  const conditions = impactKeys.filter(isCondition);
  const visibleCounts = impactKeys.filter(isVisibleCount);
  const movements = impactKeys.filter((key) => !connectionKeys.has(key) && !isCondition(key) && !isVisibleCount(key));
  const connections = impactKeys.filter((key) => connectionKeys.has(key));
  return <section className="place-ops-section" aria-labelledby="place-operation-title">
    <h2 id="place-operation-title">{committed ? "장소 변경 확정 영수증" : "장소 변경 미리보기"}</h2>
    <p><strong>{PLACE_ADMIN_CHANGE_LABELS[view.change]}</strong></p>
    {view.change === "MERGE" && <p>흡수할 장소의 연결 원천이 남길 장소로 옮겨지며, 남길 장소의 노출·추천 자격도 달라질 수 있습니다. 사진 파일과 리뷰 원문은 보존합니다. 병합을 자동으로 되돌리는 기능은 제공하지 않습니다.</p>}
    {(view.change === "RECALL" || view.change === "RESTORE_RECALL") && <p>공개 상태를 변경하고 사진 파일·리뷰 원문·연결 기록을 보존합니다. 공개 목록·상세와 저장 목록은 서로 다른 표시 기준을 사용합니다.</p>}
    <p className="ops-form-help">추천 후보 자격과 개인별 추천 순위는 별도로 결정됩니다.</p>
    <p style={{ overflowWrap: "anywhere" }}>작업 번호 <code>{view.operationId}</code></p>
    {committed
      ? view.result
        ? <p role="status">요청 {view.result.requestedCount}건 · 적용 {view.result.appliedCount}건 · 건너뜀 {view.result.skippedCount}건. 이 작업은 이미 확정됐습니다.</p>
        : <p role="alert">확정 영수증의 결과를 확인할 수 없습니다. 작업 번호로 변경 이력을 확인해 주세요.</p>
      : <p>아직 변경되지 않았습니다. 대상과 상태 변화를 확인한 뒤 확정하세요. 미리보기 만료 {kst(view.expiresAt)} KST.</p>}
    {stale && <p role="alert">근거가 변경되어 새 미리보기가 필요합니다. 대상과 연결 자료를 다시 확인해 주세요.</p>}
    <div>
      {view.targets.map((target) => <article className="ops-revision" key={`${target.role}-${target.id}`} style={{ display: "block", overflowWrap: "anywhere" }}>
        <p><strong>{roleLabels[target.role]} · {target.name}</strong></p>
        <p>{target.address}</p>
        <p>장소 ID <code>{target.id}</code></p>
        <p>{committed ? <>현재 상태: {statusLabels[target.status] ?? "상태 확인 필요"} · 확정 요청 상태: {statusLabels[target.afterStatus] ?? "상태 확인 필요"}</> : <>현재 조회: {statusLabels[target.status] ?? "상태 확인 필요"} → 변경 예정: {statusLabels[target.afterStatus] ?? "상태 확인 필요"}</>}</p>
      </article>)}
    </div>
    <p className="ops-form-help">아래 조건과 영향은 미리보기를 준비한 시점 기준입니다. 근거가 달라지면 새 미리보기가 필요합니다.</p>
    {conditions.length > 0 && <><h3>공개·추천·리뷰어 참여 조건</h3><ImpactRows keys={conditions} impact={view.impact} /></>}
    {visibleCounts.length > 0 && <><h3>공개 방문 기록·사진</h3><ImpactRows keys={visibleCounts} impact={view.impact} /></>}
    {movements.length > 0 && <><h3>이동·보존 영향</h3><ImpactRows keys={movements} impact={view.impact} /></>}
    {connections.length > 0 && <details><summary>미리보기 당시 연결 정보 {connections.length}항목</summary><p className="ops-form-help">기존 연결 건수이며 이동·삭제 건수를 뜻하지 않습니다.</p><ImpactRows keys={connections} impact={view.impact} /></details>}
    {!committed && !stale && <>
      <p>확정할 때 현재 관리자 권한, 최근 인증, 대상의 최신 상태를 다시 확인합니다.</p>
      <Form method="post" action={operationUrl} className="ops-form">
        <input type="hidden" name="intent" value="confirm-place-operation" />
        <input type="hidden" name="operationId" value={view.operationId} />
        <button disabled={pending}>장소 변경 확정</button>
        <Link to={`/admin/reauth?${new URLSearchParams({ returnTo: operationUrl })}`}>관리자 재인증 후 돌아오기</Link>
      </Form>
    </>}
    {committed && view.change === "RECALL" && view.result && <>
      <h3>이 공개 회수 복원</h3>
      <p>회수 직전 공개 상태로의 복원을 먼저 검토합니다. 회수 이후 대상이 변경됐다면 새 상태를 확인해야 합니다.</p>
      <Form method="post" action={operationUrl} className="ops-form">
        <input type="hidden" name="intent" value="restore-recall" />
        <input type="hidden" name="recallOperationId" value={view.operationId} />
        <label>회수 복원 사유<input name="reason" required maxLength={300} /></label>
        <button disabled={pending}>회수 복원 미리보기</button>
      </Form>
    </>}
    <p><Link to="/admin/place-operations">장소 검수로 돌아가기</Link> · <Link to="/admin/places">장소 목록</Link></p>
  </section>;
}
