export const reviewErrorDispositions = ["RETRY", "HOLD", "EXCLUDE", "STAY", "AUTH"] as const;
export type ReviewErrorDisposition = (typeof reviewErrorDispositions)[number];

export type ReviewErrorEntry = {
  message: string;
  disposition: ReviewErrorDisposition;
};

export const reviewErrorCatalog = {
  SOURCE_NOT_READY: { message: "원천 정보가 부족해 다음 단계로 이동할 수 없습니다.", disposition: "STAY" },
  NAVER_REVIEW_REQUIRED: { message: "NAVER가 일치하지 않거나 근거가 부족합니다. 확인필요 항목은 20자 이상 수동 근거로만 다음 단계로 이동합니다.", disposition: "STAY" },
  NAVER_RETRY_REQUIRED: { message: "NAVER 확인에 실패했습니다. 다시 시도해 주세요.", disposition: "RETRY" },
  NAVER_LOCAL_SEARCH_QUOTA: { message: "NAVER 일일 확인 한도에 도달했습니다.", disposition: "HOLD" },
  NAVER_LOCAL_SEARCH_DISABLED: { message: "NAVER 확인이 꺼져 있습니다.", disposition: "HOLD" },
  NAVER_LOCAL_SEARCH_TIMEOUT: { message: "NAVER 확인이 시간 초과되었습니다. 다시 시도해 주세요.", disposition: "RETRY" },
  NAVER_LOCAL_SEARCH_REJECTED: { message: "NAVER 확인 요청이 거부되었습니다.", disposition: "STAY" },
  NAVER_LOCAL_SEARCH_UNAVAILABLE: { message: "NAVER 확인 서비스를 사용할 수 없습니다.", disposition: "RETRY" },
  NAVER_LOCAL_SEARCH_RESPONSE_INVALID: { message: "NAVER 응답을 해석하지 못했습니다.", disposition: "RETRY" },
  CATEGORY_REQUIRED: { message: "최종 카테고리를 선택해 주세요.", disposition: "STAY" },
  CATEGORY_INACTIVE: { message: "선택한 카테고리를 사용할 수 없습니다.", disposition: "STAY" },
  CATEGORY_OVERRIDE_REASON_REQUIRED: { message: "NAVER 매핑과 다른 카테고리를 쓰려면 사유를 10자 이상 입력해 주세요.", disposition: "STAY" },
  DUPLICATE_REVIEW_REQUIRED: { message: "중복 후보 판정을 먼저 저장해 주세요.", disposition: "STAY" },
  DUPLICATE_REASON_REQUIRED: { message: "중복 판정 근거를 10자 이상 입력해 주세요.", disposition: "STAY" },
  ACTIVE_EXCLUSION: { message: "제외된 항목은 다음 단계로 이동할 수 없습니다.", disposition: "EXCLUDE" },
  ALREADY_FINAL: { message: "이미 최종 승인 단계입니다.", disposition: "STAY" },
  STALE_WORK_ITEM: { message: "다른 작업자가 먼저 처리했거나 화면이 오래되었습니다. 새로고침 후 다시 시도해 주세요.", disposition: "RETRY" },
  NOT_ACTIVE: { message: "활성 검수 항목이 아닙니다.", disposition: "STAY" },
  PLACE_REVIEW_BATCH_LIMIT_EXCEEDED: { message: "한 번에 1곳에서 50곳까지만 처리할 수 있습니다.", disposition: "STAY" },
  PLACE_REVIEW_DUPLICATE_BATCH_LIMIT_EXCEEDED: { message: "중복 판정 배치 한도를 초과했습니다.", disposition: "STAY" },
  INVALID_INTENT: { message: "이 단계에서는 해당 작업을 실행할 수 없습니다.", disposition: "STAY" },
  REVIEW_SUBJECT_MISSING: { message: "검수 대상 장소 정보가 없습니다.", disposition: "HOLD" },
  PLACE_NOT_FOUND: { message: "연결할 장소를 찾지 못했습니다.", disposition: "HOLD" },
  PUBLISH_FAILED: { message: "공개에 실패했습니다. 다시 시도해 주세요.", disposition: "RETRY" },
  REVIEW_REASON_REQUIRED: { message: "보류 또는 제외 사유를 입력해 주세요.", disposition: "STAY" },
  PUBLISH_CONFIRM_REQUIRED: { message: "선택한 장소를 공개한다는 확인이 필요합니다.", disposition: "STAY" },
  REVIEW_SELECTION_REQUIRED: { message: "처리할 장소를 선택해 주세요.", disposition: "STAY" },
  AUTO_VERIFY_SINGLE_REQUIRED: { message: "순차 NAVER 검증은 한 번에 한 장소만 처리합니다.", disposition: "STAY" },
  NOT_SOURCE_REVIEW: { message: "원천 검수 단계에서만 자동 제외할 수 있습니다.", disposition: "STAY" },
  NOT_NON_FOOD: { message: "확실한 비음식점이 아니라 자동 제외하지 않았습니다.", disposition: "STAY" },
  MANUAL_EVIDENCE_REASON_REQUIRED: { message: "수동 근거 사유를 20자 이상 입력해 주세요.", disposition: "STAY" },
  REVIEW_ADDRESS_REQUIRED: { message: "선택한 항목의 주소를 입력해 주세요.", disposition: "STAY" },
  REVIEW_ADDRESS_REGION_INVALID: { message: "주소는 광주 또는 전남이어야 합니다.", disposition: "STAY" },
  INVALID_RESPONSE: { message: "검수 응답 형식이 올바르지 않습니다.", disposition: "STAY" },
  ADMIN_REQUIRED: { message: "관리자만 이 작업을 실행할 수 있습니다.", disposition: "AUTH" },
  UNKNOWN: { message: "검수 요청을 완료하지 못했습니다.", disposition: "STAY" },
} as const satisfies Record<string, ReviewErrorEntry>;

export type ReviewErrorCode = keyof typeof reviewErrorCatalog;

export function reviewErrorMessage(code: string): { code: string; message: string; disposition: ReviewErrorDisposition } {
  const entry = Object.hasOwn(reviewErrorCatalog, code)
    ? reviewErrorCatalog[code as ReviewErrorCode]
    : reviewErrorCatalog.UNKNOWN;
  return { code: Object.hasOwn(reviewErrorCatalog, code) ? code : "UNKNOWN", message: entry.message, disposition: entry.disposition };
}
