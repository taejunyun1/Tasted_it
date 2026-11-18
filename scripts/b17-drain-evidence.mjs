import { createHash } from "node:crypto";

const LIMITS = Object.freeze({ maxBytes: 32768, maxNodes: 2000, maxDepth: 8, maxString: 8192, maxAgeMs: 60000, cronWindowMs: 15 * 60_000 });
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const KINDS = Object.freeze({
  operator_assertion: "OPERATOR_ASSERTION_IS_NOT_PROOF",
  elapsed_window: "ELAPSED_TIME_IS_NOT_HTTP_DRAIN_PROOF",
  wrangler_tail: "NO_EXHAUSTIVE_INVOCATION_INVENTORY",
  workers_observability: "NO_EXHAUSTIVE_INVOCATION_INVENTORY",
  deployment: "DEPLOYMENT_IS_NOT_DRAIN_PROOF",
  platform_attestation: "NO_SUPPORTED_AUTHENTICATED_ATTESTATION",
});

// Reviewed source and documentation are an investigation record, not live proof.
const SOURCES = Object.freeze([
  "https://developers.cloudflare.com/workers/versions-and-deployments/deployment-management/#in-flight-requests",
  "https://developers.cloudflare.com/workers/platform/limits/#duration",
  "https://developers.cloudflare.com/workers/runtime-apis/context/#waituntil",
  "https://developers.cloudflare.com/workers/observability/logs/real-time-logs/#limits",
  "https://developers.cloudflare.com/workers/observability/logs/workers-logs/#head-based-sampling",
  "https://developers.cloudflare.com/api/resources/workers/subresources/observability/",
  "https://developers.cloudflare.com/r2/reference/consistency/",
]);
const LEGACY_PATHS = Object.freeze([
  ["workers/app.ts", "fetch and scheduled enter the deployment fence; scheduled uses waitUntil"],
  ["app/features/operations/deployment-fence.ts", "maintenance env is checked at entry; admitted old invocations are not revoked"],
  ["app/features/ratings/reviewer-visit-publish.server.ts", "request.formData precedes review mutations and has no wall-time deadline"],
  ["app/features/ratings/reviewer-photo.server.ts", "R2 put/delete are awaited without a global invocation registry"],
  ["app/features/ratings/reviewer-photo-deletion.server.ts", "R2 deletion precedes D1 metadata/job cleanup; no B17 ownership lease"],
  ["app/features/ratings/scheduled-rating.server.ts", "cron recomputation, trust updates and R2 photo cleanup"],
  ["app/features/onboarding/data-lifecycle.server.ts", "cron deletes expired D1 records"],
]);

export function describeB17DrainRequirements() {
  return {
    supportedExhaustiveSources: [], retrospectiveCoverageAvailable: false,
    auditedSourceSha: "e96360c2c0dc4b7d619262021ef8001ad373bac9",
    auditedWorkerVersion: "d285759b-d529-4ea0-a7e9-9cf88b3e7cf1",
    legacyPaths: LEGACY_PATHS.map(([path, effect]) => ({ path, effect })),
    documentation: [...SOURCES], limits: LIMITS,
    requirements: [
      "Authenticate a platform or application evidence source; a JSON signature field is not source authentication.",
      "Bind evidence to the exact previous version, fence version and confirmed fence time.",
      "Account for every pre-fence HTTP invocation, its waitUntil work and dispatched R2/D1 operations.",
      "Observe terminal completion or authoritative cancellation of that complete inventory before migration.",
    ],
    investigation: [
      "Deployment changes new-request routing; it does not attest earlier invocation or external-operation completion.",
      "HTTP duration is unbounded while connected. The post-response waitUntil limit does not begin at deployment.",
      "Cron has a 15-minute invocation limit; elapsed cron time is not exhaustive HTTP or external-operation evidence.",
      "Tail completion events, sampled logs and current R2 listings do not enumerate unknown pending invocations.",
    ],
    nextSteps: [
      "Keep B17 migration and provider cutover closed for the legacy evidence gap.",
      "Ask the platform for an authoritative cancellation/inventory mechanism; none is implemented or assumed here.",
      "Alternatively review a separately approved, schema-compatible staged rollout that tolerates legacy work and removes the need for retrospective drain proof.",
      "Prospective admission/lease tracking must cover HTTP, cron and R2 dispatch. Adding it now cannot backfill admitted legacy invocations.",
    ],
  };
}

