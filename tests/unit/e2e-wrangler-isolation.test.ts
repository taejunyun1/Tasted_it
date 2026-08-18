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
});
