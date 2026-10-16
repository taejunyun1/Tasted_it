import { describe, expect, it } from "vitest";
import { RSI_PUBLIC_PATH_CHECKS } from "../../app/features/operations/rsi-self-check";
import {
  allowedTransitions,
  appendObservation,
  classifyObservation,
  incidentKey,
  isFailingVerdict,
  isPassingVerdict,
  observationFingerprint,
  openIncident,
  parseLineage,
  parseObservation,
  parseVerdict,
  reopenIncident,
  RsiContractError,
  sha256Digest,
  transitionIncident,
  type Observation,
} from "../../scripts/rsi/contracts";

const sha = "a".repeat(40);
const digest = sha256Digest("evidence");
const runId = "6f1a2b3c-4d5e-4f60-8a9b-0c1d2e3f4a5b";

function paths(overrides: Record<string, { status: number; ok: boolean }> = {}) {
  return RSI_PUBLIC_PATH_CHECKS.map((check) => ({ path: check.path, status: check.status, ok: true, ...overrides[check.path] }));
}

function observation(overrides: Partial<Observation> = {}): Observation {
  return parseObservation({
    schemaVersion: 1,
    source: "worker-audit",
    audited: { trigger: "scheduled", actorUserId: null },
    observedAtUtc: "2026-10-15T06:47:00.000Z",
    eventId: "cron-2026-10-15T06:47Z",
    sourceSha: sha,
    workerVersion: null,
    outcome: { kind: "paths", paths: paths() },
    ...overrides,
  });
}

const failing = (verdict: "PASS" | "FAIL" | "UNKNOWN", evidenceKind = "native-workerd") =>
  parseVerdict({ verdict, evidenceKind, evidenceDigests: [digest], reasonCodes: verdict === "PASS" ? [] : ["BASE_RED"] });

const code = (fn: () => unknown) => {
  try {
    fn();
  } catch (error) {
    if (error instanceof RsiContractError) return error.code;
    throw error;
  }
  return "NO_ERROR";
};

describe("observation contract", () => {
  it("accepts a sanitized six-path scheduled audit", () => {
    expect(observation().outcome.kind).toBe("paths");
  });

  it("keeps scheduled and admin actors apart", () => {
    expect(code(() => observation({ audited: { trigger: "scheduled", actorUserId: "u1" } as never }))).toBe("SCHEMA_VIOLATION");
    expect(code(() => observation({ audited: { trigger: "admin", actorUserId: null } as never }))).toBe("SCHEMA_VIOLATION");
    expect(observation({ audited: { trigger: "admin", actorUserId: "u1" } }).audited.trigger).toBe("admin");
  });

  it("requires every fixed path exactly once", () => {
    const five = paths().slice(0, 5);
    expect(code(() => observation({ outcome: { kind: "paths", paths: five } }))).toBe("SCHEMA_VIOLATION");
    const duplicated = [...five, { ...five[0]! }];
    expect(code(() => observation({ outcome: { kind: "paths", paths: duplicated } }))).toBe("SCHEMA_VIOLATION");
    const unknown = [...five, { path: "/secret", status: 200, ok: true }];
    expect(code(() => observation({ outcome: { kind: "paths", paths: unknown as never } }))).toBe("SCHEMA_VIOLATION");
  });

  it("fails closed on redirect/cookie/token/PII surfaces and hidden answers", () => {
    const withLocation = paths().map((result) => ({ ...result, location: "/login?returnTo=%2Fadmin" }));
    expect(code(() => observation({ outcome: { kind: "paths", paths: withLocation as never } }))).toBe("SENSITIVE_VALUE");
    expect(code(() => observation({ eventId: "student@example.com" }))).toBe("SENSITIVE_VALUE");
    expect(code(() => observation({ eventId: "Bearer abc.def-ghi" }))).toBe("SENSITIVE_VALUE");
    expect(code(() => observation({ expected: "fetch receiver bug" } as never))).toBe("HIDDEN_ANSWER");
    expect(code(() => parseVerdict({ verdict: "FAIL", evidenceKind: "ci", evidenceDigests: [digest], reasonCodes: ["X"], oracle: 1 }))).toBe(
      "HIDDEN_ANSWER",
    );
  });

  it("rejects malformed git sha and schema version", () => {
    expect(code(() => observation({ sourceSha: "cf1f406" }))).toBe("SCHEMA_VIOLATION");
    expect(code(() => observation({ schemaVersion: 2 as never }))).toBe("SCHEMA_VIOLATION");
  });
});

