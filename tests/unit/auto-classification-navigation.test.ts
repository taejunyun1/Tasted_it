import { describe, expect, it } from "vitest";

import { buildAutoClassificationReviewUrl } from "../../app/features/candidates/auto-classification-navigation";

describe("buildAutoClassificationReviewUrl", () => {
  it("검수 화면의 자동 분류 플래그를 만든다", () => {
    expect(buildAutoClassificationReviewUrl()).toBe("/admin/candidates?autoClassify=1");
  });

  it("기존 필터를 보존하면서 자동 분류 플래그를 추가한다", () => {
    expect(buildAutoClassificationReviewUrl(new URLSearchParams("region=GWANGJU&state=MANUAL")))
      .toBe("/admin/candidates?region=GWANGJU&state=MANUAL&autoClassify=1");
  });
});
