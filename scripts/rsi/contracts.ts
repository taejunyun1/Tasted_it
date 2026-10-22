import { createHash } from "node:crypto";
import { z } from "zod";

// Local synthetic contracts only. A valid reference is not trusted execution
// evidence, permission to run a tool, or proof of recovery. A future trusted
// evaluator must resolve receipts and enforce their provenance independently.
export const RSI_SCHEMA_VERSION = 1 as const;
export const RSI_PUBLIC_PATHS = ["/", "/places", "/login", "/admin", "/robots.txt", "/privacy"] as const;

const digestSchema = z.string().regex(/^[a-f0-9]{64}$/);
const shaSchema = z.string().regex(/^[a-f0-9]{40}$/);
const idSchema = z.uuid().transform((value) => value.toLowerCase());
const pathSchema = z.enum(RSI_PUBLIC_PATHS);
const verdictSchema = z.enum(["UNKNOWN", "FAIL", "PASS"]);
const utcSchema = z.string().regex(/^20\d{2}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/)
  .refine((value) => {
    const time = Date.parse(value);
    return Number.isFinite(time) && new Date(time).toISOString() === value;
  });
const commandSchema = z.enum([
  "FOCUSED_TEST", "REGRESSION_TEST", "CI_UNIT", "CI_INTEGRATION", "CI_BUILD", "CI_PLAYWRIGHT_SMOKE",
]);
const evidenceKindSchema = z.enum([
  "OBSERVATION", "HYPOTHESIS", "COUNTEREXAMPLE", "REPRODUCTION", "DIFF", "PATH_ALLOWLIST", "INPUT_MATCH",
  "RED_TEST", "GREEN_TEST", "REGRESSION", "AUTHORIZATION", "CI", "BUDGET", "OUTCOME", "PR_REVIEW",
  "MERGE", "DEPLOYMENT", "LIVE_PROBE", "NO_CHANGE",
]);
const evidenceSchema = z.strictObject({
  evidenceId: idSchema,
  kind: evidenceKindSchema,
  digest: digestSchema,
  verdict: verdictSchema,
  commandId: commandSchema.nullable(),
}).refine((value) => {
  if (value.kind === "RED_TEST" || value.kind === "GREEN_TEST") return value.commandId === "FOCUSED_TEST";
  if (value.kind === "REGRESSION") return value.commandId === "REGRESSION_TEST";
  if (value.kind === "CI") return value.commandId?.startsWith("CI_") === true;
  return value.commandId === null;
});
const evidenceListSchema = z.array(evidenceSchema).max(64)
  .refine((rows) => new Set(rows.map((row) => row.evidenceId)).size === rows.length)
  .transform((rows) => [...rows].sort((a, b) => a.evidenceId < b.evidenceId ? -1 : a.evidenceId > b.evidenceId ? 1 : 0));

const incidentIdentitySchema = z.strictObject({
  source: z.enum(["RSI_SELF_CHECK", "LOCAL_SYNTHETIC"]),
  baseAppSha: shaSchema,
  workerVersion: idSchema,
  errorCode: z.enum(["NONE", "HTTP_STATUS", "REDIRECT_MISMATCH", "NETWORK_TIMEOUT", "UNEXPECTED_ERROR", "UNKNOWN"]),
  failedPaths: z.array(pathSchema).max(24).transform((paths) => [...new Set(paths)].sort()),
}).refine((value) => {
  if (value.errorCode === "NONE") return value.failedPaths.length === 0;
  return value.errorCode === "UNKNOWN" || value.failedPaths.length > 0;
});

