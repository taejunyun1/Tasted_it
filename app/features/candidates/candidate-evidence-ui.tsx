import type { CandidateNaverEvidence } from "./bulk-review.server";

type EvidenceRow = {
  id: string;
  businessName: string;
  businessSubtype: string | null;
  address: string;
  naverEvidence: CandidateNaverEvidence;
};

const statusLabel: Record<NonNullable<CandidateNaverEvidence["status"]>, string> = {
  VERIFIED: "검증됨",
  LIKELY: "추가 확인",
  AMBIGUOUS: "후보 충돌",
  NO_MATCH: "일치 없음",
  OUT_OF_SCOPE: "지역 밖",
  FAILED: "조회 실패",
  SKIPPED: "대기",
};

const evidenceLabel: Record<string, string> = {
  NAVER_EXACT_NAME: "상호 일치",
  NAVER_BRANCH_NORMALIZED_NAME: "지점명 정규화",
  NAVER_EXACT_ADDRESS: "주소 일치",
  NAVER_COORDINATES_WITHIN_100M: "100m 이내",
  NAVER_SPECIFIC_CATEGORY: "NAVER 상세 카테고리",
  NAVER_BROAD_CATEGORY: "NAVER 넓은 카테고리",
  SOURCE_SUBTYPE_MATCH: "원천 업태 일치",
  SOURCE_SUBTYPE_CONFLICT: "원천 업태 충돌",
  NAME_FOOD_MATCH: "상호 음식명 일치",
};

export function EvidenceStatusRail({ rows }: { rows: EvidenceRow[] }) {
  const counts = rows.reduce<Record<string, number>>((result, row) => {
    const key = row.naverEvidence.status ?? "UNVERIFIED";
    result[key] = (result[key] ?? 0) + 1;
    return result;
  }, {});
  const items = [
    ["VERIFIED", "검증됨"],
    ["UNVERIFIED", "미검증"],
    ["FAILED", "조회 실패"],
    ["AMBIGUOUS", "수동 확인"],
  ] as const;
  return <section aria-label="NAVER 근거 상태" className="candidate-evidence-rail">
    <div><p className="candidate-eyebrow">NAVER LOCAL EVIDENCE</p><h2>근거 상태</h2></div>
    <dl>{items.map(([status, label]) => <div key={status}><dt>{label}</dt><dd>{counts[status] ?? 0}</dd></div>)}</dl>
  </section>;
}

export function CandidateEvidenceChain({ row }: { row: EvidenceRow }) {
  const evidence = row.naverEvidence;
  const status = evidence.status ? statusLabel[evidence.status] : "미검증";
  return <div className="candidate-evidence-chain">
    <div className="candidate-evidence-chain__head"><span>근거 체인</span><strong data-status={evidence.status ?? "UNVERIFIED"}>{status}</strong></div>
    <ol>
      <li className={evidence.evidenceCodes.some((code) => code.includes("NAME")) ? "is-proven" : ""}>상호 <span>{evidence.evidenceCodes.some((code) => code.includes("NAME")) ? "일치" : "확인 필요"}</span></li>
      <li className={evidence.evidenceCodes.some((code) => code.includes("ADDRESS") || code.includes("COORDINATES")) ? "is-proven" : ""}>위치 <span>{evidence.evidenceCodes.some((code) => code.includes("ADDRESS")) ? "주소 일치" : evidence.evidenceCodes.some((code) => code.includes("COORDINATES")) ? "100m 이내" : "확인 필요"}</span></li>
      <li className={evidence.evidenceCodes.includes("NAVER_SPECIFIC_CATEGORY") ? "is-proven" : ""}>NAVER 카테고리 <span>{evidence.evidenceCodes.includes("NAVER_SPECIFIC_CATEGORY") ? "상세" : "미확정"}</span></li>
      <li className={evidence.evidenceCodes.includes("SOURCE_SUBTYPE_MATCH") ? "is-proven" : ""}>원천 업태 <span>{evidence.evidenceCodes.includes("SOURCE_SUBTYPE_MATCH") ? "일치" : row.businessSubtype ?? "미상"}</span></li>
    </ol>
    {evidence.failureCode ? <p className="candidate-evidence-chain__note">{evidence.failureCode}</p> : <p className="candidate-evidence-chain__note">근거 점수 {evidence.confidenceScore ?? 0}점</p>}
    {evidence.evidenceCodes.length > 0 && <details><summary>세부 근거</summary><p>{evidence.evidenceCodes.map((code) => evidenceLabel[code] ?? code).join(" · ")}</p></details>}
  </div>;
}
