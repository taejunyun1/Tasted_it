import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  RSI_PUBLIC_PATHS,
  assertTransition,
  deriveIncidentId,
  deriveIncidentKey,
  deriveObservationFingerprint,
  deriveKst,
  parseEvidenceReference,
  parseIncidentIdentity,
  parseLineage,
  parseObservation,
} from "../../scripts/rsi/contracts";

const sha = "a".repeat(40);
const digest = "b".repeat(64);
const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const incident = () => ({
  source: "RSI_SELF_CHECK", baseAppSha: sha, workerVersion: uuid(1),
  errorCode: "HTTP_STATUS", failedPaths: ["/places", "/login"],
});
const receipt = (kind = "OBSERVATION", n = 1, verdict = "PASS", commandId: string | null = null) => ({
  evidenceId: uuid(n), kind, digest, verdict, commandId,
});
const observation = () => ({
  schemaVersion: 1, environment: "LOCAL_SYNTHETIC", target: "RSI_PUBLIC_SIX_PATHS",
  incident: incident(), trigger: "scheduled", actor: "SYSTEM", sourceEventId: uuid(2),
  observedAtUtc: "2026-10-22T01:00:00.000Z", observedAtKst: "2026-10-22T10:00:00.000+09:00",
  window: { startUtc: "2026-10-22T00:00:00.000Z", endUtc: "2026-10-22T02:00:00.000Z" },
  checkedPaths: [...RSI_PUBLIC_PATHS], verdict: "FAIL", evidence: [receipt()],
});
const lineage = () => ({
  schemaVersion: 1, runId: uuid(3), parentRunId: null, attempt: 1,
  incidentKey: deriveIncidentKey(incident()), incidentEpoch: 1, parentIncidentId: null,
  eventFingerprint: deriveObservationFingerprint(observation()), baseAppSha: sha,
  parentAgentHash: digest, candidateAgentHash: digest, controllerHash: digest,
  evaluatorHash: digest, memorySnapshotHash: digest,
});
const transition = (from: string, to: string, evidence = [receipt()], reasonCode = "STAGE_EVIDENCE") => ({
  schemaVersion: 1, from, to, evidence, reasonCode,
});

