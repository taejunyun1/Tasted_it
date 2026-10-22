import { createHash } from "node:crypto";
import { z } from "zod";
import { deriveKst } from "./contracts";

// The caller supplies a trusted, PR-reviewed approval allowlist. These local
// functions check its binding, not GitHub identity or actual approval truth.
const digest = z.string().regex(/^[a-f0-9]{64}$/);
const id = z.uuid().transform((v) => v.toLowerCase());
const utc = z.string().refine((v) => { try { deriveKst(v); return true; } catch { return false; } });
const approvalReference = z.strictObject({ prNumber: z.number().int().min(1).max(2_147_483_647), mergeSha: z.string().regex(/^[a-f0-9]{40}$/) });
const selector = z.strictObject({
  errorCode: z.enum(["HTTP_STATUS", "REDIRECT_MISMATCH", "NETWORK_TIMEOUT", "UNEXPECTED_ERROR", "UNKNOWN"]),
  runtime: z.enum(["NODE_SYNTHETIC", "WORKER_SYNTHETIC"]),
  conditions: z.array(z.enum(["STATUS_FAILURE", "REDIRECT_FAILURE", "TIMEOUT", "UNKNOWN_EVIDENCE"])).min(1).max(4)
    .refine((v) => new Set(v).size === v.length).transform((v) => [...v].sort()),
});
const lessonSchema = z.strictObject({
  schemaVersion: z.literal(1), lessonId: id, status: z.literal("APPROVED"),
  createdAtUtc: utc, expiresAtUtc: utc, selector,
  policy: z.enum(["REPRODUCE_FIRST", "RECHECK_REDIRECT", "PRESERVE_UNKNOWN", "RETRY_WITHIN_BUDGET", "NO_CHANGE_EXTERNAL"]),
  evidenceDigest: digest, approval: approvalReference,
}).refine((v) => v.createdAtUtc < v.expiresAtUtc);
const lessonsSchema = z.array(lessonSchema).max(5).refine((v) => new Set(v.map((l) => l.lessonId)).size === v.length)
  .transform((v) => [...v].sort((a, b) => a.lessonId < b.lessonId ? -1 : 1));
const approvalsSchema = z.array(approvalReference.extend({ lessonId: id, lessonDigest: digest })).max(100)
  .refine((v) => new Set(v.map((a) => a.lessonId)).size === v.length);
const snapshotSchema = z.strictObject({ schemaVersion: z.literal(1), lessons: lessonsSchema, hash: digest });
const requestSchema = z.strictObject({ expectedHash: digest, approvals: approvalsSchema, nowUtc: utc, query: selector });
const decisionSchema = z.strictObject({
  lessonId: id, outcome: z.enum(["SELECTED", "USED", "REJECTED"]),
  reasonCode: z.enum(["SELECTOR_MATCH", "SELECTOR_MISMATCH", "APPLIED", "NOT_APPLICABLE", "POLICY_CONFLICT"]),
}).refine((v) => v.outcome === "SELECTED" ? v.reasonCode === "SELECTOR_MATCH"
  : v.outcome === "USED" ? v.reasonCode === "APPLIED" : ["SELECTOR_MISMATCH", "NOT_APPLICABLE", "POLICY_CONFLICT"].includes(v.reasonCode));
const retrievalSchema = z.strictObject({
  schemaVersion: z.literal(1), snapshotHash: digest, query: selector, retrievedAtUtc: utc,
  selectedLessonIds: z.array(id).max(5), decisions: z.array(decisionSchema).max(5), provenanceHash: digest,
});
const usesSchema = z.array(z.strictObject({ lessonId: id, outcome: z.enum(["USED", "REJECTED"]), reasonCode: z.enum(["APPLIED", "NOT_APPLICABLE", "POLICY_CONFLICT"]) })).max(5)
  .refine((v) => new Set(v.map((r) => r.lessonId)).size === v.length);
