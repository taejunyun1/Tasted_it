import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const css = readFileSync("app/styles/design-system.css", "utf8");

describe("home curation design contract", () => {
  it("디자인 토큰 기반 데스크톱 패널과 번호 마커를 정의한다", () => {
    expect(css).toContain(".map-explorer--curated");
    expect(css).toContain(".home-curation-panel");
    expect(css).toContain(".home-curation-card__rank");
    expect(css).toContain(".map-pin--ranked");
    expect(css).toContain("var(--surface-card)");
    expect(css).toContain("var(--color-signal)");
  });

  it("760px 이하에서 패널 대신 스냅 시트를 표시한다", () => {
    expect(css).toContain(".home-curation-sheet[data-snap=\"peek\"]");
    expect(css).toContain(".home-curation-sheet[data-snap=\"half\"]");
    expect(css).toContain(".home-curation-sheet[data-snap=\"full\"]");
    expect(css).toMatch(/@media\(max-width:760px\)[\s\S]*\.home-curation-panel\{[\s\S]*display:none/);
  });

  it("보기 전환 버튼은 공통 플로팅 스타일을 쓰고 재추천 버튼과 겹치지 않는다", () => {
    expect(css).toContain(".home-curation-view-toggle");
    expect(css).toMatch(/\.home-curation-view-toggle\{[\s\S]*position:absolute[\s\S]*left:50%/);
    expect(css).toMatch(/\.home-curation-reload-area\{[\s\S]*top:calc\(/);
    expect(css).not.toContain(".home-curation-browse");
    expect(css).not.toContain(".home-curation-return");
  });

  it("모션 감소 설정에서는 시트 전환을 제거한다", () => {
    expect(css).toMatch(/@media\(prefers-reduced-motion:reduce\)[\s\S]*\.home-curation-sheet/);
  });
});