describe("R1 closed incident and observation contracts", () => {
  it("canonicalizes failed paths as a set and derives a stable, versioned incident hash", () => {
    const identity = incident();
    const canonical = { ...identity, failedPaths: ["/login", "/places"] };
    expect(deriveIncidentKey({ ...identity, failedPaths: ["/login", "/places", "/login"] }))
      .toBe(deriveIncidentKey(identity));
    expect(parseIncidentIdentity(identity).failedPaths).toEqual(canonical.failedPaths);
    expect(deriveIncidentKey(identity)).toBe(createHash("sha256")
      .update(JSON.stringify(["rsi-incident-v1", canonical.source, canonical.baseAppSha,
        canonical.workerVersion, canonical.errorCode, canonical.failedPaths])).digest("hex"));
  });

  it.each(["source", "baseAppSha", "workerVersion", "errorCode", "failedPaths"])(
    "changes incident key when %s changes", (key) => {
      const values = { source: "LOCAL_SYNTHETIC", baseAppSha: "c".repeat(40), workerVersion: uuid(9),
        errorCode: "NETWORK_TIMEOUT", failedPaths: ["/admin"] };
      expect(deriveIncidentKey({ ...incident(), [key]: values[key as keyof typeof values] }))
        .not.toBe(deriveIncidentKey(incident()));
    },
  );

  it("keeps windows, triggers and source events out of incident identity but in observation fingerprints", () => {
    const first = observation();
    const later = { ...first, window: { ...first.window, startUtc: "2026-10-22T00:30:00.000Z" } };
    const manual = { ...first, trigger: "admin", actor: "ADMIN" };
    const event = { ...first, sourceEventId: uuid(8) };
    for (const next of [later, manual, event]) {
      expect(deriveIncidentKey(next.incident)).toBe(deriveIncidentKey(first.incident));
      expect(deriveObservationFingerprint(next)).not.toBe(deriveObservationFingerprint(first));
    }
  });

  it("canonicalizes observation path and evidence ordering without mutating callers", () => {
    const input = { ...observation(), evidence: [receipt("OBSERVATION", 1), receipt("OBSERVATION", 2)] };
    const reversed = { ...input, checkedPaths: [...input.checkedPaths].reverse(), evidence: [...input.evidence].reverse(),
      incident: { ...input.incident, failedPaths: ["/login", "/places", "/places"] } };
    expect(deriveObservationFingerprint(input)).toBe(deriveObservationFingerprint(reversed));
    expect(input.incident.failedPaths).toEqual(["/places", "/login"]);
  });

  it.each([
    ["scheduled", "SYSTEM"], ["admin", "ADMIN"], ["on-demand", "OPERATOR"],
  ])("accepts trigger %s with non-PII actor %s", (trigger, actor) => {
    expect(parseObservation({ ...observation(), trigger, actor })).toMatchObject({ trigger, actor });
  });

  it.each([
    ["scheduled", "ADMIN"], ["admin", "SYSTEM"], ["on-demand", "ADMIN"],
    ["cron", "SYSTEM"], ["admin", "person@example.test"],
  ])("rejects mismatched trigger %s / actor %s", (trigger, actor) => {
    expect(() => parseObservation({ ...observation(), trigger, actor })).toThrow("RSI_INVALID_CONTRACT");
  });

  it("derives KST across a date boundary and rejects inconsistent or invalid instants", () => {
    expect(deriveKst("2026-10-22T18:00:00.000Z")).toBe("2026-10-23T03:00:00.000+09:00");
    for (const utc of ["2026-02-30T00:00:00.000Z", "2026-10-22", "2026-10-22T01:00:00+00:00"])
      expect(() => deriveKst(utc)).toThrow("RSI_INVALID_CONTRACT");
    expect(() => parseObservation({ ...observation(), observedAtKst: "2026-10-22T11:00:00.000+09:00" }))
      .toThrow("RSI_INVALID_CONTRACT");
  });

  it.each([
    { startUtc: "2026-10-22T02:00:00.000Z", endUtc: "2026-10-22T00:00:00.000Z" },
    { startUtc: "2026-10-22T02:00:00.000Z", endUtc: "2026-10-22T03:00:00.000Z" },
    { startUtc: "2026-10-22T00:00:00.000Z", endUtc: "2026-10-22T01:00:00.000Z" },
  ])("rejects reversed or out-of-window observations (half-open window)", (window) => {
    expect(() => parseObservation({ ...observation(), window })).toThrow("RSI_INVALID_CONTRACT");
  });

  it("requires exactly the existing six paths and a fixed target", () => {
    for (const checkedPaths of [[], ["/"], [...RSI_PUBLIC_PATHS, "/student"], [...RSI_PUBLIC_PATHS.slice(1), "/places"]])
      expect(() => parseObservation({ ...observation(), checkedPaths })).toThrow("RSI_INVALID_CONTRACT");
    expect(() => parseObservation({ ...observation(), target: "https://example.test" })).toThrow("RSI_INVALID_CONTRACT");
  });

  it("preserves PASS, FAIL and UNKNOWN and rejects contradictory incident verdicts", () => {
    const ok = { ...observation(), incident: { ...incident(), errorCode: "NONE", failedPaths: [] }, verdict: "PASS" };
    const unknown = { ...observation(), incident: { ...incident(), errorCode: "UNKNOWN", failedPaths: [] }, verdict: "UNKNOWN" };
    expect(parseObservation(ok).verdict).toBe("PASS");
    expect(parseObservation(observation()).verdict).toBe("FAIL");
    expect(parseObservation(unknown).verdict).toBe("UNKNOWN");
    expect(() => parseObservation({ ...observation(), verdict: "PASS" })).toThrow("RSI_INVALID_CONTRACT");
    expect(() => parseObservation({ ...ok, verdict: "FAIL" })).toThrow("RSI_INVALID_CONTRACT");
  });

  it.each([null, [], "private payload", 1, { ...incident(), baseAppSha: "a".repeat(39) },
    { ...incident(), baseAppSha: "A".repeat(40) }, { ...incident(), workerVersion: "version/freeform" },
    { ...incident(), failedPaths: ["/login?token=fake"] }, { ...incident(), errorCode: "provider said secret" },
    { ...incident(), errorCode: "NONE" }, { ...incident(), failedPaths: [] },
  ])("rejects malformed identity without reflecting rejected values", (input) => {
    expect(() => parseIncidentIdentity(input)).toThrow(/^RSI_INVALID_CONTRACT$/);
  });

  it.each(["rawUrl", "headers", "body", "cookies", "token", "email", "hiddenAnswers", "stack", "message"])(
    "rejects raw/sensitive/hidden-answer field %s at every record boundary", (field) => {
      const payload = { [field]: "SYNTHETIC_PRIVATE_SENTINEL" };
      for (const parse of [
        () => parseObservation({ ...observation(), ...payload }),
        () => parseObservation({ ...observation(), window: { ...observation().window, ...payload } }),
        () => parseObservation({ ...observation(), incident: { ...incident(), ...payload } }),
        () => parseEvidenceReference({ ...receipt(), ...payload }),
        () => parseLineage({ ...lineage(), ...payload }),
        () => assertTransition({ ...transition("OBSERVED", "BLOCKED", [receipt()], "BUDGET_UNAVAILABLE"), ...payload }),
      ]) {
        expect(parse).toThrow(/^RSI_INVALID_CONTRACT$/);
        try { parse(); } catch (error) {
          expect(JSON.stringify(error)).not.toContain("SYNTHETIC_PRIVATE_SENTINEL");
          expect(String(error)).not.toContain(field);
        }
      }
    },
  );

  it("requires bounded structured references and fixed command IDs", () => {
    expect(parseEvidenceReference(receipt("RED_TEST", 1, "FAIL", "FOCUSED_TEST"))).toMatchObject({ verdict: "FAIL" });
    for (const evidence of [receipt("OBSERVATION", 1, "PASS", "FOCUSED_TEST"), receipt("CI", 1),
      receipt("RED_TEST", 1, "FAIL", "pnpm exec anything"), { ...receipt(), digest: "b".repeat(63) },
      { ...receipt(), digest: "B".repeat(64) }, { ...receipt(), evidenceId: "email@example.test" },
    ]) expect(() => parseEvidenceReference(evidence)).toThrow(/^RSI_INVALID_CONTRACT$/);
    expect(() => parseObservation({ ...observation(), evidence: [receipt(), receipt()] })).toThrow("RSI_INVALID_CONTRACT");
  });
});

