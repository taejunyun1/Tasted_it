import { describe, expect, it } from "vitest";
import { describeB17DrainRequirements, verifyB17DrainEvidence } from "../../scripts/b17-drain-evidence.mjs";

const expected = {
  previousVersion: "d285759b-d529-4ea0-a7e9-9cf88b3e7cf1",
  fenceVersion: "11111111-2222-4333-8444-555555555555",
  fenceDeployedAt: "2026-11-18T01:00:00.000Z",
  now: "2026-11-18T01:20:00.000Z",
};
const evidence = (kind: string, payload: unknown = {}) => ({
  kind, previousVersion: expected.previousVersion, fenceVersion: expected.fenceVersion,
  fenceDeployedAt: expected.fenceDeployedAt, observedAt: expected.now, payload,
});

describe("B17 legacy drain evidence", () => {
  it.each([
    ["operator_assertion", { drained: true, complete: true, inFlight: 0 }],
    ["elapsed_window", { seconds: 864000, httpCompleted: true }],
    ["wrangler_tail", { events: [], dropped: 0 }],
    ["workers_observability", { total: 0, samplingRate: 1 }],
    ["deployment", { versions: [{ version_id: expected.fenceVersion, percentage: 100 }] }],
    ["platform_attestation", { issuer: "Cloudflare", signature: "invented", inFlight: 0 }],
  ])("does not promote %s to exhaustive HTTP/R2 drain proof", (kind, payload) => {
    const result = verifyB17DrainEvidence({ expected, evidence: evidence(kind as string, payload) });
    expect(result).toMatchObject({ status: "UNKNOWN", canMigrate: false, sourceAuthenticated: false });
    expect(result.evidenceSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(result.cronWindowElapsed).toBe(true);
  });

  it("rejects a different version, fence time and stale or future observation", () => {
    for (const [replacement, reason] of [
      [{ previousVersion: expected.fenceVersion }, "VERSION_OR_FENCE_MISMATCH"],
      [{ fenceVersion: expected.previousVersion }, "VERSION_OR_FENCE_MISMATCH"],
      [{ fenceDeployedAt: "2026-11-18T00:59:00.000Z" }, "VERSION_OR_FENCE_MISMATCH"],
      [{ observedAt: "2026-11-18T01:18:00.000Z" }, "STALE_OR_INVALID_OBSERVATION"],
      [{ observedAt: "2026-11-18T01:21:00.000Z" }, "STALE_OR_INVALID_OBSERVATION"],
    ]) {
      const result = verifyB17DrainEvidence({ expected, evidence: { ...evidence("wrangler_tail"), ...(replacement as Record<string,string>) } });
      expect(result).toMatchObject({ canMigrate: false, reason });
    }
  });

  it("returns typed UNKNOWN for absent, malformed or oversized input without exposing payload", () => {
    for (const candidate of [null, true, { complete: true }, evidence("wrangler_tail", { privateValue: "x".repeat(40000) })]) {
      const result = verifyB17DrainEvidence({ expected, evidence: candidate });
      expect(result.status).toBe("UNKNOWN");
      expect(result.canMigrate).toBe(false);
      expect(JSON.stringify(result)).not.toContain("privateValue");
    }
    expect(verifyB17DrainEvidence({ expected: { ...expected, now: "2026-11-18T00:00:00.000Z" } }).reason).toBe("INVALID_EXPECTED_CONTEXT");
  });

  it("binds the evidence hash to version and fence context and never treats a cron window as HTTP proof", () => {
    const a = verifyB17DrainEvidence({ expected, evidence: evidence("elapsed_window") });
    const other = { ...expected, fenceDeployedAt: "2026-11-18T00:58:00.000Z" };
    const b = verifyB17DrainEvidence({ expected: other, evidence: { ...evidence("elapsed_window"), fenceDeployedAt: other.fenceDeployedAt } });
    expect(a.evidenceSha256).not.toBe(b.evidenceSha256);
    expect(a.cronWindowEndsAt).toBe("2026-11-18T01:15:00.000Z");
    expect(a.canMigrate).toBe(false);
    expect(describeB17DrainRequirements()).toMatchObject({ supportedExhaustiveSources: [], retrospectiveCoverageAvailable: false });
  });

  it("rejects coerced identifiers, accessors and sparse arrays at the evidence boundary", () => {
    expect(verifyB17DrainEvidence({ expected: { ...expected, previousVersion: [expected.previousVersion] } }).reason).toBe("INVALID_EXPECTED_CONTEXT");
    expect(verifyB17DrainEvidence({ expected, evidence: { ...evidence("deployment"), kind: ["deployment"] } }).reason).toBe("INVALID_EVIDENCE_ENVELOPE");
    const getter = Object.defineProperty({}, "secret", { enumerable: true, get() { throw new Error("must not execute"); } });
    expect(verifyB17DrainEvidence({ expected, evidence: evidence("wrangler_tail", getter) }).reason).toBe("MALFORMED_OR_OVERSIZED_EVIDENCE");
    expect(verifyB17DrainEvidence({ expected, evidence: evidence("wrangler_tail", new Array(2001)) }).reason).toBe("MALFORMED_OR_OVERSIZED_EVIDENCE");
  });
});
