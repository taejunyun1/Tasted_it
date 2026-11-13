import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const workflow = readFileSync(".github/workflows/ci.yml", "utf8");
const playwrightConfig = readFileSync("playwright.config.ts", "utf8");
const smokeJob = workflow.split("\n  e2e-smoke:\n")[1]?.split(/\n(?=  [a-z][\w-]*:\n)/)[0] ?? "";

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

  it("runs the approved desktop files in one bounded smoke command", () => {
    const commands = [...smokeJob.matchAll(/^\s+run: (pnpm exec playwright test[^\n]*)$/gm)]
      .map((match) => match[1].trim().split(/\s+/));
    expect(commands).toEqual([[
      "pnpm", "exec", "playwright", "test",
      "tests/e2e/release.spec.ts",
      "tests/e2e/ci-smoke-places.spec.ts",
      "tests/e2e/student-workspace.spec.ts",
      "tests/e2e/student-request-session.spec.ts",
      "tests/e2e/student-invite-handoff.spec.ts",
      "tests/e2e/vote-withdraw.spec.ts",
      "tests/e2e/guest-save-merge.spec.ts",
      "tests/e2e/reviewer-moderation.spec.ts",
      "tests/e2e/auth-entry-hydration.spec.ts",
      "tests/e2e/header-layout.spec.ts",
      "--project=chromium",
    ]]);
  });

  it("preserves the four required jobs, read access and serial twenty-minute smoke budget", () => {
    const jobs = [...workflow.matchAll(/^  ([a-z][\w-]*):\n    name: ([^\n]+)$/gm)]
      .map((match) => [match[1], match[2]]);
    expect(jobs).toEqual([
      ["unit", "typecheck and unit"],
      ["integration", "integration"],
      ["build", "build"],
      ["e2e-smoke", "playwright smoke"],
    ]);
    expect(workflow.match(/^permissions:\n(?:  [^\n]+\n)+/m)?.[0].trim()).toBe("permissions:\n  contents: read");
    expect([...workflow.matchAll(/^\s*permissions:/gm)]).toHaveLength(1);
    expect(workflow).not.toContain("secrets.");
    expect(smokeJob.match(/^    timeout-minutes: (\d+)$/m)?.[1]).toBe("20");
    expect(playwrightConfig).toContain("fullyParallel: false");
    expect(playwrightConfig).toContain("workers: 1");
    expect(playwrightConfig).toContain("retries: 0");
    expect(playwrightConfig).toContain("reuseExistingServer: false");
  });

  it("keeps local e2e on wrangler.e2e.jsonc without adding a second city stack", () => {
    expect(playwrightConfig).toContain("wrangler.e2e.jsonc");
    expect(playwrightConfig).toContain("RETASTE_E2E=true");
  });
});