describe("R1 run and incident lineage", () => {
  it("separates run IDs, attempts and recurrence epochs", () => {
    const first = lineage();
    expect(parseLineage(first).attempt).toBe(1);
    expect(parseLineage({ ...first, runId: uuid(4), parentRunId: first.runId, attempt: 2 }).attempt).toBe(2);
    const parentIncidentId = deriveIncidentId({ incidentKey: first.incidentKey, incidentEpoch: 1 });
    const next = { ...first, incidentEpoch: 2, parentIncidentId };
    expect(parseLineage(next).incidentEpoch).toBe(2);
    expect(deriveIncidentId({ incidentKey: next.incidentKey, incidentEpoch: next.incidentEpoch })).not.toBe(parentIncidentId);
  });

  it.each([
    { incidentEpoch: 0 }, { incidentEpoch: 2 }, { parentIncidentId: digest },
    { attempt: 0 }, { attempt: 2 }, { attempt: 1, parentRunId: uuid(4) },
    { attempt: 2, parentRunId: uuid(3) }, { parentAgentHash: "not-a-hash" },
    { controllerHash: "b".repeat(63) }, { eventFingerprint: "a".repeat(40) },
  ])("rejects invalid epoch/parent/attempt/hash relationship", (change) => {
    expect(() => parseLineage({ ...lineage(), ...change })).toThrow("RSI_INVALID_CONTRACT");
  });

  it("rejects an incident as its own parent and does not accept unrelated extra fields for ID derivation", () => {
    const next = { ...lineage(), incidentEpoch: 2 };
    expect(() => parseLineage({ ...next, parentIncidentId: deriveIncidentId({ incidentKey: next.incidentKey, incidentEpoch: 2 }) }))
      .toThrow("RSI_INVALID_CONTRACT");
    expect(() => deriveIncidentId({ incidentKey: next.incidentKey, incidentEpoch: 2, secret: "fake" }))
      .toThrow("RSI_INVALID_CONTRACT");
  });
});