const iso = (v) => typeof v === "string" && Number.isFinite(Date.parse(v)) && new Date(v).toISOString() === v;
const exact = (v, keys) => v !== null && typeof v === "object" && !Array.isArray(v)
  && [Object.prototype, null].includes(Object.getPrototypeOf(v))
  && Object.keys(v).sort().join(",") === [...keys].sort().join(",")
  && keys.every((key) => Object.hasOwn(Object.getOwnPropertyDescriptor(v, key) ?? {}, "value"));

function boundedJson(input, limits = LIMITS) {
  let nodes = 0;
  const seen = new Set();
  const visit = (v, depth) => {
    if (++nodes > limits.maxNodes || depth > limits.maxDepth) throw new Error("limit");
    if (v === null || typeof v === "boolean") return v;
    if (typeof v === "number" && Number.isFinite(v)) return v;
    if (typeof v === "string" && v.length <= limits.maxString) return v;
    if (typeof v !== "object" || v === null || seen.has(v)) throw new Error("shape");
    if (!Array.isArray(v) && ![Object.prototype, null].includes(Object.getPrototypeOf(v))) throw new Error("shape");
    seen.add(v);
    if (Array.isArray(v) && (v.length > limits.maxNodes || Object.keys(v).length !== v.length)) throw new Error("array");
    const result = Array.isArray(v) ? Array.from({ length: v.length }, (_, index) => {
      const descriptor = Object.getOwnPropertyDescriptor(v, index);
      if (!descriptor || !("value" in descriptor)) throw new Error("accessor");
      return visit(descriptor.value, depth + 1);
    }) : Object.fromEntries(Object.keys(v).sort().map((k) => {
      if (k.length > 128 || ["__proto__", "constructor", "prototype"].includes(k)) throw new Error("key");
      const descriptor = Object.getOwnPropertyDescriptor(v, k);
      if (!descriptor || !("value" in descriptor)) throw new Error("accessor");
      return [k, visit(descriptor.value, depth + 1)];
    }));
    seen.delete(v);
    return result;
  };
  const text = JSON.stringify(visit(input, 0));
  if (Buffer.byteLength(text, "utf8") > limits.maxBytes) throw new Error("limit");
  return text;
}

/**
 * Fail-closed legacy gate. There is deliberately no VERIFIED branch: no public
 * exhaustive, authenticated drain source was found for this deployed Worker.
 * A claimed Cloudflare issuer, HTTPS URL, signature or caller boolean cannot
 * bootstrap that missing trust root. Raw evidence is never returned or logged;
 * evidenceSha256 identifies the bounded canonical JSON, not original file bytes.
 */
