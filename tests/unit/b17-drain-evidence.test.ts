import { describe, expect, it } from "vitest";
import { buildB17DrainObservationPlan, describeB17DrainRequirements, summarizeB17DrainObservation, verifyB17DrainEvidence } from "../../scripts/b17-drain-evidence.mjs";

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

  it("plans bounded version-scoped observation requests without remote execution or persisted query", () => {
    const plan = buildB17DrainObservationPlan({ expected });
    expect(plan.maxRequests).toBe(2);
    expect(plan.query.body).toMatchObject({ dry: true, view: "events", limit: 100 });
    expect(plan.query.body.parameters.filters).toContainEqual({ key: "$workers.scriptVersion.id", operation: "eq", type: "string", value: expected.previousVersion });
    expect(plan.query.body.timeframe.to - plan.query.body.timeframe.from).toBeLessThanOrEqual(30 * 60_000);
    expect(plan.canMigrate).toBe(false);
  });

  it("redacts authenticated-transport event shapes and keeps sampled, partial or empty observations non-authoritative", () => {
    for (const response of [null, true, 1, "invalid", []]) {
      expect(summarizeB17DrainObservation({ expected, response })).toMatchObject({ status: "UNAVAILABLE", canMigrate: false });
    }
    const plan = buildB17DrainObservationPlan({ expected });
    const row = { dataset: "cloudflare-workers", timestamp: Date.parse(expected.now), source: { privateUrl: "DO_NOT_LEAK" },
      $metadata: { id: "private-id", service: "retaste-beta", type: "cf-worker-event", endTime: Date.parse(expected.now) },
      $workers: { scriptName: "retaste-beta", scriptVersion: { id: expected.previousVersion }, eventType: "fetch", outcome: "ok" } };
    const response = { success: true, errors: [], messages: [], result: {
      run: { accountId: "7543330c65069ee2df1b7b353fb0201c", status: "COMPLETED", dry: true, timeframe: plan.query.body.timeframe },
      events: { count: 2, events: [row] }, statistics: { abr_level: 2 },
    } };
    const summary = summarizeB17DrainObservation({ expected, response });
    expect(summary).toMatchObject({ status: "OBSERVED", canMigrate: false, exhaustive: false, returnedEvents: 1, reportedMatches: 2, explicitEndsAfterFence: 1, partial: true, querySampled: true, ingestionSampling: "UNKNOWN" });
    expect(JSON.stringify(summary)).not.toMatch(/DO_NOT_LEAK|private-id/);
    response.result.events = { count: 0, events: [] };
    expect(summarizeB17DrainObservation({ expected, response })).toMatchObject({ returnedEvents: 0, canMigrate: false, exhaustive: false });
    response.result.events = { count: 1, events: [{ ...row, $workers: { ...row.$workers, scriptVersion: { id: expected.fenceVersion } } }] };
    expect(summarizeB17DrainObservation({ expected, response }).status).toBe("UNAVAILABLE");
  });
});
