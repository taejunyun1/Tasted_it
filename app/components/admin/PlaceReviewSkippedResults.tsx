import { reviewErrorMessage } from "../../features/places/place-review-errors";

export type ReviewSkippedItem = { workItemId: string; code: string } | { candidatePlaceId: string; code: string };

const additionalReasons: Record<string, string> = {
  DUPLICATE_CANDIDATE_STALE: "중복 후보가 변경되었거나 더 이상 검토 대상이 아닙니다. 최신 목록을 확인해 주세요.",
  CATEGORY_FALLBACK_NO_MATCH: "기존 정보에서 카테고리를 찾지 못했습니다. 카테고리를 직접 확인해 주세요.",
  GEOCODE_ADDRESS_REQUIRED: "좌표를 찾을 주소가 없습니다. 주소를 먼저 입력해 주세요.",
  GEOCODE_NO_MATCH: "주소에 맞는 좌표를 찾지 못했습니다. 주소를 확인해 주세요.",
  GEOCODE_FAILED: "좌표 조회에 실패했습니다. 주소와 연결 상태를 확인해 주세요.",
};

export function PlaceReviewSkippedResults({ skipped }: { skipped: ReviewSkippedItem[] }) {
  if (!skipped.length) return null;
  return <section className="admin-notice" role="status" aria-label="건너뛴 항목">
    <h3>건너뛴 항목 {skipped.length}건</h3>
    <ul>{skipped.map((item, index) => {
      const id = "workItemId" in item ? item.workItemId : item.candidatePlaceId;
      const reason = Object.hasOwn(additionalReasons, item.code) ? additionalReasons[item.code] : reviewErrorMessage(item.code).message;
      return <li key={`${id}:${index}`}>
        {"workItemId" in item ? "검수 항목 ID" : "중복 후보 ID"}: <code style={{ overflowWrap: "anywhere" }}>{id}</code> — {reason}
      </li>;
    })}</ul>
  </section>;
}
