import { createHash, randomUUID } from "node:crypto";
import { B17_MIGRATIONS } from "./b17-rollout-evidence.mjs";
import { RolloutBudget, checkB17Authority, checkB17Runtime, validateB17Input } from "./b17-rollout-runner.mjs";
import { buildB17PreservationCatalogQuery, planB17PreservationCapture, collectB17PreservationSnapshot, compareB17PreservationSnapshots } from "./b17-preservation-evidence.mjs";
import { buildB10LegacyPublicResumeSql } from "./b10-legacy-public-resume.mjs";

const hash = value => createHash("sha256").update(value).digest("hex");
const hex = value => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
const uuid = value => typeof value === "string" && /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(value);
const utc = value => {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?Z$/.test(value) || !Number.isFinite(Date.parse(value))) return null;
  const normalized = new Date(value).toISOString();
  return normalized.slice(0, 19) === value.slice(0, 19) ? normalized : null;
};
const iso = value => utc(value) !== null;
const quote = value => { if (typeof value !== "string" || value.length > 1024 || /[\0\r\n]/.test(value)) throw Error("B17_VALUE_INVALID"); return `'${value.replaceAll("'", "''")}'`; };
const canonical = value => JSON.stringify(value, (_, row) => row && typeof row === "object" && !Array.isArray(row) ? Object.fromEntries(Object.keys(row).sort().map(key => [key, row[key]])) : row);
const same = (a, b) => canonical(a) === canonical(b);
const fail = code => { throw Error(code); };
const MAX_RESPONSE = 16 * 1024 * 1024;
export const continuationManifestHash = migrations => hash(JSON.stringify(migrations.map(({ name, sha256 }) => ({ name, sha256 }))));
export const b17ReviewedSnapshotHash = snapshot => hash(canonical(snapshot));

function checkRuntime(runtime, config, versionId, maintenance) {
  const createdOn = utc(runtime?.version?.metadata?.created_on);
  if (!createdOn) fail("B17_RUNTIME_NOT_VERIFIED");
  // The shared validator also accepts this normalized representation; retain
  // the original deployment timestamp for the independent fence-time check.
  return checkB17Runtime({ ...runtime, version: { ...runtime.version, metadata: { ...runtime.version.metadata, created_on: createdOn } } }, config, versionId, maintenance);
}

function validateCheckpoint(input, checkpoint, prepared) {
  validateB17Input(input);
  if (!checkpoint || checkpoint.sourceSha !== input.sourceSha || checkpoint.previousVersion !== input.previousVersion
    || !uuid(checkpoint.fenceVersion) || checkpoint.fenceVersion === checkpoint.previousVersion || !iso(checkpoint.fencedAt)
    || !hex(checkpoint.artifactDigest) || prepared.sourceSha !== input.sourceSha || !Array.isArray(prepared.migrations)
    || !same(prepared.migrations.map(row => row.name), B17_MIGRATIONS) || prepared.migrations.some(row => !hex(row.sha256))
    || checkpoint.manifestSha256 !== continuationManifestHash(prepared.migrations)
    || input.legacyRunId !== null && !hex(checkpoint.legacySnapshotSha256)
    || !Array.isArray(prepared.baselineMigrationNames) || !prepared.baselineMigrationNames.length) fail("B17_CHECKPOINT_INVALID");
}
function requireDrain(proof, checkpoint, now) {
  if (!proof || proof.status !== "VERIFIED" || proof.canMigrate !== true || !hex(proof.evidenceSha256)
    || proof.previousVersion !== checkpoint.previousVersion || proof.fenceVersion !== checkpoint.fenceVersion
    || !iso(proof.fenceDeployedAt) || Date.parse(proof.fenceDeployedAt) !== Date.parse(checkpoint.fencedAt) || !iso(proof.checkedAt) || Date.parse(proof.checkedAt) > Date.parse(now)
    || Date.parse(now) - Date.parse(proof.checkedAt) > 60_000) fail("B17_DRAIN_NOT_VERIFIED");
  return proof.evidenceSha256;
}
function normalizeResults(value, count, maxBytes) {
  if (!Array.isArray(value) || value.length !== count || value.some(row => row.success !== true || !Array.isArray(row.results))
    || Buffer.byteLength(JSON.stringify(value)) > maxBytes) fail("B17_QUERY_RESULT_INVALID");
  return value.map(row => row.results);
}