describe("R1 legal status and receipt gates (shape only; no execution authority)", () => {
  const gates = [
    ["OBSERVED", "TRIAGED", [receipt("HYPOTHESIS", 1, "UNKNOWN"), receipt("HYPOTHESIS", 2, "UNKNOWN")]],
    ["TRIAGED", "REPRODUCED", [receipt("REPRODUCTION", 1), receipt("RED_TEST", 2, "FAIL", "FOCUSED_TEST")]],
    ["REPRODUCED", "PATCHED", [receipt("DIFF", 1), receipt("PATH_ALLOWLIST", 2), receipt("INPUT_MATCH", 3)]],
    ["PATCHED", "VERIFIED", [receipt("GREEN_TEST", 1, "PASS", "FOCUSED_TEST"), receipt("REGRESSION", 2, "PASS", "REGRESSION_TEST"),
      receipt("AUTHORIZATION", 3), receipt("BUDGET", 4), ...["CI_UNIT", "CI_INTEGRATION", "CI_BUILD", "CI_PLAYWRIGHT_SMOKE"]
        .map((id, i) => receipt("CI", i + 5, "PASS", id))]],
    ["VERIFIED", "PR_READY", [receipt("OUTCOME", 1), receipt("PR_REVIEW", 2)]],
    ["PR_READY", "MERGED", [receipt("MERGE", 1)]],
    ["MERGED", "LIVE_VERIFIED", [receipt("DEPLOYMENT", 1), receipt("LIVE_PROBE", 2)]],
  ] as const;

  it.each(gates)("allows %s → %s with distinct required receipts", (from, to, evidence) => {
    expect(assertTransition(transition(from, to, [...evidence]))).toMatchObject({ from, to });
  });

  it.each(gates)("rejects %s → %s when one receipt is absent", (from, to, evidence) => {
    for (let i = 0; i < evidence.length; i++)
      expect(() => assertTransition(transition(from, to, evidence.filter((_, j) => i !== j))))
        .toThrow("RSI_MISSING_EVIDENCE");
  });

  it.each(["OBSERVED", "TRIAGED", "REPRODUCED", "PATCHED", "VERIFIED", "PR_READY", "MERGED"])(
    "allows bounded terminal outcomes from %s", (from) => {
      for (const to of ["REJECTED", "BLOCKED", "INCONCLUSIVE"])
        expect(assertTransition(transition(from, to, [receipt()], "EVIDENCE_UNKNOWN")).to).toBe(to);
      expect(assertTransition(transition(from, "NO_CHANGE", [receipt("NO_CHANGE")], "EXTERNAL_FAILURE")).to).toBe("NO_CHANGE");
    },
  );

  it("requires explicit normal/external evidence to close without a patch", () => {
    expect(() => assertTransition(transition("OBSERVED", "NO_CHANGE", [receipt()], "EXTERNAL_FAILURE")))
      .toThrow("RSI_MISSING_EVIDENCE");
    expect(() => assertTransition(transition("OBSERVED", "NO_CHANGE", [receipt("NO_CHANGE")], "STAGE_EVIDENCE")))
      .toThrow("RSI_MISSING_EVIDENCE");
  });

  it.each([
    ["OBSERVED", "PR_READY"], ["OBSERVED", "MERGED"], ["OBSERVED", "LIVE_VERIFIED"],
    ["PATCHED", "PATCHED"], ["VERIFIED", "TRIAGED"], ["BLOCKED", "OBSERVED"],
    ["INCONCLUSIVE", "REPRODUCED"], ["REJECTED", "PR_READY"], ["NO_CHANGE", "OBSERVED"],
    ["LIVE_VERIFIED", "OBSERVED"],
  ])("rejects skip, replay, backward or closed transition %s → %s", (from, to) => {
    expect(() => assertTransition(transition(from, to))).toThrow("RSI_ILLEGAL_TRANSITION");
  });

  it("cannot substitute CI, scheduled intent, UNKNOWN or FAIL for deployment and live PASS receipts", () => {
    for (const evidence of [
      [receipt("CI", 1, "PASS", "CI_UNIT"), receipt("CI", 2, "PASS", "CI_BUILD")],
      [receipt("DEPLOYMENT", 1), receipt("LIVE_PROBE", 2, "UNKNOWN")],
      [receipt("DEPLOYMENT", 1), receipt("LIVE_PROBE", 2, "FAIL")],
      [receipt("OBSERVATION", 1), receipt("LIVE_PROBE", 2)],
    ]) expect(() => assertTransition(transition("MERGED", "LIVE_VERIFIED", evidence))).toThrow("RSI_MISSING_EVIDENCE");
    expect(() => assertTransition(transition("MERGED", "LIVE_VERIFIED", [receipt("DEPLOYMENT"), receipt("LIVE_PROBE")])))
      .toThrow("RSI_INVALID_CONTRACT");
  });

  it("never upgrades a non-RED reproduction or an incomplete/failing CI set", () => {
    for (const verdict of ["PASS", "UNKNOWN"])
      expect(() => assertTransition(transition("TRIAGED", "REPRODUCED", [receipt("REPRODUCTION"), receipt("RED_TEST", 2, verdict, "FOCUSED_TEST")])))
        .toThrow("RSI_MISSING_EVIDENCE");
    const verified = [...gates[3][2]].map((row, i) => i === 5 ? { ...row, verdict: "UNKNOWN" } : row);
    expect(() => assertTransition(transition("PATCHED", "VERIFIED", verified))).toThrow("RSI_MISSING_EVIDENCE");
    expect(() => assertTransition(transition("OBSERVED", "BLOCKED", [receipt()], "freeform private reason")))
      .toThrow(/^RSI_INVALID_CONTRACT$/);
  });
});
