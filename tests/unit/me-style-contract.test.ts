import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const css = readFileSync("app/app.css", "utf8");

describe("me style contract", () => {
  it("취향 허브 토큰과 반응형 레이아웃을 정의한다", () => {
    for (const selector of [
      ".member-hub",
      ".member-profile",
      ".member-signal-list",
      ".member-activity-grid",
      ".member-account-card",
    ]) expect(css).toContain(selector);
    expect(css).toContain("#e7ff55");
    expect(css).toMatch(/@media\(max-width:900px\)[\s\S]*\.member-/);
    expect(css).toMatch(/@media\(max-width:520px\)[\s\S]*\.member-/);
  });
});