/** Fixed post-fence operations. Adapter evidence comes from trusted native wiring,
 * never from booleans or executable code supplied by an operator manifest. */
export async function continueB17Rollout({ input, checkpoint, prepared, budget }, adapter) {
  validateCheckpoint(input, checkpoint, prepared);
  if (input.quotaCutover !== "HOLD") return { status: "HOLD", stage: "INPUT", code: "B17_QUOTA_SEPARATE_REVIEW_REQUIRED", budget: budget.snapshot() };
  if (!(budget instanceof RolloutBudget) || !adapter.lock?.acquire || !adapter.lock?.release) fail("B17_ADAPTER_INVALID");
  let locked = false, stage = "AUTHORITY", result, sessionId = null, normalAttempted = false, fenceObserved = false;
  let triggerNames = [], safeProofs = {}, mutationOutcome = "NOT_STARTED";
  const time = () => { const value = utc(adapter.now?.() ?? new Date().toISOString()); if (!value) fail("B17_CLOCK_INVALID"); return value; };
  const startedAt = time(), deadline = Date.parse(startedAt) + 30 * 60_000;
  const checkDeadline = () => { if (Date.parse(time()) >= deadline) fail("B17_DEADLINE_EXCEEDED"); };
  const query = async (sql, statements = 1, { cleanup = false, maxBytes = MAX_RESPONSE } = {}) => {
    if (!cleanup) checkDeadline();
    budget.consume({ d1Commands: 1, manualSql: statements }, { cleanup });
    return normalizeResults(await adapter.query(sql, { expectedStatements: statements, maxBytes, cleanup }), statements, maxBytes);
  };
  const fence = async () => {
    stage = "AUTHORITY";
    checkB17Authority(await adapter.authority(), input.sourceSha);
    stage = "ARTIFACT";
    const artifact = await adapter.buildDigest();
    if (artifact.artifactDigest !== checkpoint.artifactDigest || !same(artifact.config, prepared.config)) fail("B17_ARTIFACT_CHANGED");
    stage = "FENCE";
    const runtime = await adapter.runtime();
    checkRuntime(runtime, prepared.config, checkpoint.fenceVersion, true);
    if (!iso(runtime.deployment?.created_on) || Date.parse(runtime.deployment.created_on) !== Date.parse(checkpoint.fencedAt)) fail("B17_FENCE_CHANGED");
    fenceObserved = true;
    stage = "DRAIN";
    return requireDrain(await adapter.verifyDrain({ sourceSha: input.sourceSha, previousVersion: checkpoint.previousVersion, fenceVersion: checkpoint.fenceVersion, fencedAt: checkpoint.fencedAt }), checkpoint, time());
  };
  const capture = async phase => {
    const catalogQuery = buildB17PreservationCatalogQuery();
    const [catalog] = await query(catalogQuery.sql, 1, { maxBytes: catalogQuery.maxResponseBytes });
    const plan = planB17PreservationCapture({ phase, catalog });
    const outputs = {};
    for (const request of plan.queries) [outputs[request.id]] = await query(request.sql, request.sqlStatementCount, { maxBytes: request.maxResponseBytes });
    const snapshot = collectB17PreservationSnapshot(plan, outputs);
    const saved = await adapter.savePrivate(`preservation-${phase}.json`, JSON.stringify(snapshot));
    if (!hex(saved?.sha256) || saved.sha256 !== hash(JSON.stringify(snapshot))) fail("B17_PRIVATE_PROOF_INVALID");
    safeProofs[phase] = { sha256: saved.sha256, schemaHash: snapshot.schemaHash };
    return snapshot;
  };
  const ledger = async expected => {
    const [rows] = await query("SELECT name FROM d1_migrations ORDER BY name;");
    if (!same(rows.map(row => row.name).sort(), [...expected].sort())) fail("B17_MIGRATION_LEDGER_MISMATCH");
  };
  try {
    await adapter.lock.acquire(); locked = true;
    checkDeadline();
    safeProofs.drainSha256 = await fence();
    stage = "RESERVATION";
    const planned = new RolloutBudget(budget.snapshot());
    // Full option path, including actual 16 capture queries and a reserved finally.
    planned.consume({ d1Commands: 43, manualSql: 85, migrationSql: 201, migrations: 9, exports: 1, sessions: 1, rsi: 1, http: 40 });
    stage = "BACKUP";
    budget.consume({ d1Commands: 4, exports: 1 });
    const backup = await adapter.backup();
    if (!backup || typeof backup.bookmark !== "string" || !backup.bookmark || !hex(backup.sha256) || !Number.isSafeInteger(backup.bytes) || backup.bytes < 1) fail("B17_BACKUP_INVALID");
    safeProofs.backup = { sha256: backup.sha256, bytes: backup.bytes };
    stage = "PRESERVATION_BEFORE"; const before = await capture("before");
    stage = "MIGRATION_GATE"; safeProofs.drainSha256 = await fence(); await ledger(prepared.baselineMigrationNames);
    stage = "MIGRATIONS";
    budget.consume({ d1Commands: 11, manualSql: 11, migrationSql: 201, migrations: 9 });
    mutationOutcome = "APPLY_ATTEMPTED";
    let applyError = false;
    try { await adapter.applyMigrations(); } catch { applyError = true; }
    await ledger([...prepared.baselineMigrationNames, ...B17_MIGRATIONS]);
    stage = "PRESERVATION_AFTER"; const after = await capture("after");
    const comparison = compareB17PreservationSnapshots(before, after);
    if (!comparison.ok) fail("B17_PRESERVATION_MISMATCH");
    safeProofs.preservation = { tableCount: comparison.tableCount, rowCount: comparison.rowCount, mismatchCount: 0 };
    mutationOutcome = applyError ? "APPLIED_RESPONSE_LOST_VERIFIED" : "APPLIED_VERIFIED";
    stage = "DEFAULTS"; await verifyNewDefaults(query);
    stage = "SESSION";
    budget.consume({ sessions: 1 });
    const candidateSessionId = randomUUID();
    const receipt = JSON.stringify({ sourceSha: input.sourceSha, operatorId: input.operatorId, sessionId: candidateSessionId, createdAt: time(), maxAgeSeconds: 1800 });
    const durableReceipt = await adapter.savePrivate("session-recovery.json", receipt);
    if (durableReceipt?.sha256 !== hash(receipt)) fail("B17_SESSION_RECEIPT_INVALID");
    safeProofs.sessionReceiptSha256 = durableReceipt.sha256;
    sessionId = candidateSessionId;
    await createSession(query, input.operatorId, sessionId, time());
    stage = "GUARDED_TRANSITIONS";
    const transitions = await guardedTransitions({ query, input, checkpoint, sessionId, now: time(), proofSha: safeProofs.drainSha256,
      register: names => { triggerNames.push(...names); } });
    safeProofs.transitions = transitions;
    if (triggerNames.length) await dropTriggers(query, triggerNames);
    stage = "NORMAL_DEPLOY"; checkDeadline();
    checkB17Authority(await adapter.authority(), input.sourceSha);
    normalAttempted = true;
    const deployed = await adapter.deployNormal();
    const runtime = deployed.runtime ?? deployed;
    const versionId = runtime.deployment?.versions?.find(row => row.percentage > 0)?.version_id;
    if (deployed.sourceSha !== input.sourceSha || deployed.artifactDigest !== checkpoint.artifactDigest || !uuid(versionId) || versionId === checkpoint.fenceVersion) fail("B17_NORMAL_SOURCE_INVALID");
    if (!iso(runtime.deployment?.created_on) || Date.parse(runtime.deployment.created_on) < Date.parse(checkpoint.fencedAt)) fail("B17_NORMAL_DEPLOYMENT_STALE");
    checkRuntime(runtime, prepared.config, versionId, false);
    stage = "PROBES"; safeProofs.probes = await runReadProbes({ query, adapter, sessionId, budget, checkDeadline });
    stage = "RSI"; safeProofs.rsi = await runRsiProof({ query, adapter, sessionId, operatorId: input.operatorId, versionId, budget, time, checkDeadline });
    result = { status: "VERIFIED", stage: "COMPLETE", mutationOutcome, sourceSha: input.sourceSha, versionId, proofs: safeProofs };
  } catch (error) {
    result = { status: "HOLD", stage, mutationOutcome, code: /^B17_[A-Z_]+$/.test(error?.message ?? "") ? error.message : "B17_CONTINUATION_FAILED", proofs: safeProofs };
  } finally {
    if (sessionId) {
      try { await cleanupOwned(query, sessionId, input.operatorId, triggerNames); result.cleanup = "VERIFIED"; }
      catch { result = { ...result, status: "HOLD", code: "B17_CLEANUP_UNKNOWN", cleanup: "UNKNOWN" }; }
    } else result.cleanup = "NOT_NEEDED";
    if (normalAttempted && result.status !== "VERIFIED") {
      try { const restored = await adapter.ensureFence(); const rt = restored.runtime ?? restored;
        const id = rt.deployment?.versions?.find(row => row.percentage > 0)?.version_id;
        checkRuntime(rt, prepared.config, id, true); result.fence = "VERIFIED";
      } catch { result.fence = "UNKNOWN"; }
    } else result.fence = normalAttempted ? "NORMAL_VERIFIED" : fenceObserved ? "KEPT" : "NOT_OBSERVED";
    if (locked) { try { await adapter.lock.release(); } catch {
      result = { ...result, status: "HOLD", code: "B17_LOCK_RELEASE_UNKNOWN" };
      if (result.fence === "NORMAL_VERIFIED") {
        try { const restored = await adapter.ensureFence(); const rt = restored.runtime ?? restored;
          const id = rt.deployment?.versions?.find(row => row.percentage > 0)?.version_id;
          checkRuntime(rt, prepared.config, id, true); result.fence = "VERIFIED";
        } catch { result.fence = "UNKNOWN"; }
      }
    } }
  }
  return { ...result, sourceKind: adapter.kind === "SYNTHETIC_LOCAL" ? "LOCAL_SYNTHETIC" : "LIVE", budget: budget.snapshot() };
}

