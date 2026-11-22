import { describe, expect, it } from "vitest";

import {
  checkSuggestionApprovalRequest,
  checkSuggestionTransitionRequest,
  suggestionApprovalErrorMessage,
} from "../../app/features/places/place-suggestion-io";

const validApproval = {
  suggestionId: "suggestion-1",
  expectedRevision: "a".repeat(64),
  address: "광주광역시 동구 서석로 1",
  neighborhood: "서석동",
  originLatitude: "35.146",
  originLongitude: "126.923",
  latitude: "35.146",
  longitude: "126.923",
  locationConfirmed: "true",
  reason: "지도 위치와 주소를 확인했습니다.",
};

describe("place suggestion approval contract", () => {
  it("accepts a confirmed map location and reason", () => {
    expect(checkSuggestionApprovalRequest(validApproval)).toEqual({
      ok: true,
      value: {
        suggestionId: "suggestion-1",
        expectedRevision: validApproval.expectedRevision,
        address: "광주광역시 동구 서석로 1",
        neighborhood: "서석동",
        originLatitude: 35.146,
        originLongitude: 126.923,
        latitude: 35.146,
        longitude: 126.923,
        reason: "지도 위치와 주소를 확인했습니다.",
      },
    });
  });

  it("requires map confirmation, coordinates, and a reason", () => {
    expect(checkSuggestionApprovalRequest({ ...validApproval, locationConfirmed: "" }))
      .toEqual({ ok: false, code: "LOCATION_REQUIRED" });
    expect(checkSuggestionApprovalRequest({ ...validApproval, latitude: "" }))
      .toEqual({ ok: false, code: "SUGGESTION_COORDINATES_REQUIRED" });
    expect(checkSuggestionApprovalRequest({ ...validApproval, reason: "   " }))
      .toEqual({ ok: false, code: "REVIEW_REASON_REQUIRED" });
    expect(checkSuggestionApprovalRequest({ ...validApproval, suggestionId: "" }))
      .toEqual({ ok: false, code: "SUGGESTION_NOT_REVIEWABLE" });
  });

  it("allows only additional-info and reject transitions", () => {
    const expectedRevision = validApproval.expectedRevision;
    expect(checkSuggestionTransitionRequest({
      suggestionId: "suggestion-1",
      expectedRevision,
      status: "NEEDS_INFO",
      reason: "상호 확인이 더 필요합니다.",
    }).ok).toBe(true);
    expect(checkSuggestionTransitionRequest({
      suggestionId: "suggestion-1",
      expectedRevision,
      status: "REJECTED",
      reason: "음식점이 아닙니다.",
    }).ok).toBe(true);
    expect(checkSuggestionTransitionRequest({
      suggestionId: "suggestion-1",
      expectedRevision,
      status: "APPROVED",
      reason: "우회 승인",
    })).toEqual({ ok: false, code: "INVALID_INTENT" });
    expect(checkSuggestionTransitionRequest({
      suggestionId: "suggestion-1",
      expectedRevision,
      status: "NEEDS_INFO",
      reason: " ",
    })).toEqual({ ok: false, code: "REVIEW_REASON_REQUIRED" });
  });

  it("requires the review card revision for both decisions", () => {
    for (const expectedRevision of [null, "a".repeat(63), "g".repeat(64), "0".repeat(65)]) {
      expect(checkSuggestionApprovalRequest({ ...validApproval, expectedRevision })).toEqual({ ok: false, code: "SUGGESTION_STALE" });
      expect(checkSuggestionTransitionRequest({ suggestionId: validApproval.suggestionId, expectedRevision, status: "REJECTED", reason: "검수 근거" }))
        .toEqual({ ok: false, code: "SUGGESTION_STALE" });
    }
  });

  it("keeps approval copy distinct from review hold/exclude copy", () => {
    expect(suggestionApprovalErrorMessage("REVIEW_REASON_REQUIRED")).toBe("승인 근거를 입력해 주세요.");
    expect(suggestionApprovalErrorMessage("LOCATION_REQUIRED")).toContain("지도");
    expect(suggestionApprovalErrorMessage("SUGGESTION_NOT_REVIEWABLE")).toContain("새로고침");
  });
});
