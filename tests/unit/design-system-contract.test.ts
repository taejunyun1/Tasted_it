import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const css = readFileSync("app/styles/design-system.css", "utf8");
const root = readFileSync("app/root.tsx", "utf8");
const adminReviewers = readFileSync("app/routes/admin-reviewers.tsx", "utf8");
const adminPlaces = readFileSync("app/routes/admin-places.tsx", "utf8");
const adminImport = readFileSync("app/routes/admin-import.tsx", "utf8");

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

  it("사용자 핵심 화면에 공통 페이지 리듬을 적용한다", () => {
    expect(css).toContain(":where(.course-page,.discovery-page,.member-hub)");
    expect(css).toContain("padding-top:var(--page-start-user)");
    expect(css).toContain("--page-section-gap:var(--space-20)");
    expect(css).toContain("padding:var(--space-8)");
  });

  it("어드민 화면에 공통 밀도 토큰과 프레임을 적용한다", () => {
    expect(css).toContain("--page-start-admin:var(--space-12)");
    expect(css).toContain("--admin-section-gap:var(--space-12)");
    expect(css).toContain("min-height:var(--control-height-compact)");
    [adminReviewers, adminPlaces, adminImport].forEach((route) => {
      expect(route).toContain("admin-page");
    });
  });

  it("디자인 가이드가 실제 핵심 토큰을 참조한다", () => {
    const guide = readFileSync("docs/design-system/retaste-design-guide.md", "utf8");
    ["--layout-max", "--space-20", "--radius-card", "--control-height"].forEach(
      (token) => expect(guide).toContain(token),
    );
  });
});
