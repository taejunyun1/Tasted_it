import type { PlaceReviewQueueRow } from "../../features/places/place-review-query.server";

const sourceLabels: Record<PlaceReviewQueueRow["sourceKind"], string> = {
  PUBLIC_DATA: "공공데이터",
  PLACE_SUGGESTION: "회원 제안",
  CATEGORY_RECALL: "카테고리 회수",
  LIVENESS_RECHECK: "영업 재검증",
};

export function PlaceReviewCard({ row, checked, onToggle }: { row: PlaceReviewQueueRow; checked: boolean; onToggle: () => void }) {
  return <article className="place-review-card">
    <label className="place-review-card-select"><input type="checkbox" checked={checked} onChange={onToggle} /><span className="sr-only">{row.name} 선택</span></label>
    <div className="place-review-card-main">
      <p className="place-review-card-meta"><span>{sourceLabels[row.sourceKind]}</span>{row.region && <span>{row.region === "GWANGJU" ? "광주" : "전남"}</span>}{row.placeStatus && <span>{row.placeStatus}</span>}</p>
      <h3>{row.name || "상호 확인 필요"}</h3>
      <p>{row.address || "주소 확인 필요"}</p>
      <dl>
        <div><dt>NAVER</dt><dd>{row.naverStatus ?? "미확인"}{row.naverScore != null ? ` · ${row.naverScore}점` : ""}</dd></div>
        <div><dt>카테고리</dt><dd>{row.selectedCategoryName ?? (row.naverMappedCategoryName ? `NAVER 추천 · ${row.naverMappedCategoryName}` : "미확정")}</dd></div>
      </dl>
      {row.blockCodes.length > 0 && <ul className="place-review-blocks">{row.blockCodes.map((code) => <li key={code}>{code}</li>)}</ul>}
    </div>
  </article>;
}
