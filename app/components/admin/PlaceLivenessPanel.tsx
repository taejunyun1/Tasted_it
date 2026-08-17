import { Form, Link } from "react-router";

import {
  formatLivenessStatus,
  formatNaverStatus,
  formatReasonType,
  latestTimestamp,
  type LivenessFilter,
  type LivenessRow,
} from "../../features/places/place-operations-liveness";

function LivenessEvidenceView({ item }: { item: LivenessRow }) {
  const latestInternalActivity = latestTimestamp(item.evidence.reviewer.at, item.evidence.member.at);
  return <dl className="liveness-evidence">
    <div><dt>NAVER 상태</dt><dd>{formatNaverStatus(item.naverStatus)}</dd></div>
    <div><dt>일치 점수</dt><dd>{item.naverMatchScore ?? item.evidence.score.total ?? item.matchScore ?? "-"}</dd></div>
    <div><dt>근거 코드</dt><dd>{item.naverEvidenceCodes.length ? item.naverEvidenceCodes.join(" · ") : "미확인"}</dd></div>
    <div><dt>연속 미검색</dt><dd>{item.consecutiveNotFound}회</dd></div>
    <div><dt>최신 내부 활동</dt><dd>{latestInternalActivity ?? "없음"}</dd></div>
    <div><dt>활동 상태</dt><dd>검토 {item.evidence.reviewer.active ? "있음" : "없음"} · 회원 {item.evidence.member.active ? "있음" : "없음"} · 공개 {item.evidence.openSource.active ? "있음" : "없음"}</dd></div>
    <div><dt>공개 출처</dt><dd>{item.evidence.source ?? "-"}</dd></div>
    {item.protectedUntil && <div><dt>보호 종료</dt><dd>{item.protectedUntil}</dd></div>}
  </dl>;
}

export function PlaceLivenessPanel({
  livenessFilter,
  livenessRows,
}: {
  livenessFilter: LivenessFilter | null;
  livenessRows: LivenessRow[];
}) {
  return <section className="place-ops-section" aria-labelledby="liveness-heading">
    <h2 id="liveness-heading">영업 상태 재검증</h2>
    <div className="liveness-toolbar">
      <Form method="get" className="liveness-filters">
        <input type="hidden" name="tab" value="liveness" />
        <label>상태 필터
          <select name="liveness" defaultValue={livenessFilter ?? ""} aria-label="영업 상태 필터">
            <option value="">전체</option>
            <option value="SUSPECTED">운영 의심</option>
            <option value="HIDDEN">임시 숨김</option>
            <option value="ERROR">공급자 오류</option>
          </select>
        </label>
        <button>적용</button>
        <Link to="/admin/place-operations?tab=liveness">초기화</Link>
      </Form>
      <Form method="post" className="liveness-reset-form">
        <input type="hidden" name="intent" value="clear-recommendation-exclusions" />
        <input name="reason" aria-label="자동 추천 제외 해제 근거" placeholder="해제 근거" required maxLength={300} />
        <button className="secondary">자동 추천 제외 전체 해제</button>
      </Form>
    </div>
    {livenessRows.length ? livenessRows.map((item) => (
      <article className="ops-card liveness-card" key={`${item.caseId ?? "state"}-${item.placeId}`}>
        <div>
          <span>{formatReasonType(item.reasonType)} · {formatLivenessStatus(item.status)}</span>
          <h3>{item.placeName}</h3>
          <LivenessEvidenceView item={item} />
        </div>
        {item.caseId ? (
          <Form method="post" className="ops-form liveness-action-form">
            <input type="hidden" name="intent" value="resolve-liveness" />
            <input type="hidden" name="caseId" value={item.caseId} />
            <select name="resolution" aria-label={`${item.placeName} 검수 결과`}>
              <option value="OPEN">정상 영업</option>
              <option value="TEMPORARILY_CLOSED">임시 휴업</option>
              <option value="CLOSED">폐업</option>
              <option value="MOVED">이전</option>
            </select>
            <input name="reason" aria-label={`${item.placeName} 검수 근거`} placeholder="검수 근거" required maxLength={300} />
            <button>검수 반영</button>
          </Form>
        ) : <p className="liveness-readonly">자동 검증 상태</p>}
      </article>
    )) : <p>검수할 영업 상태가 없습니다.</p>}
  </section>;
}