async function verifyNewDefaults(query) {
  const rows = await query(`PRAGMA foreign_key_check;
SELECT key,stopped,version FROM admin_feature_stops;
SELECT (SELECT count(*) FROM privacy_requests) AS privacy_count,(SELECT count(*) FROM email_domain_state) AS domain_count,(SELECT count(*) FROM email_domain_actions) AS domain_actions,(SELECT count(*) FROM provider_call_attempts) AS attempts;
SELECT count(*) AS bad FROM reviewer_photo_cleanup_jobs WHERE revision<>1 OR status<>'PENDING' OR lease_id IS NOT NULL OR lease_expires_at IS NOT NULL OR last_error IS NOT NULL;
SELECT count(*) AS bad FROM rating_recompute_jobs WHERE lease_expires_at IS NOT NULL;
SELECT count(*) AS bad FROM public_data_sync_runs WHERE attempts<>0 OR lease_id IS NOT NULL OR lease_expires_at IS NOT NULL OR cancel_requested_at IS NOT NULL OR request_count<>0 OR retry_count<>0;
SELECT count(*) AS bad FROM parking_sync_runs WHERE attempts<>1 OR lease_version<>0 OR lease_expires_at IS NOT NULL;
SELECT count(*) AS anchors FROM provider_daily_quotas WHERE is_cutover_anchor=1;
SELECT count(*) AS bad FROM provider_daily_quotas WHERE cutover_state<>'CLOSED_LEGACY_UNCERTAIN' OR reserved_total<>0 OR reserved_gwangju<>0 OR reserved_jeonnam<>0 OR cutover_verified_at IS NOT NULL OR ready_after_utc_day IS NOT NULL OR cutover_receipt_ref IS NOT NULL;`, 9);
  if (rows[0].length || !same(rows[1], [{ key: "REVIEW_AUTO_PIPELINE_ENABLED", stopped: 0, version: 0 }])
    || rows[2].length !== 1 || Object.values(rows[2][0]).some(value => value !== 0)
    || [3,4,5,6,8].some(index => rows[index].length !== 1 || rows[index][0].bad !== 0)
    || rows[7].length !== 1 || rows[7][0].anchors !== 1) fail("B17_NEW_DEFAULTS_INVALID");
}
async function createSession(query, operatorId, sessionId, now) {
  const expiresAt = new Date(Date.parse(now) + 30 * 60_000).toISOString();
  const [_, rows] = await query(`INSERT INTO sessions(id,user_id,expires_at,created_at)
SELECT ${quote(sessionId)},id,${quote(expiresAt)},${quote(now)} FROM users
WHERE id=${quote(operatorId)} AND role='ADMIN' AND email_verified_at IS NOT NULL AND email NOT LIKE 'withdrawn.%@invalid.local'
AND NOT EXISTS(SELECT 1 FROM member_access_restrictions r WHERE r.user_id=users.id AND r.lifted_at IS NULL AND r.starts_at<=${quote(now)} AND r.expires_at>${quote(now)});
SELECT id,user_id,expires_at,created_at FROM sessions WHERE id=${quote(sessionId)};`, 2);
  if (!same(rows, [{ id: sessionId, user_id: operatorId, expires_at: expiresAt, created_at: now }])) fail("B17_SESSION_NOT_CREATED");
}
async function dropTriggers(query, names, cleanup = false) {
  if (!names.length) return;
  if (names.some(name => !/^(b10_resume_(identity|apply)|b17_provider_(guard|apply))_[a-f0-9]{24}$/.test(name))) fail("B17_TRIGGER_ID_INVALID");
  await query(names.map(name => `DROP TRIGGER IF EXISTS ${name};`).join("\n"), names.length, { cleanup });
}
async function guardedTransitions({ query, input, checkpoint, sessionId, now, proofSha, register }) {
  const reports = [], plans = [], sql = [];
  if (input.legacyRunId) sql.push(`SELECT rowid,* FROM public_data_sync_runs WHERE id=${quote(input.legacyRunId)};`);
  if (!sql.length) return { legacy: "NOT_REQUESTED", quota: "HOLD" };
  const rows = await query(sql.join("\n"), sql.length);
  let index = 0;
  if (input.legacyRunId) {
    if (rows[index].length !== 1) fail("B17_LEGACY_SNAPSHOT_INVALID");
    const before = rows[index++][0];
    if (hash(canonical(before)) !== checkpoint.legacySnapshotSha256) fail("B17_LEGACY_REVIEW_DIGEST_MISMATCH");
    const plan = buildB10LegacyPublicResumeSql({ snapshot: before, operatorId: input.operatorId, sessionId, now, drainEvidenceSha256: proofSha, previousWorkerVersion: checkpoint.previousVersion, fenceVersion: checkpoint.fenceVersion });
    plans.push({ kind: "legacy", before, plan });
  }
  const names = plans.flatMap(row => row.plan.triggerNames);
  const [existing] = await query(`SELECT name FROM sqlite_master WHERE type='trigger' AND name IN (${names.map(quote).join(",")});`);
  if (existing.length) fail("B17_TRANSITION_TRIGGER_COLLISION");
  register(names);
  for (const { plan } of plans) {
    await query(`${plan.installSql}\n${plan.applySql}`, 3);
  }
  const checks = plans.flatMap(({ kind, plan }) => [kind === "legacy"
    ? `SELECT rowid,* FROM public_data_sync_runs WHERE id=${quote(input.legacyRunId)};`
    : "SELECT rowid,* FROM provider_daily_quotas WHERE provider='NAVER_LOCAL_SEARCH' AND is_cutover_anchor=1;",
    `SELECT action,actor_user_id,before_state,after_state,created_at FROM admin_audit_logs WHERE id=${quote(plan.marker)};`]);
  const observed = await query(checks.join("\n"), checks.length);
  for (let i = 0; i < plans.length; i++) {
    const { kind, before, plan } = plans[i], after = observed[i * 2], audit = observed[i * 2 + 1];
    const expected = kind === "legacy" ? { ...before, status: "PENDING", updated_at: now } : { ...before, cutover_verified_at: now, ready_after_utc_day: plan.readyAfterUtcDay, cutover_receipt_ref: `sha256:${proofSha}` };
    if (after.length !== 1 || !same(after[0], expected) || audit.length !== 1 || audit[0].actor_user_id !== input.operatorId || audit[0].created_at !== now
      || audit[0].action !== (kind === "legacy" ? "B10_LEGACY_PUBLIC_RESUME" : "B17_PROVIDER_CUTOVER")) fail("B17_TRANSITION_NOT_VERIFIED");
    const a = JSON.parse(audit[0].after_state), b = JSON.parse(audit[0].before_state);
    if (!same(b[kind === "legacy" ? "run" : "anchor"], before) || !same(a[kind === "legacy" ? "run" : "anchor"], expected)
      || a.drainEvidenceSha256 !== proofSha || a.previousWorkerVersion !== checkpoint.previousVersion) fail("B17_TRANSITION_AUDIT_INVALID");
    reports.push({ kind, sha256: plan.sha256 });
  }
  return { verified: reports, quota: input.quotaCutover === "APPLY" ? "RECORDED_HOLD_UNTIL_READY_DAY" : "HOLD" };
}