describe("failure class and incident identity", () => {
  it("classifies network, status, redirect and healthy outcomes", () => {
    expect(classifyObservation(observation())).toBe("NONE");
    expect(classifyObservation(observation({ outcome: { kind: "paths", paths: paths({ "/": { status: 0, ok: false } }) } }))).toBe("NETWORK_FAILURE");
    expect(classifyObservation(observation({ outcome: { kind: "paths", paths: paths({ "/places": { status: 500, ok: false } }) } }))).toBe("STATUS_MISMATCH");
    expect(classifyObservation(observation({ outcome: { kind: "paths", paths: paths({ "/admin": { status: 302, ok: false } }) } }))).toBe("REDIRECT_MISMATCH");
    expect(classifyObservation(observation({ outcome: { kind: "uncaught" } }))).toBe("UNCAUGHT");
    expect(classifyObservation(observation({ outcome: { kind: "skipped", reason: "missing_origin" } }))).toBe("MISSING_ORIGIN");
    expect(classifyObservation(observation({ outcome: { kind: "audit_write_failed" } }))).toBe("AUDIT_WRITE_FAILED");
  });

  it("derives the same incidentKey across time, trigger and event while fingerprints differ", () => {
    const failed = { kind: "paths" as const, paths: paths({ "/": { status: 0, ok: false }, "/places": { status: 0, ok: false } }) };
    const first = observation({ outcome: failed });
    const later = observation({ outcome: failed, observedAtUtc: "2026-10-15T12:47:00.000Z", eventId: "cron-2026-10-15T12:47Z", audited: { trigger: "admin", actorUserId: "u1" } });
    expect(incidentKey(first)).toBe(incidentKey(later));
    expect(observationFingerprint(first)).not.toBe(observationFingerprint(later));
    expect(incidentKey(observation({ outcome: failed, sourceSha: "b".repeat(40) }))).not.toBe(incidentKey(first));
    expect(incidentKey(observation({ outcome: { kind: "paths", paths: paths({ "/": { status: 0, ok: false } }) } }))).not.toBe(incidentKey(first));
  });
});

describe("verdicts", () => {
  it("never counts UNKNOWN as GREEN or RED", () => {
    const unknown = failing("UNKNOWN");
    expect(isPassingVerdict(unknown)).toBe(false);
    expect(isFailingVerdict(unknown)).toBe(false);
    expect(isPassingVerdict(failing("PASS"))).toBe(true);
    expect(isFailingVerdict(failing("FAIL"))).toBe(true);
  });

  it("requires a reason code for FAIL/UNKNOWN and at least one evidence digest", () => {
    expect(code(() => parseVerdict({ verdict: "FAIL", evidenceKind: "ci", evidenceDigests: [digest], reasonCodes: [] }))).toBe("SCHEMA_VIOLATION");
    expect(code(() => parseVerdict({ verdict: "PASS", evidenceKind: "ci", evidenceDigests: [], reasonCodes: [] }))).toBe("SCHEMA_VIOLATION");
    expect(code(() => parseVerdict({ verdict: "PASS", evidenceKind: "ci", evidenceDigests: [digest], reasonCodes: ["lower"] }))).toBe("SCHEMA_VIOLATION");
  });
});

