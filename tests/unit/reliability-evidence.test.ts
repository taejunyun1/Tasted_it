import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { RELIABILITY_EVIDENCE } from "../../app/features/operations/reliability-evidence";

it("pins reviewed evidence to exact repository files and digests", () => {
  for (const entry of RELIABILITY_EVIDENCE) {
    expect(entry.path).toMatch(/^docs\/evidence\/cst-20261210\/[a-z0-9-]+\.json$/);
    expect(createHash("sha256").update(readFileSync(entry.path)).digest("hex")).toBe(entry.sha256);
    expect(entry.href).toBe(`https://github.com/taejunyun1/Tasted_it/blob/${entry.sourceCommit}/${entry.path}`);
    expect(entry.sourceCommit).toMatch(/^[a-f0-9]{40}$/);
  }
});
