import { describe, expect, it } from "vitest";

import {
  checkClearExclusionsRequest,
  checkCorrectionApplyRequest,
  checkCorrectionTransitionRequest,
  checkLivenessResolveRequest,
  checkMergeRequest,
  checkRestoreRequest,
  operationsErrorMessage,
} from "../../app/features/places/place-operations-io";
import { parseCorrectionChanges } from "../../app/features/places/place-operations-liveness";
import { parsePlaceOperationsTab, placeOperationsTabHref } from "../../app/features/places/place-operations-tabs";

describe("place operations contracts", () => {
  it("defaults unknown tabs to the review pipeline", () => {
    expect(parsePlaceOperationsTab(new URL("https://retaste.test/admin/place-operations"))).toBe("review");
    expect(parsePlaceOperationsTab(new URL("https://retaste.test/admin/place-operations?flow=review&step=2"))).toBe("review");
    expect(parsePlaceOperationsTab(new URL("https://retaste.test/admin/place-operations?tab=liveness"))).toBe("liveness");
    expect(parsePlaceOperationsTab(new URL("https://retaste.test/admin/place-operations?tab=naver"))).toBe("review");
    expect(placeOperationsTabHref("duplicates")).toBe("/admin/place-operations?tab=duplicates");
  });

  it("requires distinct places and a reason before merge", () => {
    expect(checkMergeRequest({
      targetPlaceId: "place-a",
      sourcePlaceId: "place-b",
      reason: "동일 지점",
    }).ok).toBe(true);
    expect(checkMergeRequest({
      targetPlaceId: "place-a",
      sourcePlaceId: "place-a",
      reason: "동일 지점",
    })).toEqual({ ok: false, code: "MERGE_SAME_PLACE" });
    expect(checkMergeRequest({
      targetPlaceId: "place-a",
      sourcePlaceId: "place-b",
      reason: "   ",
    })).toEqual({ ok: false, code: "MERGE_REASON_REQUIRED" });
  });

  it("keeps correction, restore, and liveness actions reason-gated", () => {
    expect(checkCorrectionApplyRequest({ requestId: "req-1", reason: "주소 확인" }).ok).toBe(true);
    expect(checkCorrectionApplyRequest({ requestId: "req-1", reason: "" }))
      .toEqual({ ok: false, code: "REVIEW_REASON_REQUIRED" });
    expect(checkCorrectionTransitionRequest({ requestId: "req-1", status: "APPROVED", reason: "우회" }))
      .toEqual({ ok: false, code: "INVALID_INTENT" });
    expect(checkRestoreRequest({ revisionId: "", reason: "복원" }))
      .toEqual({ ok: false, code: "REVISION_NOT_FOUND" });
    expect(checkLivenessResolveRequest({ caseId: "case-1", resolution: "OPEN", reason: "현장 확인" }).ok).toBe(true);
    expect(checkLivenessResolveRequest({ caseId: "case-1", resolution: "HIDE", reason: "현장 확인" }))
      .toEqual({ ok: false, code: "INVALID_LIVENESS_RESOLUTION" });
    expect(checkClearExclusionsRequest({ reason: "" }))
      .toEqual({ ok: false, code: "REVIEW_REASON_REQUIRED" });
  });

  it("shows only allowed correction fields and never treats email as a change", () => {
    expect(parseCorrectionChanges(JSON.stringify({
      name: "새 상호",
      address: "광주광역시 동구 서석로 1",
      requesterEmail: "hidden@example.com",
      extra: "drop",
    }))).toEqual([
      { label: "상호", value: "새 상호" },
      { label: "주소", value: "광주광역시 동구 서석로 1" },
    ]);
    expect(operationsErrorMessage("MERGE_SAME_PLACE")).toContain("서로 다른");
  });
});
