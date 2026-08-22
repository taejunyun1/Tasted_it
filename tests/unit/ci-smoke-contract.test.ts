import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const workflow = readFileSync(".github/workflows/ci.yml", "utf8");
const playwrightConfig = readFileSync("playwright.config.ts", "utf8");

describe("CI smoke contract", () => {
  it("runs a build job and Playwright smoke only", () => {
    expect(workflow).toContain("pnpm run build");
    expect(workflow).toContain("tests/e2e/release.spec.ts");
    expect(workflow).toContain("tests/e2e/ci-smoke-places.spec.ts");
    expect(workflow).toContain("--project=chromium");
    expect(workflow).not.toContain("k6");
    expect(workflow).not.toContain("coverage");
    expect(workflow).not.toContain("synthetic-beta-200");
    expect(workflow).not.toContain("tests/e2e --");
  });

  it("keeps local e2e on wrangler.e2e.jsonc without adding a second city stack", () => {
    expect(playwrightConfig).toContain("wrangler.e2e.jsonc");
    expect(playwrightConfig).toContain("RETASTE_E2E=true");
  });
});
