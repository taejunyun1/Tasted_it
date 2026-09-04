import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const E2E_PLACEHOLDER_ID = "00000000-0000-4000-8000-000000000e2e";

function readDatabaseId(path: string) {
  const match = readFileSync(path, "utf8").match(/"database_id"\s*:\s*"([^"]+)"/);
  if (!match) throw new Error(`database_id missing in ${path}`);
  return match[1];
}

describe("e2e wrangler isolation", () => {
  it("does not reuse the production D1 id", () => {
    const productionId = readDatabaseId("wrangler.jsonc");
    const e2eId = readDatabaseId("wrangler.e2e.jsonc");
    expect(e2eId).toBe(E2E_PLACEHOLDER_ID);
    expect(e2eId).not.toBe(productionId);
  });

  it("does not bootstrap the default local D1 when Playwright starts pnpm dev", () => {
    const bootstrap = readFileSync("scripts/ensure-local-dev-db.mjs", "utf8");
    const playwrightConfig = readFileSync("playwright.config.ts", "utf8");
    const syntheticConfig = readFileSync("playwright.synthetic-beta.config.ts", "utf8");
    expect(bootstrap).toContain('process.env.RETASTE_E2E === "true"');
    expect(bootstrap).toContain('process.env.SYNTHETIC_BETA === "1"');
    expect(bootstrap).toContain("--local");
    expect(bootstrap).not.toContain("--remote");
    expect(playwrightConfig).toContain("RETASTE_E2E=true");
    expect(syntheticConfig).toContain("RETASTE_E2E=true");
  });
});
