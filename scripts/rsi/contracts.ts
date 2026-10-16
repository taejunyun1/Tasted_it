// R1/T1 사건·계보 계약. 계획: docs/superpowers/plans/2026-10-15-rsi-agent-improvement.md §4, §5.1
// 순수 TS + Zod만 사용한다. 실행·네트워크·DB·모델 호출은 이 파일의 범위가 아니다.
import { createHash } from "node:crypto";
import { z } from "zod";
import { RSI_PUBLIC_PATH_CHECKS } from "../../app/features/operations/rsi-self-check";

export const RSI_CONTRACT_SCHEMA_VERSION = 1 as const;

export type RsiContractErrorCode = "SCHEMA_VIOLATION" | "SENSITIVE_VALUE" | "HIDDEN_ANSWER" | "INVALID_TRANSITION";

export class RsiContractError extends Error {
  constructor(readonly code: RsiContractErrorCode, message: string, readonly path: readonly string[] = []) {
    super(`${code}: ${message}${path.length ? ` at ${path.join(".")}` : ""}`);
    this.name = "RsiContractError";
  }
}

// --- 원시 식별자 ---------------------------------------------------------------
export const GitShaSchema = z.string().regex(/^[0-9a-f]{40}$/, "40-hex git sha");
export const DigestSchema = z.string().regex(/^sha256:[0-9a-f]{64}$/, "sha256 digest");
export const RunIdSchema = z.uuid();
export type Digest = z.infer<typeof DigestSchema>;

