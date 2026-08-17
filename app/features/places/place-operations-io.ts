export const operationsIntents = [
  "apply-correction",
  "transition-correction",
  "merge",
  "restore",
  "resolve-liveness",
  "clear-recommendation-exclusions",
] as const;

export type OperationsIntent = (typeof operationsIntents)[number];
export const correctionTransitionStatuses = ["REVIEWING", "REJECTED"] as const;
export const livenessResolutions = ["OPEN", "TEMPORARILY_CLOSED", "CLOSED", "MOVED"] as const;

export type CorrectionTransitionStatus = (typeof correctionTransitionStatuses)[number];
export type LivenessResolution = (typeof livenessResolutions)[number];

export type OperationsErrorCode =
  | "ADMIN_REQUIRED"
  | "INVALID_INTENT"
  | "REVIEW_REASON_REQUIRED"
  | "MERGE_SAME_PLACE"
  | "MERGE_REASON_REQUIRED"
  | "MERGE_PLACE_NOT_FOUND"
  | "RESTORE_REASON_REQUIRED"
  | "REVISION_NOT_FOUND"
  | "REVISION_HAS_NO_BEFORE_STATE"
  | "PLACE_NOT_FOUND"
  | "CORRECTION_NOT_APPLICABLE"
  | "CORRECTION_CHANGES_EMPTY"
  | "CORRECTION_CHANGES_INVALID"
  | "REVALIDATION_NOT_REVIEWABLE"
  | "INVALID_LIVENESS_RESOLUTION"
  | "UNKNOWN";

export type OperationsCheck<T> =
  | { ok: true; value: T }
  | { ok: false; code: OperationsErrorCode };

function textValue(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function idValue(value: unknown) {
  const id = textValue(value);
  return id && id.length <= 160 ? id : "";
}

function reasonValue(value: unknown) {
  return textValue(value).slice(0, 300);
}

export function checkMergeRequest(input: {
  targetPlaceId: unknown;
  sourcePlaceId: unknown;
  reason: unknown;
}): OperationsCheck<{ targetPlaceId: string; sourcePlaceId: string; reason: string }> {
  const targetPlaceId = idValue(input.targetPlaceId);
  const sourcePlaceId = idValue(input.sourcePlaceId);
  const reason = reasonValue(input.reason);
  if (!targetPlaceId || !sourcePlaceId) return { ok: false, code: "MERGE_PLACE_NOT_FOUND" };
  if (targetPlaceId === sourcePlaceId) return { ok: false, code: "MERGE_SAME_PLACE" };
  if (!reason) return { ok: false, code: "MERGE_REASON_REQUIRED" };
  return { ok: true, value: { targetPlaceId, sourcePlaceId, reason } };
}

export function checkRestoreRequest(input: {
  revisionId: unknown;
  reason: unknown;
}): OperationsCheck<{ revisionId: string; reason: string }> {
  const revisionId = idValue(input.revisionId);
  const reason = reasonValue(input.reason);
  if (!revisionId) return { ok: false, code: "REVISION_NOT_FOUND" };
  if (!reason) return { ok: false, code: "RESTORE_REASON_REQUIRED" };
  return { ok: true, value: { revisionId, reason } };
}

export function checkCorrectionApplyRequest(input: {
  requestId: unknown;
  reason: unknown;
}): OperationsCheck<{ requestId: string; reason: string }> {
  const requestId = idValue(input.requestId);
  const reason = reasonValue(input.reason);
  if (!requestId) return { ok: false, code: "CORRECTION_NOT_APPLICABLE" };
  if (!reason) return { ok: false, code: "REVIEW_REASON_REQUIRED" };
  return { ok: true, value: { requestId, reason } };
}

export function checkCorrectionTransitionRequest(input: {
  requestId: unknown;
  status: unknown;
  reason: unknown;
}): OperationsCheck<{ requestId: string; status: CorrectionTransitionStatus; reason: string }> {
  const requestId = idValue(input.requestId);
  const status = textValue(input.status);
  const reason = reasonValue(input.reason);
  if (!requestId) return { ok: false, code: "CORRECTION_NOT_APPLICABLE" };
  if (!correctionTransitionStatuses.includes(status as CorrectionTransitionStatus)) {
    return { ok: false, code: "INVALID_INTENT" };
  }
  if (!reason) return { ok: false, code: "REVIEW_REASON_REQUIRED" };
  return { ok: true, value: { requestId, status: status as CorrectionTransitionStatus, reason } };
}

export function checkLivenessResolveRequest(input: {
  caseId: unknown;
  resolution: unknown;
  reason: unknown;
}): OperationsCheck<{ caseId: string; resolution: LivenessResolution; reason: string }> {
  const caseId = idValue(input.caseId);
  const resolution = textValue(input.resolution);
  const reason = reasonValue(input.reason);
  if (!caseId) return { ok: false, code: "REVALIDATION_NOT_REVIEWABLE" };
  if (!livenessResolutions.includes(resolution as LivenessResolution)) {
    return { ok: false, code: "INVALID_LIVENESS_RESOLUTION" };
  }
  if (!reason) return { ok: false, code: "REVIEW_REASON_REQUIRED" };
  return { ok: true, value: { caseId, resolution: resolution as LivenessResolution, reason } };
}

export function checkClearExclusionsRequest(input: { reason: unknown }): OperationsCheck<{ reason: string }> {
  const reason = reasonValue(input.reason);
  if (!reason) return { ok: false, code: "REVIEW_REASON_REQUIRED" };
  return { ok: true, value: { reason } };
}

export function operationsErrorMessage(code: string) {
  if (code === "MERGE_SAME_PLACE") return "남길 장소와 흡수할 장소가 같습니다. 서로 다른 장소를 선택해 주세요.";
  if (code === "MERGE_REASON_REQUIRED") return "병합 근거를 입력해 주세요.";
  if (code === "MERGE_PLACE_NOT_FOUND") return "병합할 장소를 다시 선택해 주세요.";
  if (code === "RESTORE_REASON_REQUIRED") return "복원 사유를 입력해 주세요.";
  if (code === "REVISION_NOT_FOUND" || code === "REVISION_HAS_NO_BEFORE_STATE") return "복원할 이력을 찾을 수 없습니다.";
  if (code === "PLACE_NOT_FOUND") return "대상 장소를 찾을 수 없습니다.";
  if (code === "CORRECTION_NOT_APPLICABLE") return "이미 처리됐거나 적용할 수 없는 정정 요청입니다.";
  if (code === "CORRECTION_CHANGES_EMPTY" || code === "CORRECTION_CHANGES_INVALID") return "적용할 정정 항목이 없습니다.";
  if (code === "REVALIDATION_NOT_REVIEWABLE") return "이미 처리됐거나 검수할 수 없는 영업 상태입니다.";
  if (code === "INVALID_LIVENESS_RESOLUTION") return "영업 상태 검수 결과를 다시 선택해 주세요.";
  if (code === "REVIEW_REASON_REQUIRED") return "검수 근거를 입력해 주세요.";
  if (code === "ADMIN_REQUIRED") return "관리자만 이 작업을 실행할 수 있습니다.";
  if (code === "INVALID_INTENT") return "이 화면에서는 해당 작업을 실행할 수 없습니다.";
  return "작업을 완료하지 못했습니다. 잠시 뒤 다시 시도해 주세요.";
}