export function verifyB17DrainEvidence({ evidence = null, expected } = {}) {
  const result = { status: "UNKNOWN", canMigrate: false, sourceAuthenticated: false,
    reason: "INVALID_EXPECTED_CONTEXT", evidenceSha256: null,
    previousVersion: null, fenceVersion: null, fenceDeployedAt: null, checkedAt: null,
    cronWindowEndsAt: null, cronWindowElapsed: false };
  if (!exact(expected, ["previousVersion", "fenceVersion", "fenceDeployedAt", "now"])
    || typeof expected.previousVersion !== "string" || typeof expected.fenceVersion !== "string"
    || !UUID.test(expected.previousVersion) || !UUID.test(expected.fenceVersion)
    || expected.previousVersion === expected.fenceVersion || !iso(expected.fenceDeployedAt) || !iso(expected.now)
    || Date.parse(expected.now) < Date.parse(expected.fenceDeployedAt)
    || Date.parse(expected.fenceDeployedAt) > 8640000000000000 - LIMITS.cronWindowMs) return result;
  Object.assign(result, {
    previousVersion: expected.previousVersion, fenceVersion: expected.fenceVersion,
    fenceDeployedAt: expected.fenceDeployedAt, checkedAt: expected.now,
    cronWindowEndsAt: new Date(Date.parse(expected.fenceDeployedAt) + LIMITS.cronWindowMs).toISOString(),
    cronWindowElapsed: Date.parse(expected.now) - Date.parse(expected.fenceDeployedAt) >= LIMITS.cronWindowMs,
    reason: "NO_DRAIN_EVIDENCE",
  });
  if (evidence === null) return result;
  let serialized;
  try { serialized = boundedJson(evidence); } catch { return { ...result, reason: "MALFORMED_OR_OVERSIZED_EVIDENCE" }; }
  result.evidenceSha256 = createHash("sha256").update(serialized).digest("hex");
  if (!exact(evidence, ["kind", "previousVersion", "fenceVersion", "fenceDeployedAt", "observedAt", "payload"])) return { ...result, reason: "INVALID_EVIDENCE_ENVELOPE" };
  if (typeof evidence.kind !== "string") return { ...result, reason: "INVALID_EVIDENCE_ENVELOPE" };
  if (evidence.previousVersion !== expected.previousVersion || evidence.fenceVersion !== expected.fenceVersion
    || evidence.fenceDeployedAt !== expected.fenceDeployedAt) return { ...result, reason: "VERSION_OR_FENCE_MISMATCH" };
  if (!iso(evidence.observedAt) || Date.parse(evidence.observedAt) < Date.parse(expected.fenceDeployedAt)
    || Date.parse(evidence.observedAt) > Date.parse(expected.now)
    || Date.parse(expected.now) - Date.parse(evidence.observedAt) > LIMITS.maxAgeMs) return { ...result, reason: "STALE_OR_INVALID_OBSERVATION" };
  return { ...result, reason: Object.hasOwn(KINDS, evidence.kind) ? KINDS[evidence.kind] : "UNSUPPORTED_EVIDENCE_SOURCE" };
}

const ACCOUNT = "7543330c65069ee2df1b7b353fb0201c";
const WORKER = "retaste-beta";

/** Fixed, read-only diagnostic requests. The caller owns authenticated HTTPS;
 * no fetch, credentials, permission changes or remote operations occur here. */
export function buildB17DrainObservationPlan({ expected } = {}) {
  if (verifyB17DrainEvidence({ expected }).reason === "INVALID_EXPECTED_CONTEXT") throw new Error("B17_DRAIN_CONTEXT_INVALID");
  const to = Date.parse(expected.now), from = Math.max(0, to - 30 * 60_000, Date.parse(expected.fenceDeployedAt) - 15 * 60_000);
  if (from >= to) throw new Error("B17_DRAIN_WINDOW_INVALID");
  const filters = [
    { key: "$metadata.service", operation: "eq", type: "string", value: WORKER },
    { key: "$workers.scriptVersion.id", operation: "eq", type: "string", value: expected.previousVersion },
    { key: "$metadata.type", operation: "eq", type: "string", value: "cf-worker-event" },
  ];
  const parameters = { datasets: ["cloudflare-workers"], filterCombination: "and", filters };
  return {
    classification: "OBSERVATION_ONLY", canMigrate: false, maxRequests: 2,
    maxResponseBytes: 1048576, timeoutMs: 10000, maxRows: 100,
    requiredKeys: filters.map(({ key, type }) => ({ key, type })),
    keys: { method: "POST", path: `/accounts/${ACCOUNT}/workers/observability/telemetry/keys`,
      body: { datasets: ["cloudflare-workers"], filters: [filters[0]], from, to, limit: 100 } },
    query: { method: "POST", path: `/accounts/${ACCOUNT}/workers/observability/telemetry/query`,
      body: { queryId: "b17-legacy-drain-observation", timeframe: { from, to }, parameters, view: "events", limit: 100, dry: true, chart: false, compare: false } },
    notes: ["Check required keys before the query; absent fields leave UNKNOWN.",
      "The API calls require the existing Workers Observability permission. A denial leaves UNKNOWN; do not change permissions.",
      "No pagination or retries are included. A partial, empty or sampled result is never exhaustive drain evidence.",
      "The 30-minute window can miss arbitrarily old connected HTTP invocations."],
  };
}

