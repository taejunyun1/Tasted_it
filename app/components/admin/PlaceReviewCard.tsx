import type { PlaceReviewQueueRow } from "../../features/places/place-review-query.server";
import { naverNeedsConfirmation } from "../../features/places/place-review-pipeline";
import { reviewErrorMessage } from "../../features/places/place-review-errors";

const sourceLabels: Record<PlaceReviewQueueRow["sourceKind"], string> = {
  PUBLIC_DATA: "공공데이터",
  PLACE_SUGGESTION: "회원 제안",
  CATEGORY_RECALL: "카테고리 회수",
  LIVENESS_RECHECK: "영업 재검증",
};

function naverStatusLabel(status: string | null) {
  if (!status) return "미확인";
  if (naverNeedsConfirmation(status)) return "확인필요";
  if (status === "VERIFIED" || status === "MATCHED") return "일치";
  return status;
}

function categoryEvidenceLabel(row: PlaceReviewQueueRow) {
  if (row.selectedCategoryName) return row.selectedCategoryName;
  if (row.naverCategoryEvidence === "SPECIFIC" && row.naverMappedCategoryName) return `NAVER 세부 업종 추천 · ${row.naverMappedCategoryName}`;
  if (row.naverCategoryEvidence === "BROAD") return "NAVER 광역 업종만 확인";
  return "미확정";
}

export function PlaceReviewCard({ row, checked, onToggle, addressEditable = false }: {
  row: PlaceReviewQueueRow;
  checked: boolean;
  onToggle: () => void;
  addressEditable?: boolean;
}) {
  return <article className={`place-review-card${checked ? " is-selected" : ""}`} onClick={(event) => {
    const target = event.target as HTMLElement;
    if (target.closest("input, textarea, select, button, a, label.place-review-address-edit")) return;
    onToggle();
  }}>
    <label className="place-review-card-select" onClick={(event) => event.stopPropagation()}>
      <input type="checkbox" checked={checked} onChange={onToggle} onClick={(event) => event.stopPropagation()} />
      <span className="sr-only">{row.name} 선택</span>
    </label>
    <div className="place-review-card-main">
      <p className="place-review-card-meta">
        <span>{sourceLabels[row.sourceKind]}</span>
        {row.region && <span>{row.region === "GWANGJU" ? "광주" : "전남"}</span>}
        {row.placeStatus && <span>{row.placeStatus}</span>}
        {naverNeedsConfirmation(row.naverStatus) && <span className="place-review-badge">확인필요</span>}
      </p>
      <h3>{row.name || "상호 확인 필요"}</h3>
      <p>{row.address || "주소 확인 필요"}</p>
      {addressEditable && checked && <label className="place-review-address-edit" onClick={(event) => event.stopPropagation()}>주소 상세<input name={`address:${row.workItemId}`} defaultValue={row.address} maxLength={200} /></label>}
      <dl>
        <div><dt>NAVER 장소 대조</dt><dd>{naverStatusLabel(row.naverStatus)}</dd></div>
        <div><dt>카테고리</dt><dd>{categoryEvidenceLabel(row)}</dd></div>
        <div><dt>로컬·방문 식사</dt><dd>{row.diningStatus === "ELIGIBLE" ? "확인 완료" : row.diningStatus === "EXCLUDE" ? "자동 제외 대상" : "확인 필요"}</dd></div>
        <div><dt>원천 업태·업종</dt><dd>{row.businessSubtype || "자료 없음"}</dd></div>
        <div><dt>NAVER 업종 근거</dt><dd>{row.naverCategoryPath || "현재 유효한 상세 업종 근거 없음"}</dd></div>
      </dl>
      {!!row.diningReasons?.length && <p>{row.diningReasons.join(" · ")}</p>}
      {row.blockCodes.length > 0 && <ul className="place-review-blocks">{row.blockCodes.map((code) => <li key={code}>{reviewErrorMessage(code).message}</li>)}</ul>}
    </div>
  </article>;
}
