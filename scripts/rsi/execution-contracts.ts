import { createHash } from "node:crypto";
import { types } from "node:util";
import { z } from "zod";
import { deriveIncidentKey, deriveObservationFingerprint, parseObservation } from "./contracts";

// Passive, LOCAL_SYNTHETIC trusted-writer contracts. Digests bind references;
// they neither authenticate a writer nor establish actual container execution.
export const R4_PHASE_QUOTAS = Object.freeze({
  1: Object.freeze({ BASELINE_REPAIR: 2, GENERATE_AGENT: 4, PROMOTION_REPAIR: 2 }),
  2: Object.freeze({ BASELINE_REPAIR: 0, GENERATE_AGENT: 6, PROMOTION_REPAIR: 2 }),
});
export const R4_POLICY = Object.freeze({ schemaVersion: 1, purpose: "R4_SELF_IMPROVE", mode: "LOCAL_FAKE",
  generations: 2, proposalsPerGeneration: 1, generationRequestCeiling: 6, maxCalls: 8, poolCostUnits: 73552,
  maxCallCostUnits: 9194, inputTokens: 16000, outputTokens: 2000, callTimeoutMs: 30000, executionTimeoutMs: 120000,
  phaseQuotas: R4_PHASE_QUOTAS });
const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
export const R4_POLICY_DIGEST = hash(R4_POLICY);
const digest = z.string().regex(/^[a-f0-9]{64}$/), id = z.uuid().transform(v => v.toLowerCase());
const integer = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const phase = z.enum(["BASELINE_REPAIR", "GENERATE_AGENT", "PROMOTION_REPAIR"]);
const moduleSchema = z.strictObject({ digest, byteLength: z.number().int().min(1).max(32000) });
const modulesSchema = z.strictObject({
  "scripts/rsi/agent/diagnostic-policy.ts": moduleSchema,
  "scripts/rsi/agent/repair-policy.ts": moduleSchema,
});
function agentHash(modules: z.infer<typeof modulesSchema>) {
  return hash({ schemaVersion: 1, modules: Object.fromEntries(Object.entries(modules).map(([path, value]) => [path, value.digest])) });
}
const sourceSchema = z.strictObject({ schemaVersion: z.literal(1), modules: modulesSchema, agentHash: digest,
  compiledDigest: digest, artifactDigest: digest, compiledByteLength: z.number().int().min(1).max(65536),
  artifactByteLength: z.number().int().min(1).max(262144) }).refine(v => v.agentHash === agentHash(v.modules));
const intentSchema = z.strictObject({
  schemaVersion: z.literal(1), purpose: z.literal("R4_SELF_IMPROVE"), executionId: id, requestId: id, campaignId: id,
  generation: z.union([z.literal(1), z.literal(2)]), parentExecutionId: id.nullable(),
  expectedCatalogRevision: integer, expectedCatalogHash: digest, activeAgentHash: digest, activeCompiledDigest: digest, activeSourceArtifactDigest: digest,
  observation: z.unknown().transform(parseObservation), incidentKey: digest, incidentEpoch: z.number().int().min(1).max(1000000),
  observationFingerprint: digest, baseAppSha: z.string().regex(/^[a-f0-9]{40}$/), controllerHash: digest, evaluatorHash: digest,
  memorySnapshotHash: digest, policyDigest: z.literal(R4_POLICY_DIGEST), fakeFixtureDigest: digest,
}).refine(v => v.executionId !== v.requestId && v.executionId !== v.parentExecutionId
  && (v.generation === 1 ? v.parentExecutionId === null : v.parentExecutionId !== null)
  && v.incidentKey === deriveIncidentKey(v.observation.incident)
  && v.observationFingerprint === deriveObservationFingerprint(v.observation) && v.baseAppSha === v.observation.incident.baseAppSha);
const reserveSchema = z.strictObject({ intent: intentSchema, maximumCostUnits: z.literal(R4_POLICY.poolCostUnits) });
const bindingSchema = z.strictObject({ evidenceDigest: digest, controllerHash: digest, evaluatorHash: digest,
  memorySnapshotHash: digest, policyDigest: z.literal(R4_POLICY_DIGEST), fakeFixtureDigest: digest });
const generationBindingSchema = z.strictObject({ executionId: id, activeAgentHash: digest, activeCompiledDigest: digest,
  sequence: z.number().int().min(1).max(8), callId: id, brokerRequestDigest: digest, brokerReceiptDigest: digest, brokerOutputDigest: digest,
  actualInputDigest: digest, actualOutputDigest: digest, generationEvidenceDigest: digest });
const sequence = z.number().int().min(1).max(8), callCost = z.number().int().min(0).max(9194);
const reasonCode = z.enum(["NO_AGENT_CHANGE", "POLICY_REJECTED", "EVIDENCE_UNKNOWN", "ACCOUNTING_UNCERTAIN", "OPERATOR_STOP",
  "DEADLINE_EXPIRED", "GENERATION_FAILED", "PROBE_FAILED", "FOLLOWUP_FAILED", "SOURCE_UNAVAILABLE", "CATALOG_STALE",
  "CANCELLED", "EXTERNAL_FAILURE", "BUDGET_UNAVAILABLE", "INVALID_PROPOSAL", "BASELINE_FAILED"]);
const eventSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("GENERATING") }),
  z.strictObject({ kind: z.literal("BASELINE_VALIDATED"), binding: bindingSchema }),
  z.strictObject({ kind: z.literal("PROPOSED"), source: sourceSchema, generationBinding: generationBindingSchema }),
  z.strictObject({ kind: z.literal("PROBING") }),
  z.strictObject({ kind: z.literal("VALIDATED"), binding: bindingSchema }),
  z.strictObject({ kind: z.enum(["REJECTED", "BLOCKED", "INCONCLUSIVE"]), reasonCode }),
  z.strictObject({ kind: z.literal("CALL_STARTED"), sequence, phase, callId: id, requestDigest: digest }),
  z.strictObject({ kind: z.literal("CALL_RETURNED"), sequence, callId: id, receiptDigest: digest, outputDigest: digest, costUnits: callCost }),
  z.strictObject({ kind: z.literal("CALL_REJECTED"), sequence, phase, callId: id, requestDigest: digest, receiptDigest: digest,
    outputDigest: digest.nullable(), costUnits: callCost, usage: z.enum(["REJECTED_INPUT", "CONFIRMED", "WORST_CASE"]) })
    .refine(v => v.usage === "REJECTED_INPUT" ? v.costUnits === 0 && v.outputDigest === null
      : v.usage === "WORST_CASE" ? v.costUnits === R4_POLICY.maxCallCostUnits && v.outputDigest === null : v.outputDigest !== null),
]);
const eventInputSchema = z.strictObject({ executionId: id, event: eventSchema });
const settlementSchema = z.strictObject({ executionId: id, receiptId: id, kind: z.enum(["CONFIRMED", "AMBIGUOUS"]),
  chargedUnits: integer.nullable(), receiptDigest: digest }).refine(v => v.kind === "AMBIGUOUS" ? v.chargedUnits === null : v.chargedUnits !== null);
const cas = { expectedCatalogRevision: integer, expectedCatalogHash: digest };
const catalogSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("SEED"), expectedCatalogRevision: z.literal(-1), expectedCatalogHash: z.null(), source: sourceSchema }),
  z.strictObject({ kind: z.literal("PROMOTE"), ...cas, executionId: id, source: sourceSchema, binding: bindingSchema, settlementDigest: digest }),
  z.strictObject({ kind: z.literal("ROLLBACK"), ...cas, targetCatalogRevision: integer, targetCatalogHash: digest, reasonCode }),
]);

export type R4SourceArtifactReference = z.infer<typeof sourceSchema>;
export type R4ExecutionIntent = z.infer<typeof intentSchema>;
export type R4Reservation = z.infer<typeof reserveSchema>;
export type R4ImprovementEvent = z.infer<typeof eventSchema>;
export type R4EventInput = z.infer<typeof eventInputSchema>;
export type R4Settlement = z.infer<typeof settlementSchema>;
export type R4CatalogCommit = z.infer<typeof catalogSchema>;
export type R4ValidationBinding = z.infer<typeof bindingSchema>;
export type R4ModelPhase = z.infer<typeof phase>;
export type R4ExecutionStatus = "RESERVED" | "GENERATING" | "PROPOSED" | "PROBING" | "VALIDATED" | "PROMOTED" | "REJECTED" | "BLOCKED" | "INCONCLUSIVE";

// Snapshot before Zod transforms or existing parsers can read a property. In
// particular, proxy introspection and accessors must never run at this boundary.
function passive(value: unknown): unknown {
  let nodes = 0;
  const ancestors = new Set<object>();
  function visit(item: unknown, depth: number): unknown {
    if (++nodes > 4096 || depth > 24) throw new Error();
    if (item === null || typeof item === "string" || typeof item === "boolean") return item;
    if (typeof item === "number" && Number.isFinite(item)) return item;
    if (typeof item !== "object" || types.isProxy(item) || ancestors.has(item)) throw new Error();
    const array = Array.isArray(item);
    if (Object.getPrototypeOf(item) !== (array ? Array.prototype : Object.prototype)) throw new Error();
    ancestors.add(item);
    const descriptors = Object.getOwnPropertyDescriptors(item), result: Record<string, unknown> = {};
    for (const key of Reflect.ownKeys(descriptors)) {
      if (array && key === "length") continue;
      if (typeof key !== "string" || ["__proto__", "constructor", "prototype"].includes(key)
        || (array && !/^(0|[1-9][0-9]*)$/.test(key))) throw new Error();
      const descriptor = descriptors[key];
      if (!descriptor.enumerable || !("value" in descriptor)) throw new Error();
      result[key] = visit(descriptor.value, depth + 1);
    }
    ancestors.delete(item);
    if (!array) return result;
    if (Object.keys(result).length !== descriptors.length.value) throw new Error();
    return Object.values(result);
  }
  const result = visit(value, 0);
  if (Buffer.byteLength(JSON.stringify(result)) > 65536) throw new Error();
  return result;
}
function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  try { return schema.parse(passive(value)); } catch { throw new Error("RSI_INVALID_EXECUTION_CONTRACT"); }
}
export const parseImprovementIntent = (value: unknown): R4ExecutionIntent => parse(intentSchema, value);
export const parseSourceArtifactReference = (value: unknown): R4SourceArtifactReference => parse(sourceSchema, value);
export const parseImprovementReservation = (value: unknown): R4Reservation => parse(reserveSchema, value);
export const parseImprovementEvent = (value: unknown): R4EventInput => parse(eventInputSchema, value);
export const parseImprovementSettlement = (value: unknown): R4Settlement => parse(settlementSchema, value);
export const parseLabCatalogCommit = (value: unknown): R4CatalogCommit => parse(catalogSchema, value);
export const deriveSourceAgentHash = (value: unknown): string => agentHash(parse(modulesSchema, value));