const observationSchema = z.strictObject({
  schemaVersion: z.literal(RSI_SCHEMA_VERSION),
  environment: z.literal("LOCAL_SYNTHETIC"),
  target: z.literal("RSI_PUBLIC_SIX_PATHS"),
  incident: incidentIdentitySchema,
  trigger: z.enum(["scheduled", "admin", "on-demand"]),
  actor: z.enum(["SYSTEM", "ADMIN", "OPERATOR"]),
  sourceEventId: idSchema,
  observedAtUtc: utcSchema,
  observedAtKst: z.string().regex(/^20\d{2}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}\+09:00$/),
  window: z.strictObject({ startUtc: utcSchema, endUtc: utcSchema }),
  checkedPaths: z.array(pathSchema).length(6)
    .refine((paths) => new Set(paths).size === RSI_PUBLIC_PATHS.length)
    .transform((paths) => [...paths].sort()),
  verdict: verdictSchema,
  evidence: evidenceListSchema.refine((rows) => rows.length > 0),
}).refine((value) => {
  const actor = { scheduled: "SYSTEM", admin: "ADMIN", "on-demand": "OPERATOR" }[value.trigger];
  if (value.actor !== actor || value.observedAtKst !== kstFromUtc(value.observedAtUtc)) return false;
  if (!(value.window.startUtc <= value.observedAtUtc && value.observedAtUtc < value.window.endUtc)) return false;
  if (value.verdict === "PASS") return value.incident.errorCode === "NONE";
  if (value.verdict === "FAIL") return value.incident.errorCode !== "NONE" && value.incident.failedPaths.length > 0;
  return value.incident.errorCode === "UNKNOWN";
});

const incidentIdSchema = z.strictObject({
  incidentKey: digestSchema,
  incidentEpoch: z.number().int().min(1).max(1_000_000),
});
const lineageSchema = z.strictObject({
  schemaVersion: z.literal(RSI_SCHEMA_VERSION),
  runId: idSchema,
  parentRunId: idSchema.nullable(),
  attempt: z.number().int().min(1).max(10_000),
  incidentKey: digestSchema,
  incidentEpoch: z.number().int().min(1).max(1_000_000),
  parentIncidentId: digestSchema.nullable(),
  eventFingerprint: digestSchema,
  baseAppSha: shaSchema,
  parentAgentHash: digestSchema,
  candidateAgentHash: digestSchema,
  controllerHash: digestSchema,
  evaluatorHash: digestSchema,
  memorySnapshotHash: digestSchema,
}).refine((value) => {
  if (value.attempt === 1 ? value.parentRunId !== null : value.parentRunId === null) return false;
  if (value.runId === value.parentRunId) return false;
  if (value.incidentEpoch === 1) return value.parentIncidentId === null;
  return value.parentIncidentId === incidentId(value.incidentKey, value.incidentEpoch - 1);
});

const activeStatuses = ["OBSERVED", "TRIAGED", "REPRODUCED", "PATCHED", "VERIFIED", "PR_READY", "MERGED", "LIVE_VERIFIED"] as const;
const closedStatuses = ["REJECTED", "BLOCKED", "INCONCLUSIVE", "NO_CHANGE"] as const;
const statusSchema = z.enum([...activeStatuses, ...closedStatuses]);
const transitionSchema = z.strictObject({
  schemaVersion: z.literal(RSI_SCHEMA_VERSION),
  from: statusSchema,
  to: statusSchema,
  evidence: evidenceListSchema,
  reasonCode: z.enum([
    "STAGE_EVIDENCE", "EVIDENCE_UNKNOWN", "BUDGET_UNAVAILABLE", "POLICY_REJECTED", "REPRODUCTION_FAILED",
    "NORMAL", "EXTERNAL_FAILURE", "OPERATOR_STOP", "CANCELLED",
  ]),
});

export type RsiVerdict = z.infer<typeof verdictSchema>;
export type RsiStatus = z.infer<typeof statusSchema>;
export type RsiEvidenceReference = z.infer<typeof evidenceSchema>;
export type RsiIncidentIdentity = z.infer<typeof incidentIdentitySchema>;
export type RsiObservation = z.infer<typeof observationSchema>;
export type RsiLineage = z.infer<typeof lineageSchema>;
export type RsiTransition = z.infer<typeof transitionSchema>;

// Never expose Zod errors: unknown property names and rejected enum values may
// contain sensitive input. These parsers deliberately omit causes and input.
function parse<T>(schema: z.ZodType<T>, input: unknown): T {
  try {
    const result = schema.safeParse(input);
    if (result.success) return result.data;
  } catch {
    // Malformed objects can also throw while being read. Fail closed.
  }
  throw new Error("RSI_INVALID_CONTRACT");
}

export function parseEvidenceReference(input: unknown): RsiEvidenceReference {
  return parse(evidenceSchema, input);
}

export function parseIncidentIdentity(input: unknown): RsiIncidentIdentity {
  return parse(incidentIdentitySchema, input);
}

export function parseObservation(input: unknown): RsiObservation {
  return parse(observationSchema, input);
}

