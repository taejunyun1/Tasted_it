import { describe, expect, it } from "vitest";

import {
  getAiClassificationBadge,
  removeAutoClassificationParam,
  shouldAutoClassify,
} from "../../app/features/candidates/auto-classification-trigger";

describe("automatic candidate classification trigger", () => {
  it("자동 분류 플래그가 있고 아직 시작하지 않은 idle 상태에서만 실행한다", () => {
    const params = new URLSearchParams("state=MANUAL&autoClassify=1");

    expect(shouldAutoClassify(params, "idle", false)).toBe(true);
    expect(shouldAutoClassify(params, "submitting", false)).toBe(false);
    expect(shouldAutoClassify(params, "idle", true)).toBe(false);
    expect(shouldAutoClassify(new URLSearchParams("state=MANUAL"), "idle", false)).toBe(false);
  });

  it("다른 필터를 보존하고 자동 분류 플래그만 제거한다", () => {
    expect(removeAutoClassificationParam(new URLSearchParams("region=GWANGJU&state=MANUAL&autoClassify=1")))
      .toBe("/admin/candidates?region=GWANGJU&state=MANUAL");
  });

  it("AI 실패 결과에 수동 확인과 구분되는 배지를 제공한다", () => {
    expect(getAiClassificationBadge("AI_FAILED")).toEqual({ label: "AI 확인 실패", tone: "error" });
    expect(getAiClassificationBadge("AI_RULE")).toEqual({ label: "AI 분류 완료", tone: "success" });
    expect(getAiClassificationBadge("RULE_ONLY")).toBeNull();
  });
});
