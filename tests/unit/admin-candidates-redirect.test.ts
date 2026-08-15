import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("legacy candidate review redirect", () => {
  it("removes the direct candidate approval UI and sends requests to the first review step", () => {
    const route = readFileSync("app/routes/admin-candidates.tsx", "utf8");
    expect(route).toContain("/admin/place-operations?");
    expect(route).toContain('step: "1"');
    expect(route).not.toContain("approveCandidateSelections");
  });
});