export type RsiApprovedSnapshot = z.infer<typeof snapshotSchema>;
export type RsiMemoryRetrieval = z.infer<typeof retrievalSchema>;
function fail(): never { throw new Error("RSI_MEMORY_INVALID"); }
function parse<T>(schema: z.ZodType<T>, input: unknown): T { try { return schema.parse(input); } catch { return fail(); } }
function hash(value: unknown) { return createHash("sha256").update(JSON.stringify(value)).digest("hex"); }
export function lessonDigest(input: unknown): string { return hash(["rsi-lesson-v1", parse(lessonSchema, input)]); }
function approved(lessons: z.infer<typeof lessonsSchema>, approvals: z.infer<typeof approvalsSchema>, now: string) {
  for (const lesson of lessons) {
    if (!(lesson.createdAtUtc <= now && now < lesson.expiresAtUtc)) fail();
    if (!approvals.some((a) => a.lessonId === lesson.lessonId && a.lessonDigest === lessonDigest(lesson)
      && a.prNumber === lesson.approval.prNumber && a.mergeSha === lesson.approval.mergeSha)) fail();
  }
}
export function createApprovedSnapshot(input: unknown, trustedApprovals: unknown, nowUtc: unknown): RsiApprovedSnapshot {
  const lessons = parse(lessonsSchema, input), approvals = parse(approvalsSchema, trustedApprovals), now = parse(utc, nowUtc);
  approved(lessons, approvals, now);
  return { schemaVersion: 1, lessons, hash: hash(["rsi-memory-snapshot-v1", lessons]) };
}
function provenance(value: Omit<RsiMemoryRetrieval, "provenanceHash">): RsiMemoryRetrieval {
  return { ...value, provenanceHash: hash(["rsi-retrieval-v1", value]) };
}
export function retrieveApprovedMemory(input: unknown, request: unknown): RsiMemoryRetrieval {
  const snapshot = parse(snapshotSchema, input), options = parse(requestSchema, request);
  if (snapshot.hash !== options.expectedHash || snapshot.hash !== hash(["rsi-memory-snapshot-v1", snapshot.lessons])) fail();
  approved(snapshot.lessons, options.approvals, options.nowUtc);
  const decisions: z.infer<typeof decisionSchema>[] = snapshot.lessons.map((lesson) => {
    const match = lesson.selector.errorCode === options.query.errorCode && lesson.selector.runtime === options.query.runtime
      && lesson.selector.conditions.every((condition) => options.query.conditions.includes(condition));
    return { lessonId: lesson.lessonId, outcome: match ? "SELECTED" : "REJECTED", reasonCode: match ? "SELECTOR_MATCH" : "SELECTOR_MISMATCH" };
  });
  return provenance({ schemaVersion: 1, snapshotHash: snapshot.hash, query: options.query, retrievedAtUtc: options.nowUtc,
    selectedLessonIds: decisions.filter((d) => d.outcome === "SELECTED").map((d) => d.lessonId), decisions });
}
export function recordMemoryUse(input: unknown, uses: unknown): RsiMemoryRetrieval {
  const retrieval = parse(retrievalSchema, input), decisions = parse(usesSchema, uses);
  const { provenanceHash, ...body } = retrieval;
  if (provenance(body).provenanceHash !== provenanceHash
    || new Set(body.selectedLessonIds).size !== body.selectedLessonIds.length
    || new Set(body.decisions.map((d) => d.lessonId)).size !== body.decisions.length
    || body.decisions.some((d) => d.outcome !== "SELECTED" && d.reasonCode !== "SELECTOR_MISMATCH")
    || JSON.stringify(body.selectedLessonIds) !== JSON.stringify(body.decisions.filter((d) => d.outcome === "SELECTED").map((d) => d.lessonId))
    || decisions.length !== body.selectedLessonIds.length
    || decisions.some((d) => !body.selectedLessonIds.includes(d.lessonId))) fail();
  return provenance({ ...body, decisions: body.decisions.map((decision) => {
    const use = decisions.find((d) => d.lessonId === decision.lessonId);
    return use ? parse(decisionSchema, use) : decision;
  }) });
}
