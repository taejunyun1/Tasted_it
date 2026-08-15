import { describe, expect, it } from "vitest";

import { buildCandidatePageHref } from "../../app/features/candidates/pagination";

describe("buildCandidatePageHref", () => {
  it("필터를 보존하고 page만 교체한다", () => {
    const params = new URLSearchParams("q=국밥&region=GWANGJU&state=MANUAL&pageSize=50&page=2");

    expect(buildCandidatePageHref(params, 3))
      .toBe("?q=%EA%B5%AD%EB%B0%A5&region=GWANGJU&state=MANUAL&pageSize=50&page=3");
  });

  it("페이지 이동에서는 현재 필터를 보존한다", () => {
    const params = new URLSearchParams("state=MANUAL&page=1");

    expect(buildCandidatePageHref(params, 2)).toBe("?state=MANUAL&page=2");
  });
});
