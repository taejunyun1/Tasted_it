import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const css = readFileSync("app/styles/design-system.css", "utf8");
const root = readFileSync("app/root.tsx", "utf8");

describe("Re:Taste design system", () => {
  it("공통 레이아웃·간격·모서리 토큰을 제공한다", () => {
    [
      "--layout-max:1280px",
      "--layout-gutter:20px",
      "--layout-gutter-mobile:14px",
      "--space-20:80px",
      "--radius-card:20px",
    ].forEach((token) => expect(css).toContain(token));
  });

  it("기존 스타일 다음에 디자인 시스템을 불러온다", () => {
    expect(root.indexOf('import "./app.css"')).toBeLessThan(
      root.indexOf('import "./styles/design-system.css"'),
    );
  });
});