export function parseLineage(input: unknown): RsiLineage {
  return parse(lineageSchema, input);
}

function kstFromUtc(utc: string): string {
  return `${new Date(Date.parse(utc) + 9 * 60 * 60 * 1_000).toISOString().slice(0, -1)}+09:00`;
}

export function deriveKst(input: unknown): string {
  return kstFromUtc(parse(utcSchema, input));
}

function hash(parts: unknown[]): string {
  return createHash("sha256").update(JSON.stringify(parts)).digest("hex");
}

export function deriveIncidentKey(input: unknown): string {
  const value = parseIncidentIdentity(input);
  return hash(["rsi-incident-v1", value.source, value.baseAppSha, value.workerVersion, value.errorCode, value.failedPaths]);
}

function incidentId(key: string, epoch: number): string {
  return hash(["rsi-incident-epoch-v1", key, epoch]);
}

export function deriveIncidentId(input: unknown): string {
  const value = parse(incidentIdSchema, input);
  return incidentId(value.incidentKey, value.incidentEpoch);
}

export function deriveObservationFingerprint(input: unknown): string {
  const value = parseObservation(input);
  return hash([
    "rsi-observation-v1", deriveIncidentKey(value.incident), value.environment, value.target,
    value.trigger, value.actor, value.sourceEventId, value.observedAtUtc, value.observedAtKst,
    value.window.startUtc, value.window.endUtc, value.checkedPaths, value.verdict,
    value.evidence.map((row) => [row.evidenceId, row.kind, row.digest, row.verdict, row.commandId]),
  ]);
}

// This only checks the sequential state graph and required receipt shapes.
// It intentionally does not mutate a ledger, resolve a digest, execute a test,
// validate a GitHub approval, deploy, or establish that a live probe happened.
export function assertTransition(input: unknown): RsiTransition {
  const value = parse(transitionSchema, input);
  const fromIndex = activeStatuses.findIndex((status) => status === value.from);
  const sequential = fromIndex >= 0 && activeStatuses[fromIndex + 1] === value.to;
  const terminal = fromIndex >= 0 && value.from !== "LIVE_VERIFIED"
    && closedStatuses.some((status) => status === value.to);
  if (!sequential && !terminal) throw new Error("RSI_ILLEGAL_TRANSITION");

  const has = (kind: RsiEvidenceReference["kind"], verdict: RsiVerdict = "PASS", commandId?: RsiEvidenceReference["commandId"]) =>
    value.evidence.some((row) => row.kind === kind && row.verdict === verdict
      && (commandId === undefined || row.commandId === commandId));
  let complete: boolean;
  switch (value.to) {
    case "TRIAGED":
      // UNKNOWN stays UNKNOWN; hypotheses are references to structured evidence,
      // not freeform confidence or confirmation of a root cause.
      complete = value.evidence.filter((row) => row.kind === "HYPOTHESIS").length >= 2;
      break;
    case "REPRODUCED":
      complete = has("REPRODUCTION") && has("RED_TEST", "FAIL", "FOCUSED_TEST");
      break;
    case "PATCHED":
      complete = has("DIFF") && has("PATH_ALLOWLIST") && has("INPUT_MATCH");
      break;
    case "VERIFIED":
      complete = has("GREEN_TEST", "PASS", "FOCUSED_TEST") && has("REGRESSION", "PASS", "REGRESSION_TEST")
        && has("AUTHORIZATION") && has("BUDGET")
        && (["CI_UNIT", "CI_INTEGRATION", "CI_BUILD", "CI_PLAYWRIGHT_SMOKE"] as const)
          .every((command) => has("CI", "PASS", command));
      break;
    case "PR_READY":
      complete = has("OUTCOME") && has("PR_REVIEW");
      break;
    case "MERGED":
      complete = has("MERGE");
      break;
    case "LIVE_VERIFIED":
      complete = has("DEPLOYMENT") && has("LIVE_PROBE");
      break;
    case "NO_CHANGE":
      complete = has("NO_CHANGE") && (value.reasonCode === "NORMAL" || value.reasonCode === "EXTERNAL_FAILURE");
      break;
    default:
      complete = value.evidence.length > 0 && value.reasonCode !== "STAGE_EVIDENCE";
  }
  if (!complete) throw new Error("RSI_MISSING_EVIDENCE");
  return value;
}
