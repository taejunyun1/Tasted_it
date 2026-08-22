import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const css = readFileSync("app/app.css", "utf8");
const panel = readFileSync("app/components/map/HomeCurationPanel.tsx", "utf8");
const sheet = readFileSync("app/components/map/HomeCurationSheet.tsx", "utf8");

describe("contrast, reduced motion, and home h1", () => {
  it("darkens map index and image fallback colors past the failing pairs", () => {
    expect(css).not.toMatch(/\.map-place-index\{[^}]*color:#78827b/);
    expect(css).not.toMatch(/\.map-place-index\{[^}]*color:#8290a0/);
    expect(css).not.toMatch(/\.place-image__fallback\{[^}]*color:#6d786f/);
    expect(css).toMatch(/\.map-place-index\{[^}]*color:#3d4a43/);
    expect(css).toMatch(/\.place-image__fallback\{[^}]*color:#3d4a43/);
  });

  it("disables the place-detail sheet animation when motion is reduced", () => {
    expect(css).toContain("@media(prefers-reduced-motion:reduce){.map-place-sheet{animation:none}.map-rating-bar>span{transition:none}.place-detail-sheet{animation:none}");
  });

  it("renders one home h1 for 지금 갈 만한 5곳", () => {
    expect(panel).toContain("<h1>지금 갈 만한 5곳</h1>");
    expect(sheet).toContain("지금 갈 만한 5곳");
    expect(sheet).not.toContain("<h1>지금 갈 만한 5곳</h1>");
  });
});