/** Parse only documented event metadata; never return URLs, headers, IDs or log
 * bodies. Shape validation does not authenticate a caller-supplied response. */
export function summarizeB17DrainObservation({ response, expected } = {}) {
  const result = { status: "UNAVAILABLE", canMigrate: false, exhaustive: false,
    transportAuthentication: "REQUIRED_FROM_NATIVE_CALLER", reason: "INVALID_OBSERVATION_RESPONSE",
    returnedEvents: 0, reportedMatches: 0, observedTerminalOutcomes: 0, explicitEndsAfterFence: 0,
    fetchEvents: 0, scheduledEvents: 0, otherEvents: 0, querySampled: null, ingestionSampling: "UNKNOWN", partial: true };
  let plan;
  try { plan = buildB17DrainObservationPlan({ expected }); } catch { return result; }
  // Response bounds are checked by the native transport before JSON parsing.
  // Retain a second bound here for already-parsed local evidence.
  let text;
  try { text = boundedJson(response, { maxBytes: plan.maxResponseBytes, maxNodes: 20000, maxDepth: 16, maxString: 262144 }); } catch { return result; }
  if (typeof text !== "string" || Buffer.byteLength(text, "utf8") > plan.maxResponseBytes) return result;
  response = JSON.parse(text);
  if (response === null || typeof response !== "object" || Array.isArray(response)) return result;
  const data = response?.result, run = data?.run, rows = data?.events?.events, total = data?.events?.count;
  if (response.success !== true || !Array.isArray(response.errors) || response.errors.length
    || run?.accountId !== ACCOUNT || run?.status !== "COMPLETED" || run?.dry !== true
    || run.timeframe?.from !== plan.query.body.timeframe.from || run.timeframe?.to !== plan.query.body.timeframe.to
    || !Array.isArray(rows) || rows.length > plan.maxRows || !Number.isSafeInteger(total) || total < rows.length) return result;
  const from = plan.query.body.timeframe.from, to = plan.query.body.timeframe.to;
  for (const row of rows) {
    const m = row?.$metadata, w = row?.$workers;
    if (row?.dataset !== "cloudflare-workers" || !Number.isSafeInteger(row.timestamp) || row.timestamp < from || row.timestamp > to
      || m?.service !== WORKER || m?.type !== "cf-worker-event" || w?.scriptName !== WORKER || w?.scriptVersion?.id !== expected.previousVersion) return result;
  }
  const terminal = new Set(["ok", "exception", "exceededCpu", "exceededMemory", "canceled"]);
  const summary = { ...result, status: "OBSERVED", reason: "OBSERVATIONS_ARE_NOT_EXHAUSTIVE_DRAIN", returnedEvents: rows.length,
    reportedMatches: total, partial: total > rows.length,
    querySampled: typeof data.statistics?.abr_level === "number" ? data.statistics.abr_level > 1 : null };
  for (const row of rows) {
    const w = row.$workers, end = row.$metadata.endTime;
    if (terminal.has(w.outcome)) summary.observedTerminalOutcomes++;
    if (Number.isSafeInteger(end) && end >= Date.parse(expected.fenceDeployedAt) && end <= to) summary.explicitEndsAfterFence++;
    if (w.eventType === "fetch") summary.fetchEvents++;
    else if (["scheduled", "cron"].includes(w.eventType)) summary.scheduledEvents++;
    else summary.otherEvents++;
  }
  return summary;
}