export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`);
    return `{${entries.join(",")}}`;
  }
  return JSON.stringify(value);
}

export function sha256Digest(input: string): Digest {
  return `sha256:${createHash("sha256").update(input).digest("hex")}`;
}

// --- 민감값·숨긴 정답 거부(fail closed) ---------------------------------------------
// 원문 리디렉션·쿠키·토큰·메일·전화·세션은 기록하지 않는다. 평가기의 정답은 후보가 보는 기록에 들어오면 거절한다.
const SENSITIVE_KEY = /(token|cookie|authorization|password|secret|location|returnto|e-?mail|phone|session|credential)/i;
const SENSITIVE_VALUE =
  /(bearer\s+[a-z0-9._~+/-]+=*|eyJ[a-z0-9_-]{8,}\.[a-z0-9_-]{8,}|[\w.+-]+@[\w-]+\.[\w.-]+|01[016789]-?\d{3,4}-?\d{4}|set-cookie|returnTo=)/i;
const HIDDEN_ANSWER_KEY = /^(expected|expectedRootCause|answer|answers|oracle|groundTruth|hiddenCase|hiddenCases|solution)$/i;

export type ForbiddenField = { code: "SENSITIVE_VALUE" | "HIDDEN_ANSWER"; path: string[] };

export function findForbiddenField(value: unknown, path: string[] = []): ForbiddenField | null {
  if (typeof value === "string") return SENSITIVE_VALUE.test(value) ? { code: "SENSITIVE_VALUE", path } : null;
  if (Array.isArray(value)) {
    for (const [index, item] of value.entries()) {
      const found = findForbiddenField(item, [...path, String(index)]);
      if (found) return found;
    }
    return null;
  }
  if (value && typeof value === "object") {
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      const keyPath = [...path, key];
      if (HIDDEN_ANSWER_KEY.test(key)) return { code: "HIDDEN_ANSWER", path: keyPath };
      if (SENSITIVE_KEY.test(key)) return { code: "SENSITIVE_VALUE", path: keyPath };
      const found = findForbiddenField(item, keyPath);
      if (found) return found;
    }
  }
  return null;
}

export function assertCandidateVisible(value: unknown) {
  const found = findForbiddenField(value);
  if (found) throw new RsiContractError(found.code, "forbidden field in candidate-visible record", found.path);
}

function parseStrict<T extends z.ZodType>(schema: T, value: unknown): z.infer<T> {
  assertCandidateVisible(value);
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new RsiContractError("SCHEMA_VIOLATION", issue?.message ?? "invalid", (issue?.path ?? []).map(String));
  }
  return parsed.data;
}

// --- 관측(Observation) ------------------------------------------------------------
// 기존 Worker 감사(rsi-scheduled / rsi-admin)와 같은 trigger·actor 분리를 유지한다.
export const AuditedTriggerSchema = z.discriminatedUnion("trigger", [
  z.object({ trigger: z.literal("scheduled"), actorUserId: z.null() }).strict(),
  z.object({ trigger: z.literal("admin"), actorUserId: z.string().min(1).max(128) }).strict(),
]);

export const RSI_HEALTHCHECK_PATHS = RSI_PUBLIC_PATH_CHECKS.map((check) => check.path) as [
  (typeof RSI_PUBLIC_PATH_CHECKS)[number]["path"],
  ...(typeof RSI_PUBLIC_PATH_CHECKS)[number]["path"][],
];
export type RsiHealthcheckPath = (typeof RSI_HEALTHCHECK_PATHS)[number];

export const PathResultSchema = z
  .object({ path: z.enum(RSI_HEALTHCHECK_PATHS), status: z.int().min(0).max(599), ok: z.boolean() })
  .strict();

const PathOutcomeSchema = z
  .object({ kind: z.literal("paths"), paths: z.array(PathResultSchema).length(RSI_HEALTHCHECK_PATHS.length) })
  .strict()
  .superRefine((outcome, ctx) => {
    const seen = new Set(outcome.paths.map((result) => result.path));
    if (seen.size !== RSI_HEALTHCHECK_PATHS.length) {
      ctx.addIssue({ code: "custom", message: "every fixed path exactly once", path: ["paths"] });
    }
  });

export const ObservationSchema = z
  .object({
    schemaVersion: z.literal(RSI_CONTRACT_SCHEMA_VERSION),
    source: z.literal("worker-audit"),
    audited: AuditedTriggerSchema,
    observedAtUtc: z.iso.datetime(),
    eventId: z.string().min(1).max(128),
    sourceSha: GitShaSchema,
    workerVersion: z.uuid().nullable(),
    outcome: z.discriminatedUnion("kind", [
      PathOutcomeSchema,
      z.object({ kind: z.literal("skipped"), reason: z.literal("missing_origin") }).strict(),
      z.object({ kind: z.literal("uncaught") }).strict(),
      z.object({ kind: z.literal("audit_write_failed") }).strict(),
    ]),
  })
  .strict();
export type Observation = z.infer<typeof ObservationSchema>;

export function parseObservation(value: unknown): Observation {
  return parseStrict(ObservationSchema, value);
}

// 고정 오류 분류. 우선순위가 높은 것 하나를 incidentKey에 사용한다.
export const FAILURE_CLASSES = [
  "UNCAUGHT",
  "AUDIT_WRITE_FAILED",
  "MISSING_ORIGIN",
  "NETWORK_FAILURE",
  "STATUS_MISMATCH",
  "REDIRECT_MISMATCH",
  "NONE",
] as const;
export type FailureClass = (typeof FAILURE_CLASSES)[number];

const expectedStatus = new Map<string, number>(RSI_PUBLIC_PATH_CHECKS.map((check) => [check.path, check.status]));

export function classifyObservation(observation: Observation): FailureClass {
  const { outcome } = observation;
  if (outcome.kind === "uncaught") return "UNCAUGHT";
  if (outcome.kind === "audit_write_failed") return "AUDIT_WRITE_FAILED";
  if (outcome.kind === "skipped") return "MISSING_ORIGIN";
  const classes = new Set<FailureClass>();
  for (const result of outcome.paths) {
    if (result.ok) continue;
    if (result.status === 0) classes.add("NETWORK_FAILURE");
    else if (result.status === expectedStatus.get(result.path)) classes.add("REDIRECT_MISMATCH");
    else classes.add("STATUS_MISMATCH");
  }
  return FAILURE_CLASSES.find((failureClass) => classes.has(failureClass)) ?? "NONE";
}

export function failedPaths(observation: Observation): RsiHealthcheckPath[] {
  if (observation.outcome.kind !== "paths") return [];
  return observation.outcome.paths
    .filter((result) => !result.ok)
    .map((result) => result.path)
    .sort();
}

// incidentKey: source/배포 버전·오류 분류·실패 경로 집합. 관측 시각·trigger·event ID는 fingerprint에만 들어간다.
export function incidentKey(observation: Observation): Digest {
  return sha256Digest(
    canonicalJson({
      sourceSha: observation.sourceSha,
      workerVersion: observation.workerVersion,
      failureClass: classifyObservation(observation),
      failedPaths: failedPaths(observation),
    }),
  );
}

export function observationFingerprint(observation: Observation): Digest {
  return sha256Digest(
    canonicalJson({
      incidentKey: incidentKey(observation),
      observedAtUtc: observation.observedAtUtc,
      trigger: observation.audited.trigger,
      eventId: observation.eventId,
    }),
  );
}

// --- 판정(Verdict): PASS / FAIL / UNKNOWN을 섞지 않는다 ------------------------------------
export const VERDICTS = ["PASS", "FAIL", "UNKNOWN"] as const;
export const EVIDENCE_KINDS = ["unit", "integration", "native-workerd", "ci", "live-scheduled"] as const;
export const ReasonCodeSchema = z.string().regex(/^[A-Z][A-Z0-9_]{2,63}$/, "UPPER_SNAKE reason code");

export const VerdictRecordSchema = z
  .object({
    verdict: z.enum(VERDICTS),
    evidenceKind: z.enum(EVIDENCE_KINDS),
    evidenceDigests: z.array(DigestSchema).min(1),
    reasonCodes: z.array(ReasonCodeSchema),
  })
  .strict()
  .superRefine((record, ctx) => {
    if (record.verdict !== "PASS" && record.reasonCodes.length === 0) {
      ctx.addIssue({ code: "custom", message: `${record.verdict} needs a reason code`, path: ["reasonCodes"] });
    }
  });
export type VerdictRecord = z.infer<typeof VerdictRecordSchema>;

export function parseVerdict(value: unknown): VerdictRecord {
  return parseStrict(VerdictRecordSchema, value);
}
// UNKNOWN은 GREEN도 RED도 아니다.
export const isPassingVerdict = (record: VerdictRecord) => record.verdict === "PASS";
export const isFailingVerdict = (record: VerdictRecord) => record.verdict === "FAIL";

// --- 사건 상태 전이 ---------------------------------------------------------------
export const ACTIVE_STATUSES = [
  "OBSERVED",
  "TRIAGED",
  "REPRODUCED",
  "PATCHED",
  "VERIFIED",
  "PR_READY",
  "MERGED",
  "LIVE_VERIFIED",
] as const;
export const TERMINAL_STATUSES = ["REJECTED", "BLOCKED", "INCONCLUSIVE", "NO_CHANGE"] as const;
export const IncidentStatusSchema = z.enum([...ACTIVE_STATUSES, ...TERMINAL_STATUSES]);
export type IncidentStatus = z.infer<typeof IncidentStatusSchema>;

const FINAL_STATUSES: ReadonlySet<IncidentStatus> = new Set([...TERMINAL_STATUSES, "LIVE_VERIFIED"]);

export function allowedTransitions(from: IncidentStatus): readonly IncidentStatus[] {
  if (FINAL_STATUSES.has(from)) return [];
  const index = ACTIVE_STATUSES.indexOf(from as (typeof ACTIVE_STATUSES)[number]);
  const next: IncidentStatus[] = [ACTIVE_STATUSES[index + 1]!, "REJECTED", "BLOCKED", "INCONCLUSIVE"];
  // 정상·외부 장애 등 코드/배포가 필요 없는 사건만 NO_CHANGE로 닫는다.
  if (from === "OBSERVED" || from === "TRIAGED") next.push("NO_CHANGE");
  return next;
}

export const TransitionEvidenceSchema = z
  .object({
    verdict: VerdictRecordSchema.optional(),
    diffDigest: DigestSchema.optional(),
    mergeSha: GitShaSchema.optional(),
  })
  .strict();
export type TransitionEvidence = z.infer<typeof TransitionEvidenceSchema>;

// 단계별로 넘어갈 때 필요한 증거. 자연어 자신감·"PASS" 문자열·CI 예약만으로는 올리지 않는다.
function assertTransitionEvidence(to: IncidentStatus, evidence: TransitionEvidence) {
  const need = (ok: boolean, message: string) => {
    if (!ok) throw new RsiContractError("INVALID_TRANSITION", `${to} requires ${message}`);
  };
  switch (to) {
    case "REPRODUCED":
      need(!!evidence.verdict && isFailingVerdict(evidence.verdict), "a FAIL verdict on the base version (RED)");
      return;
    case "PATCHED":
    case "PR_READY":
      need(!!evidence.diffDigest, "a diff digest inside the allowed paths");
      return;
    case "VERIFIED":
      need(!!evidence.verdict && isPassingVerdict(evidence.verdict), "a PASS verdict (GREEN)");
      return;
    case "MERGED":
      need(!!evidence.mergeSha, "the merge sha");
      return;
    case "LIVE_VERIFIED":
      need(
        !!evidence.verdict && isPassingVerdict(evidence.verdict) && evidence.verdict.evidenceKind === "live-scheduled",
        "a PASS verdict from the live scheduled audit",
      );
      return;
    default:
      return;
  }
}

export const IncidentSchema = z
  .object({
    schemaVersion: z.literal(RSI_CONTRACT_SCHEMA_VERSION),
    incidentKey: DigestSchema,
    incidentEpoch: z.int().min(1),
    parentIncidentKey: DigestSchema.nullable(),
    status: IncidentStatusSchema,
    observationFingerprints: z.array(DigestSchema).min(1),
    openRunId: RunIdSchema.nullable(),
  })
  .strict();
export type Incident = z.infer<typeof IncidentSchema>;

export function openIncident(observation: Observation): Incident {
  return {
    schemaVersion: RSI_CONTRACT_SCHEMA_VERSION,
    incidentKey: incidentKey(observation),
    incidentEpoch: 1,
    parentIncidentKey: null,
    status: "OBSERVED",
    observationFingerprints: [observationFingerprint(observation)],
    openRunId: null,
  };
}

// 같은 incidentKey의 연속 실패는 관측만 추가한다. 상태·시도·실행은 바뀌지 않는다.
export function appendObservation(incident: Incident, observation: Observation): Incident {
  const key = incidentKey(observation);
  if (key !== incident.incidentKey) {
    throw new RsiContractError("INVALID_TRANSITION", "observation belongs to a different incident", ["incidentKey"]);
  }
  if (FINAL_STATUSES.has(incident.status)) {
    throw new RsiContractError("INVALID_TRANSITION", `incident is ${incident.status}; open a new epoch`, ["status"]);
  }
  const fingerprint = observationFingerprint(observation);
  if (incident.observationFingerprints.includes(fingerprint)) return incident;
  return { ...incident, observationFingerprints: [...incident.observationFingerprints, fingerprint] };
}

// 회복/종료 뒤 재발은 새 epoch이며 부모 사건에 연결한다.
export function reopenIncident(previous: Incident, observation: Observation): Incident {
  if (!FINAL_STATUSES.has(previous.status)) {
    throw new RsiContractError("INVALID_TRANSITION", "previous incident is still open", ["status"]);
  }
  const key = incidentKey(observation);
  if (key !== previous.incidentKey) {
    throw new RsiContractError("INVALID_TRANSITION", "observation belongs to a different incident", ["incidentKey"]);
  }
  return { ...openIncident(observation), incidentEpoch: previous.incidentEpoch + 1, parentIncidentKey: previous.incidentKey };
}

export function transitionIncident(incident: Incident, to: IncidentStatus, evidence: TransitionEvidence = {}): Incident {
  const parsedEvidence = parseStrict(TransitionEvidenceSchema, evidence);
  if (!allowedTransitions(incident.status).includes(to)) {
    throw new RsiContractError("INVALID_TRANSITION", `${incident.status} -> ${to} is not allowed`, ["status"]);
  }
  assertTransitionEvidence(to, parsedEvidence);
  return { ...incident, status: to };
}

// --- 계보(Lineage): 실행·세대·감독기·평가기 해시 ---------------------------------------
export const LineageSchema = z
  .object({
    schemaVersion: z.literal(RSI_CONTRACT_SCHEMA_VERSION),
    runId: RunIdSchema,
    attempt: z.int().min(1),
    parentRunId: RunIdSchema.nullable(),
    eventFingerprint: DigestSchema,
    baseAppSha: GitShaSchema,
    parentAgentHash: DigestSchema,
    candidateAgentHash: DigestSchema,
    controllerHash: DigestSchema,
    evaluatorHash: DigestSchema,
  })
  .strict();
export type Lineage = z.infer<typeof LineageSchema>;

export function parseLineage(value: unknown): Lineage {
  return parseStrict(LineageSchema, value);
}