describe("incident status transitions", () => {
  const red = observation({ outcome: { kind: "paths", paths: paths({ "/": { status: 0, ok: false } }) } });

  it("walks the forward chain only with the required evidence", () => {
    let incident = openIncident(red);
    incident = transitionIncident(incident, "TRIAGED");
    expect(code(() => transitionIncident(incident, "REPRODUCED", { verdict: failing("UNKNOWN") }))).toBe("INVALID_TRANSITION");
    expect(code(() => transitionIncident(incident, "REPRODUCED", { verdict: failing("PASS") }))).toBe("INVALID_TRANSITION");
    incident = transitionIncident(incident, "REPRODUCED", { verdict: failing("FAIL") });
    expect(code(() => transitionIncident(incident, "PATCHED"))).toBe("INVALID_TRANSITION");
    incident = transitionIncident(incident, "PATCHED", { diffDigest: digest });
    expect(code(() => transitionIncident(incident, "VERIFIED", { verdict: failing("UNKNOWN") }))).toBe("INVALID_TRANSITION");
    incident = transitionIncident(incident, "VERIFIED", { verdict: failing("PASS") });
    incident = transitionIncident(incident, "PR_READY", { diffDigest: digest });
    expect(code(() => transitionIncident(incident, "MERGED"))).toBe("INVALID_TRANSITION");
    incident = transitionIncident(incident, "MERGED", { mergeSha: "c".repeat(40) });
    expect(code(() => transitionIncident(incident, "LIVE_VERIFIED", { verdict: failing("PASS", "ci") }))).toBe("INVALID_TRANSITION");
    incident = transitionIncident(incident, "LIVE_VERIFIED", { verdict: failing("PASS", "live-scheduled") });
    expect(allowedTransitions(incident.status)).toEqual([]);
  });

  it("rejects skipping stages and leaving terminal states", () => {
    const incident = openIncident(red);
    expect(code(() => transitionIncident(incident, "PATCHED", { diffDigest: digest }))).toBe("INVALID_TRANSITION");
    expect(code(() => transitionIncident(incident, "LIVE_VERIFIED", { verdict: failing("PASS", "live-scheduled") }))).toBe("INVALID_TRANSITION");
    const rejected = transitionIncident(incident, "REJECTED");
    expect(allowedTransitions("REJECTED")).toEqual([]);
    expect(code(() => transitionIncident(rejected, "TRIAGED"))).toBe("INVALID_TRANSITION");
  });

  it("closes NO_CHANGE only before reproduction", () => {
    expect(allowedTransitions("OBSERVED")).toContain("NO_CHANGE");
    expect(allowedTransitions("TRIAGED")).toContain("NO_CHANGE");
    expect(allowedTransitions("REPRODUCED")).not.toContain("NO_CHANGE");
    expect(allowedTransitions("MERGED")).toEqual(["LIVE_VERIFIED", "REJECTED", "BLOCKED", "INCONCLUSIVE"]);
  });

  it("appends repeated observations without changing state and opens a new epoch after closure", () => {
    const incident = transitionIncident(openIncident(red), "TRIAGED");
    const repeat = observation({ outcome: red.outcome, observedAtUtc: "2026-10-15T12:47:00.000Z", eventId: "cron-2" });
    const appended = appendObservation(incident, repeat);
    expect(appended.status).toBe("TRIAGED");
    expect(appended.observationFingerprints).toHaveLength(2);
    expect(appendObservation(appended, repeat)).toEqual(appended);
    const other = observation({ outcome: { kind: "paths", paths: paths({ "/places": { status: 500, ok: false } }) } });
    expect(code(() => appendObservation(incident, other))).toBe("INVALID_TRANSITION");
    expect(code(() => reopenIncident(incident, repeat))).toBe("INVALID_TRANSITION");

    const closed = transitionIncident(incident, "NO_CHANGE");
    expect(code(() => appendObservation(closed, repeat))).toBe("INVALID_TRANSITION");
    const reopened = reopenIncident(closed, repeat);
    expect(reopened).toMatchObject({ incidentEpoch: 2, parentIncidentKey: closed.incidentKey, status: "OBSERVED" });
    expect(code(() => reopenIncident(closed, other))).toBe("INVALID_TRANSITION");
  });
});

describe("lineage contract", () => {
  const lineage = {
    schemaVersion: 1,
    runId,
    attempt: 1,
    parentRunId: null,
    eventFingerprint: digest,
    baseAppSha: sha,
    parentAgentHash: sha256Digest("g0"),
    candidateAgentHash: sha256Digest("g1"),
    controllerHash: sha256Digest("controller"),
    evaluatorHash: sha256Digest("evaluator"),
  };

  it("parses a complete lineage and rejects short hashes or extra fields", () => {
    expect(parseLineage(lineage).attempt).toBe(1);
    expect(code(() => parseLineage({ ...lineage, baseAppSha: "cf1f406" }))).toBe("SCHEMA_VIOLATION");
    expect(code(() => parseLineage({ ...lineage, attempt: 0 }))).toBe("SCHEMA_VIOLATION");
    expect(code(() => parseLineage({ ...lineage, runId: "run-1" }))).toBe("SCHEMA_VIOLATION");
    expect(code(() => parseLineage({ ...lineage, apiToken: "x" }))).toBe("SENSITIVE_VALUE");
  });
});
