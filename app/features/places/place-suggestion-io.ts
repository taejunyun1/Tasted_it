export const reviewableSuggestionStatuses = ["SUBMITTED", "NEEDS_INFO", "REVIEWING"] as const;
export const suggestionTransitionStatuses = ["NEEDS_INFO", "REJECTED"] as const;

export type ReviewableSuggestionStatus = (typeof reviewableSuggestionStatuses)[number];
export type SuggestionTransitionStatus = (typeof suggestionTransitionStatuses)[number];

export type SuggestionApprovalInput = {
  suggestionId: string;
  address: string;
  neighborhood: string;
  originLatitude: number;
  originLongitude: number;
  latitude: number;
  longitude: number;
  reason: string;
};

export type SuggestionApprovalCheck =
  | { ok: true; value: SuggestionApprovalInput }
  | { ok: false; code: SuggestionApprovalErrorCode };

export type SuggestionTransitionCheck =
  | { ok: true; value: { suggestionId: string; status: SuggestionTransitionStatus; reason: string } }
  | { ok: false; code: SuggestionApprovalErrorCode };

export type SuggestionApprovalErrorCode =
  | "SUGGESTION_APPROVAL_INCOMPLETE"
  | "SUGGESTION_COORDINATES_REQUIRED"
  | "LOCATION_REQUIRED"
  | "LOCATION_OUT_OF_SCOPE"
  | "REVIEW_REASON_REQUIRED"
  | "SUGGESTION_NOT_REVIEWABLE"
  | "SUGGESTION_REQUIRED_FIELDS"
  | "ADMIN_REQUIRED"
  | "INVALID_INTENT"
  | "UNKNOWN";

function textValue(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function finiteNumber(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

export function checkSuggestionApprovalRequest(input: {
  suggestionId: unknown;
  address: unknown;
  neighborhood: unknown;
  originLatitude: unknown;
  originLongitude: unknown;
  latitude: unknown;
  longitude: unknown;
  locationConfirmed: unknown;
  reason: unknown;
}): SuggestionApprovalCheck {
  const suggestionId = textValue(input.suggestionId);
  const address = textValue(input.address);
  const neighborhood = textValue(input.neighborhood);
  const reason = textValue(input.reason);
  const locationConfirmed = input.locationConfirmed === "true" || input.locationConfirmed === true;
  const originLatitude = finiteNumber(input.originLatitude);
  const originLongitude = finiteNumber(input.originLongitude);
  const latitude = finiteNumber(input.latitude);
  const longitude = finiteNumber(input.longitude);

  if (!suggestionId || suggestionId.length > 160) return { ok: false, code: "SUGGESTION_NOT_REVIEWABLE" };
  if (!locationConfirmed) return { ok: false, code: "LOCATION_REQUIRED" };
  if (originLatitude == null || originLongitude == null || latitude == null || longitude == null) {
    return { ok: false, code: "SUGGESTION_COORDINATES_REQUIRED" };
  }
  if (!address || address.length < 5 || address.length > 300 || !neighborhood || neighborhood.length > 80) {
    return { ok: false, code: "SUGGESTION_REQUIRED_FIELDS" };
  }
  if (!reason) return { ok: false, code: "REVIEW_REASON_REQUIRED" };
  if (reason.length > 300) return { ok: false, code: "SUGGESTION_APPROVAL_INCOMPLETE" };

  return {
    ok: true,
    value: { suggestionId, address, neighborhood, originLatitude, originLongitude, latitude, longitude, reason },
  };
}

export function checkSuggestionTransitionRequest(input: {
  suggestionId: unknown;
  status: unknown;
  reason: unknown;
}): SuggestionTransitionCheck {
  const suggestionId = textValue(input.suggestionId);
  const status = textValue(input.status);
  const reason = textValue(input.reason);
  if (!suggestionId || suggestionId.length > 160) return { ok: false, code: "SUGGESTION_NOT_REVIEWABLE" };
  if (!suggestionTransitionStatuses.includes(status as SuggestionTransitionStatus)) {
    return { ok: false, code: "INVALID_INTENT" };
  }
  if (!reason) return { ok: false, code: "REVIEW_REASON_REQUIRED" };
  if (reason.length > 300) return { ok: false, code: "SUGGESTION_APPROVAL_INCOMPLETE" };
  return { ok: true, value: { suggestionId, status: status as SuggestionTransitionStatus, reason } };
}

export function suggestionApprovalErrorMessage(code: string) {
  if (code === "SUGGESTION_NOT_REVIEWABLE") return "이미 처리됐거나 다른 관리자가 검토 중인 제안입니다. 목록을 새로고침해 주세요.";
  if (code === "SUGGESTION_COORDINATES_REQUIRED" || code === "LOCATION_REQUIRED") return "지도에서 위치를 확인한 뒤 승인해 주세요.";
  if (code === "LOCATION_OUT_OF_SCOPE") return "광주·전남 범위 안의 위치만 승인할 수 있어요.";
  if (code === "REVIEW_REASON_REQUIRED") return "승인 근거를 입력해 주세요.";
  if (code === "SUGGESTION_REQUIRED_FIELDS" || code === "SUGGESTION_APPROVAL_INCOMPLETE") {
    return "지도에서 위치를 확인하고 승인 근거를 입력해 주세요.";
  }
  if (code === "ADMIN_REQUIRED") return "관리자만 이 작업을 실행할 수 있습니다.";
  if (code === "INVALID_INTENT") return "이 제안에서는 해당 작업을 실행할 수 없습니다.";
  return "초안 승인에 실패했어요. 잠시 뒤 목록을 새로고침한 후 다시 시도해 주세요.";
}