const PUBLIC_PATHS = ["/", "/places", "/courses", "/login", "/robots.txt", "/privacy", "/sitemap.xml"];
const ADMIN_PATHS = ["/admin/providers", "/admin/settings", "/admin/privacy", "/admin/reliability", "/admin/rating-config", "/admin/records", "/admin/operations/email-domain", "/admin/lifecycle", "/admin/data-sync", "/admin/jobs/parking", "/admin/ratings"];
const EXPECTED_RSI = ["/", "/places", "/login", "/admin", "/robots.txt", "/privacy"];
const noStore = response => /(?:^|[,\s])no-store(?:$|[,\s])/i.test(response.headers?.["cache-control"] ?? "");
function publicDetailPath(body) {
  if (typeof body !== "string") return null;
  for (const match of body.matchAll(/<a\b[^>]*\shref\s*=\s*(["'])([^"']+)\1/gi)) {
    if (!match[2].startsWith("/places/")) continue;
    try {
      const url = new URL(match[2].replaceAll("&amp;", "&"), "https://b17.invalid");
      if (url.origin !== "https://b17.invalid" || !/^\/places\/[^/]+$/.test(url.pathname)) continue;
      const slug = decodeURIComponent(url.pathname.slice("/places/".length));
      if (!slug || slug.length > 200 || /[\/\\?#\x00-\x20]/.test(slug)) continue;
      return `/places/${encodeURIComponent(slug)}`;
    } catch { /* Ignore malformed links without broadening the probe path. */ }
  }
  return null;
}
async function runReadProbes({ query, adapter, sessionId, budget, checkDeadline }) {
  const outcomes = [];
  const probe = async request => { checkDeadline(); budget.consume({ http: 1 }); return adapter.probe(request); };
  const paths = [...PUBLIC_PATHS];
  let detailPath = null;
  for (const path of PUBLIC_PATHS) {
    const response = await probe({ path, method: "GET" });
    if (response.status !== 200) fail("B17_PUBLIC_PROBE_FAILED");
    if (path === "/places") detailPath = publicDetailPath(response.body);
    outcomes.push({ path, status: response.status });
  }
  // Reuse the application's rendered public selection instead of duplicating
  // category, source and venue-visibility predicates in the rollout script.
  if (detailPath) {
    const response = await probe({ path: detailPath, method: "GET" });
    if (response.status !== 200) fail("B17_PUBLIC_PROBE_FAILED");
    paths.push(detailPath);
  }
  for (const path of ADMIN_PATHS) {
    const denied = await probe({ path, method: "GET" });
    if (denied.status !== 302 || !(denied.headers?.location ?? "").startsWith("/login") || !noStore(denied)) fail("B17_ANONYMOUS_DENIAL_FAILED");
    const read = await probe({ path, method: "GET", sessionId });
    if (read.status !== 200 || !noStore(read)) fail("B17_ADMIN_PROBE_FAILED");
    outcomes.push({ path, anonymous: 302, admin: 200 });
  }
  const invalid = await probe({ path: "/admin/rating-config?unknown=1", method: "GET", sessionId });
  if (invalid.status !== 400 || !noStore(invalid)) fail("B17_INVALID_INPUT_PROBE_FAILED");
  const preview = await probe({ path: "/admin/settings", method: "POST", sessionId, form: { intent: "preview-stop", reason: "B17 bounded readiness preview; do not apply" } });
  if (preview.status !== 200 || !noStore(preview)) fail("B17_PREVIEW_FAILED");
  const matches = [...(preview.body ?? "").matchAll(/<input\b[^>]*\bname=["']operationId["'][^>]*\bvalue=["']([^"']+)["'][^>]*>/g)].map(match => match[1]);
  if (matches.length !== 1 || !uuid(matches[0])) fail("B17_PREVIEW_ID_MISSING");
  const denied = await probe({ path: "/admin/settings", method: "POST", sessionId, form: { intent: "commit", operationId: matches[0] } });
  if (denied.status !== 302 || !(denied.headers?.location ?? "").startsWith("/admin/reauth?") || !noStore(denied)) fail("B17_RECENT_AUTH_DENIAL_FAILED");
  const [state, operation] = await query(`SELECT stopped,version FROM admin_feature_stops WHERE key='REVIEW_AUTO_PIPELINE_ENABLED';
SELECT id,status,session_id FROM admin_operations WHERE id=${quote(matches[0])};`, 2);
  if (!same(state, [{ stopped: 0, version: 0 }]) || !same(operation, [{ id: matches[0], status: "PENDING", session_id: sessionId }])) fail("B17_PREVIEW_MUTATED_STATE");
  return { publicReadCount: paths.length, publicDetail: detailPath ? "VERIFIED" : "NOT_AVAILABLE_IN_PUBLIC_LIST", adminReadCount: ADMIN_PATHS.length, anonymousDenialCount: ADMIN_PATHS.length, preview: "PENDING_ONLY", confirmation: "RECENT_AUTH_DENIED", member403: "NOT_RUN" };
}
async function runRsiProof({ query, adapter, sessionId, operatorId, versionId, budget, time, checkDeadline }) {
  checkDeadline(); const startedAt = time(); budget.consume({ http: 1, rsi: 1 });
  const response = await adapter.probe({ path: "/admin/operations/rsi-check", method: "POST", sessionId, form: { intent: "run" } });
  const endedAt = time();
  let body; try { body = JSON.parse(response.body); } catch { fail("B17_RSI_RESPONSE_INVALID"); }
  const validPaths = rows => Array.isArray(rows) && rows.length === 6 && same(rows.map(row => row.path), EXPECTED_RSI)
    && rows.every(row => row.ok === true && row.status === (row.path === "/admin" ? 302 : 200));
  if (response.status !== 200 || body.ok !== true || !validPaths(body.paths) || !noStore(response)) fail("B17_RSI_FAILED");
  const [audit] = await query(`SELECT id,after_state,created_at FROM admin_audit_logs WHERE actor_user_id=${quote(operatorId)} AND action='RSI_SELF_CHECK' AND target_type='OPERATIONS' AND target_id='rsi-admin' AND created_at>=${quote(startedAt)} AND created_at<=${quote(endedAt)};`);
  if (audit.length !== 1) fail("B17_RSI_AUDIT_AMBIGUOUS");
  let payload; try { payload = JSON.parse(audit[0].after_state); } catch { fail("B17_RSI_AUDIT_INVALID"); }
  if (payload.trigger !== "admin" || payload.ok !== true || !validPaths(payload.paths) || !same(payload.paths, body.paths)) fail("B17_RSI_AUDIT_INVALID");
  const requestId = response.headers?.["cf-ray"]?.split("-")[0];
  if (!requestId) fail("B17_RSI_TRACE_UNKNOWN");
  const log = await adapter.readRsiLog({ startedAt, endedAt, versionId, actorId: operatorId, requestId, rayId: requestId });
  if (log?.versionId !== versionId || log?.requestId !== requestId || log?.outcome !== "ok" || log?.trigger !== "admin"
    || !iso(log?.observedAt) || Date.parse(log.observedAt) < Date.parse(startedAt) || Date.parse(log.observedAt) > Date.parse(endedAt)) fail("B17_RSI_TRACE_UNKNOWN");
  return { startedAt, endedAt, versionId, auditSha256: hash(canonical(audit[0])), traceSha256: hash(canonical(log)), pathCount: body.paths.length };
}
async function cleanupOwned(query, sessionId, operatorId, triggerNames) {
  const [pending] = await query(`SELECT id FROM admin_operations WHERE session_id=${quote(sessionId)} AND actor_user_id=${quote(operatorId)} AND status='PENDING';`, 1, { cleanup: true });
  if (pending.some(row => !uuid(row.id))) fail("B17_CLEANUP_SCOPE_INVALID");
  const statements = triggerNames.map(name => { if (!/^(b10_resume_(identity|apply)|b17_provider_(guard|apply))_[a-f0-9]{24}$/.test(name)) fail("B17_TRIGGER_ID_INVALID"); return `DROP TRIGGER IF EXISTS ${name};`; });
  if (pending.length) statements.push(`DELETE FROM admin_operations WHERE id IN (${pending.map(row => quote(row.id)).join(",")}) AND session_id=${quote(sessionId)} AND actor_user_id=${quote(operatorId)} AND status='PENDING';`);
  statements.push(`DELETE FROM sessions WHERE id=${quote(sessionId)} AND user_id=${quote(operatorId)};`);
  await query(statements.join("\n"), statements.length, { cleanup: true });
  const [left] = await query(`SELECT (SELECT count(*) FROM sessions WHERE id=${quote(sessionId)}) AS sessions,(SELECT count(*) FROM admin_operations WHERE session_id=${quote(sessionId)} AND status='PENDING') AS pending,(SELECT count(*) FROM sqlite_master WHERE type='trigger' AND name IN (${triggerNames.length ? triggerNames.map(quote).join(",") : "''"})) AS triggers;`, 1, { cleanup: true });
  if (!same(left, [{ sessions: 0, pending: 0, triggers: 0 }])) fail("B17_CLEANUP_NOT_VERIFIED");
}
