import { describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { createApprovedSnapshot, lessonDigest, retrieveApprovedMemory, recordMemoryUse } from "../../scripts/rsi/memory";
const now = "2026-10-22T12:00:00.000Z";
function lesson() { return { schemaVersion: 1, lessonId: randomUUID(), status: "APPROVED", createdAtUtc: "2026-10-21T00:00:00.000Z", expiresAtUtc: "2026-11-01T00:00:00.000Z", selector: { errorCode: "HTTP_STATUS", runtime: "NODE_SYNTHETIC", conditions: ["STATUS_FAILURE"] }, policy: "REPRODUCE_FIRST", evidenceDigest: "a".repeat(64), approval: { prNumber: 319, mergeSha: "b".repeat(40) } }; }
function approval(l: ReturnType<typeof lesson>) { return { lessonId: l.lessonId, lessonDigest: lessonDigest(l), ...l.approval }; }
const query = { errorCode: "HTTP_STATUS", runtime: "NODE_SYNTHETIC", conditions: ["STATUS_FAILURE"] };
describe("approved synthetic memory", () => {
  it("content-addresses sorted approved lessons and records deterministic selection provenance", () => {
    const a = lesson(), b = lesson(); const approvals = [approval(a), approval(b)];
    const first = createApprovedSnapshot([a, b], approvals, now); const reverse = createApprovedSnapshot([b, a], approvals, now);
    expect(first).toEqual(reverse);
    const result = retrieveApprovedMemory(first, { expectedHash: first.hash, approvals, nowUtc: now, query });
    expect(result.snapshotHash).toBe(first.hash); expect(result.selectedLessonIds).toEqual([a.lessonId, b.lessonId].sort());
    expect(result.decisions.every((d) => d.reasonCode === "SELECTOR_MATCH")).toBe(true);
    const use = recordMemoryUse(result, result.selectedLessonIds.map((lessonId) => ({ lessonId, outcome: "USED", reasonCode: "APPLIED" })));
    expect(use.decisions.every((d) => d.outcome === "USED")).toBe(true);
  });
  it("rejects unapproved, expired, future, tampered and hidden fields with sanitized errors", () => {
    const l = lesson(), approvals = [approval(l)]; const snapshot = createApprovedSnapshot([l], approvals, now);
    expect(() => createApprovedSnapshot([l], [], now)).toThrow("RSI_MEMORY");
    expect(() => createApprovedSnapshot([{ ...l, status: "PROPOSED" }], approvals, now)).toThrow("RSI_MEMORY");
    expect(() => createApprovedSnapshot([{ ...l, hiddenAnswers: "sensitive" }], approvals, now)).toThrow("RSI_MEMORY");
    expect(() => createApprovedSnapshot([l], approvals, "2026-11-01T00:00:00.000Z")).toThrow("RSI_MEMORY");
    expect(() => createApprovedSnapshot([l], approvals, "2026-10-20T00:00:00.000Z")).toThrow("RSI_MEMORY");
    expect(() => retrieveApprovedMemory({ ...snapshot, lessons: [{ ...l, policy: "RETRY_WITHIN_BUDGET" }] }, { expectedHash: snapshot.hash, approvals, nowUtc: now, query })).toThrow("RSI_MEMORY");
    expect(() => retrieveApprovedMemory(snapshot, { expectedHash: "c".repeat(64), approvals, nowUtc: now, query })).toThrow("RSI_MEMORY");
    expect(() => retrieveApprovedMemory(snapshot, { expectedHash: snapshot.hash, approvals: [], nowUtc: now, query })).toThrow("RSI_MEMORY");
  });
  it("limits snapshots to five unique lessons and rejects forged approval references", () => {
    const lessons = Array.from({ length: 6 }, lesson); expect(() => createApprovedSnapshot(lessons, lessons.map(approval), now)).toThrow("RSI_MEMORY");
    const l = lesson(); expect(() => createApprovedSnapshot([l, l], [approval(l)], now)).toThrow("RSI_MEMORY");
    expect(() => createApprovedSnapshot([l], [{ ...approval(l), prNumber: 320 }], now)).toThrow("RSI_MEMORY");
  });
  it("survives JSON serialization and rechecks expiry, revocation, duplicates and reason consistency", () => {
    const l = lesson(), approvals = [approval(l)], original = createApprovedSnapshot([l], approvals, now);
    const snapshot = JSON.parse(JSON.stringify(original));
    const request = { expectedHash: snapshot.hash, approvals, nowUtc: now, query };
    const result = retrieveApprovedMemory(snapshot, request);
    expect(() => retrieveApprovedMemory(snapshot, { ...request, nowUtc: l.expiresAtUtc })).toThrow("RSI_MEMORY");
    expect(() => retrieveApprovedMemory(snapshot, { ...request, approvals: [{ ...approvals[0], lessonDigest: "c".repeat(64) }] })).toThrow("RSI_MEMORY");
    expect(() => createApprovedSnapshot([l], [approvals[0], approvals[0]], now)).toThrow("RSI_MEMORY");
    expect(() => createApprovedSnapshot([{ ...l, schemaVersion: 2 }], approvals, now)).toThrow("RSI_MEMORY");
    expect(() => recordMemoryUse(result, [])).toThrow("RSI_MEMORY");
    expect(() => recordMemoryUse(result, [{ lessonId: l.lessonId, outcome: "USED", reasonCode: "POLICY_CONFLICT" }])).toThrow("RSI_MEMORY");
    expect(recordMemoryUse(result, [{ lessonId: l.lessonId, outcome: "REJECTED", reasonCode: "NOT_APPLICABLE" }]).decisions[0].outcome).toBe("REJECTED");
    expect(createApprovedSnapshot([], [], now).lessons).toEqual([]);
  });
  it("filters fixed selectors and disallows use of unselected or tampered provenance", () => {
    const l = lesson(), approvals = [approval(l)], snapshot = createApprovedSnapshot([l], approvals, now);
    const result = retrieveApprovedMemory(snapshot, { expectedHash: snapshot.hash, approvals, nowUtc: now, query: { ...query, runtime: "WORKER_SYNTHETIC" } });
    expect(result.selectedLessonIds).toEqual([]); expect(result.decisions[0].reasonCode).toBe("SELECTOR_MISMATCH");
    expect(() => recordMemoryUse(result, [{ lessonId: l.lessonId, outcome: "USED", reasonCode: "APPLIED" }])).toThrow("RSI_MEMORY");
    expect(() => recordMemoryUse({ ...result, selectedLessonIds: [l.lessonId] }, [])).toThrow("RSI_MEMORY");
    expect(() => retrieveApprovedMemory(snapshot, { expectedHash: snapshot.hash, approvals, nowUtc: now, query: { ...query, body: "secret" } })).toThrow("RSI_MEMORY");
  });
});
