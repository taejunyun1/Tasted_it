import { createHash } from "node:crypto";

// Callable adapter layer only. No credentials, fetch, CLI, delete or overwrite.
// Lock plans/receipts contain private configuration; callers must not print them.
export const B17_R2_LIMITS = Object.freeze({ keys: 1000, prefixes: 8, rules: 1000, objectBytes: 10 * 1024 * 1024, totalBytes: 64 * 1024 * 1024, listPages: 8, jsonBytes: 512 * 1024, durationMs: 30 * 60_000 });
const fail = code => { throw Error(`B17_R2_${code}`); };
const plain = value => value && typeof value === "object" && !Array.isArray(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value));
const canonical = value => JSON.stringify(value, (_, row) => plain(row) ? Object.fromEntries(Object.keys(row).sort().map(key => [key, row[key]])) : row);
const digest = value => createHash("sha256").update(value).digest("hex");
export const hashB17R2Evidence = value => digest(canonical(value));
const hex = value => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
const safeDigest = value => hex(value) ? value : undefined;
const text = (value, max = 1024) => typeof value === "string" && value.length > 0 && Buffer.byteLength(value) <= max && !/[\x00-\x1f\x7f]/.test(value);
const clone = value => JSON.parse(canonical(value));
const same = (a, b) => canonical(a) === canonical(b);
const freeze = value => { if (value && typeof value === "object") { Object.values(value).forEach(freeze); Object.freeze(value); } return value; };
function iso(value) {
  if (value instanceof Date) value = value.toISOString();
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?Z$/.test(value) || !Number.isFinite(Date.parse(value))) fail("TIME_INVALID");
  const normalized = new Date(value).toISOString();
  if (normalized.slice(0, 19) !== value.slice(0, 19)) fail("TIME_INVALID");
  return normalized;
}
function boundedJson(value) {
  const json = canonical(value);
  if (typeof json !== "string" || Buffer.byteLength(json) > B17_R2_LIMITS.jsonBytes) fail("JSON_LIMIT");
  return json;
}
function metadata(value = {}, http = false) {
  if (!plain(value)) fail("METADATA_INVALID");
  const allowed = ["contentType", "contentLanguage", "contentDisposition", "contentEncoding", "cacheControl", "cacheExpiry"];
  const output = {};
  for (const [key, field] of Object.entries(value)) {
    if (!text(key, 256) || ["__proto__", "constructor", "prototype"].includes(key) || http && !allowed.includes(key)) fail("METADATA_INVALID");
    if (http && key === "cacheExpiry") output[key] = iso(field);
    else { if (typeof field !== "string" || Buffer.byteLength(field) > 2048 || /[\x00\r\n]/.test(field)) fail("METADATA_INVALID"); output[key] = field; }
  }
  if (Buffer.byteLength(canonical(output)) > 8192) fail("METADATA_LIMIT");
  return output;
}
function identities(value) {
  if (!plain(value) || !/^[a-f0-9]{32}$/.test(value.accountId ?? "") || ![value.sourceBucket, value.candidateBucket].every(name => typeof name === "string" && /^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/.test(name)) || value.sourceBucket === value.candidateBucket) fail("IDENTITY_INVALID");
  return { accountId: value.accountId, sourceBucket: value.sourceBucket, candidateBucket: value.candidateBucket };
}
function normalizedManifest(manifest) {
  if (!plain(manifest) || manifest.format !== "b17-isolated-r2-v1") fail("MANIFEST_INVALID");
  identities(manifest); boundedJson(manifest);
  const start = iso(manifest.frozenAt), end = iso(manifest.deadline);
  if (Date.parse(end) <= Date.parse(start) || Date.parse(end) - Date.parse(start) > B17_R2_LIMITS.durationMs) fail("DEADLINE_INVALID");
  if (!Array.isArray(manifest.prefixes) || !manifest.prefixes.length || manifest.prefixes.length > B17_R2_LIMITS.prefixes || manifest.prefixes.some(prefix => !text(prefix) || !prefix.endsWith("/")) || manifest.prefixes.some((p, i, all) => all.some((other, j) => i !== j && p.startsWith(other)))) fail("PREFIX_INVALID");
  if (!Array.isArray(manifest.objects) || manifest.objects.length > B17_R2_LIMITS.keys) fail("KEY_LIMIT");
  const seen = new Set(); let total = 0;
  for (const object of manifest.objects) {
    if (!plain(object) || !text(object.key) || seen.has(object.key) || !manifest.prefixes.some(prefix => object.key.startsWith(prefix)) || !text(object.etag, 256) || !text(object.version, 256) || !hex(object.sha256) || !Number.isSafeInteger(object.size) || object.size < 0 || object.size > B17_R2_LIMITS.objectBytes || !["Standard", "InfrequentAccess"].includes(object.storageClass)) fail("OBJECT_MANIFEST_INVALID");
    if (Date.parse(iso(object.uploaded)) >= Date.parse(start)) fail("APPROVED_KEY_LATE");
    metadata(object.httpMetadata, true); metadata(object.customMetadata);
    seen.add(object.key); total += object.size;
  }
  if (total > B17_R2_LIMITS.totalBytes) fail("BYTE_LIMIT");
  return manifest;
}
export function hashB17R2Manifest(manifest) { normalizedManifest(manifest); return hashB17R2Evidence(manifest); }
function reviewed(manifest, expected) { if (!hex(expected) || hashB17R2Manifest(manifest) !== expected) fail("MANIFEST_REVIEW_MISMATCH"); }
function ruleSnapshot(rules) {
  if (!Array.isArray(rules) || rules.length > B17_R2_LIMITS.rules) fail("RULE_LIMIT");
  boundedJson(rules); const ids = new Set();
  for (const rule of rules) {
    if (!plain(rule) || !text(rule.id, 256) || ids.has(rule.id) || typeof rule.enabled !== "boolean" || rule.prefix !== undefined && typeof rule.prefix !== "string" || !plain(rule.condition)) fail("RULE_INVALID");
    const condition = rule.condition;
    if (condition.type === "Date") iso(condition.date);
    else if (condition.type === "Age") { if (!Number.isSafeInteger(condition.maxAgeSeconds) || condition.maxAgeSeconds <= 0) fail("RULE_INVALID"); }
    else if (condition.type !== "Indefinite") fail("RULE_INVALID");
    ids.add(rule.id);
  }
  return clone(rules);
}
const normalizedCondition = condition => condition.type === "Date" ? { ...condition, date: iso(condition.date) } : condition;
const rulesHash = rules => hashB17R2Evidence(ruleSnapshot(rules).map(rule => ({ ...rule, condition: normalizedCondition(rule.condition) })).sort((a, b) => a.id.localeCompare(b.id)));
export const hashB17R2Rules = rulesHash;
export function planB17R2Locks({ manifest, reviewedManifestSha256, existingRules, expectedRulesSha256, lockUntil }) {
  reviewed(manifest, reviewedManifestSha256);
  const original = ruleSnapshot(existingRules);
  if (!hex(expectedRulesSha256) || rulesHash(original) !== expectedRulesSha256) fail("RULE_REVIEW_MISMATCH");
  if (!plain(lockUntil) || !["Date", "Indefinite"].includes(lockUntil.type) || lockUntil.type === "Date" && Date.parse(iso(lockUntil.date)) <= Date.parse(iso(manifest.deadline))) fail("LOCK_EXPIRY_INVALID");
  const added = manifest.prefixes.map((prefix, index) => ({ id: `b17-isolated-${reviewedManifestSha256.slice(0, 16)}-${index}`, enabled: true, prefix, condition: clone(lockUntil) }));
  const rules = [...original, ...added]; ruleSnapshot(rules);
  const plan = { format: "b17-r2-lock-plan-v1", manifestSha256: reviewedManifestSha256, ...identities(manifest), frozenAt: manifest.frozenAt, deadline: manifest.deadline, prefixes: clone(manifest.prefixes), existingRulesSha256: expectedRulesSha256, expectedRulesSha256: rulesHash(rules), lockUntil: clone(lockUntil), rules, addedRuleIds: added.map(rule => rule.id) };
  return freeze({ ...plan, sha256: hashB17R2Evidence(plan) });
}
function checkedPlan(plan) {
  if (!plain(plan)) fail("LOCK_PLAN_INVALID");
  const { sha256, ...data } = plan;
  if (!hex(sha256) || hashB17R2Evidence(data) !== sha256 || plan.format !== "b17-r2-lock-plan-v1" || rulesHash(plan.rules) !== plan.expectedRulesSha256) fail("LOCK_PLAN_INVALID");
  identities(plan); iso(plan.frozenAt); iso(plan.deadline);
  if (!hex(plan.manifestSha256) || !hex(plan.existingRulesSha256) || !Array.isArray(plan.prefixes) || !plan.prefixes.length || plan.prefixes.length > B17_R2_LIMITS.prefixes || plan.prefixes.some(prefix => !text(prefix) || !prefix.endsWith("/")) || !Array.isArray(plan.addedRuleIds) || plan.addedRuleIds.length !== plan.prefixes.length || !plain(plan.lockUntil) || !["Date", "Indefinite"].includes(plan.lockUntil.type) || plan.lockUntil.type === "Date" && Date.parse(iso(plan.lockUntil.date)) <= Date.parse(plan.deadline)) fail("LOCK_PLAN_INVALID");
  const addedIds = plan.prefixes.map((_, index) => `b17-isolated-${plan.manifestSha256.slice(0, 16)}-${index}`);
  if (!same(plan.addedRuleIds, addedIds) || rulesHash(plan.rules.filter(rule => !addedIds.includes(rule.id))) !== plan.existingRulesSha256) fail("LOCK_PLAN_INVALID");
  for (let index = 0; index < plan.prefixes.length; index++) {
    const rule = plan.rules.find(row => row.id === addedIds[index]);
    if (!same(rule, { id: addedIds[index], enabled: true, prefix: plan.prefixes[index], condition: plan.lockUntil })) fail("LOCK_PLAN_INVALID");
  }
  return plan;
}
export function verifyB17R2Locks({ plan, actualRules, now }) {
  checkedPlan(plan); const at = Date.parse(iso(now));
  if (at < Date.parse(iso(plan.frozenAt)) || at >= Date.parse(iso(plan.deadline)) || rulesHash(actualRules) !== plan.expectedRulesSha256) fail("LOCK_CHANGED_OR_EXPIRED");
  for (let i = 0; i < plan.prefixes.length; i++) {
    const rule = actualRules.find(row => row.id === plan.addedRuleIds[i]);
    if (!rule || rule.enabled !== true || rule.prefix !== plan.prefixes[i] || !same(normalizedCondition(rule.condition), normalizedCondition(plan.lockUntil)) || rule.condition.type === "Date" && Date.parse(iso(rule.condition.date)) <= Date.parse(plan.deadline)) fail("LOCK_COVERAGE_MISSING");
  }
  return { status: "VERIFIED_OBSERVATION", configurationCAS: false, planSha256: plan.sha256, rulesSha256: plan.expectedRulesSha256, coveredPrefixes: plan.prefixes.length };
}
function safeError(error) { return /^B17_R2_[A-Z_]+$/.test(error?.message ?? "") ? error.message : "B17_R2_ADAPTER_FAILED"; }
async function checkIdentity(manifest, adapter) { if (!same(identities(await adapter.identities()), identities(manifest))) fail("IDENTITY_CHANGED"); }
const target = plan => ({ accountId: plan.accountId, bucket: plan.sourceBucket });
export async function installB17R2Locks({ plan, reviewedPlanSha256 }, adapter) {
  let attempted = false;
  try {
    checkedPlan(plan); if (!hex(reviewedPlanSha256) || reviewedPlanSha256 !== plan.sha256) fail("LOCK_PLAN_REVIEW_MISMATCH"); await checkIdentity(plan, adapter);
    verifyB17R2Locks({ plan, actualRules: plan.rules, now: adapter.now() });
    if (rulesHash(await adapter.readRules(target(plan))) !== plan.existingRulesSha256) fail("RULE_CHANGED_BEFORE_WRITE");
    verifyB17R2Locks({ plan, actualRules: plan.rules, now: adapter.now() });
    // The API replaces the entire array and offers no compare-and-swap. Native
    // coordination must exclude other configuration writers; these observations
    // detect drift but cannot make an unlocked read/write pair atomic.
    attempted = true; await adapter.writeRules({ ...target(plan), rules: clone(plan.rules) });
    return verifyB17R2Locks({ plan, actualRules: await adapter.readRules(target(plan)), now: adapter.now() });
  } catch (error) { return { status: attempted ? "RESULT_UNKNOWN" : "HOLD", code: safeError(error), configurationCAS: false, planSha256: safeDigest(plan?.sha256) }; }
}

async function bodyBytes(object, expected) {
  if (!object?.body || typeof object.body.getReader !== "function") fail("CONDITIONAL_BODY_MISSING");
  if (object.range !== undefined && (object.range.offset !== 0 || object.range.length !== expected)) fail("BODY_RANGE_INVALID");
  const reader = object.body.getReader(), chunks = []; let count = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read(); if (done) break;
      if (!(value instanceof Uint8Array)) fail("BODY_INVALID");
      count += value.byteLength;
      if (count > expected || count > B17_R2_LIMITS.objectBytes) fail("BODY_SIZE_MISMATCH");
      chunks.push(value);
    }
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
  if (count !== expected) fail("BODY_SIZE_MISMATCH");
  return Buffer.concat(chunks, count);
}
function objectMatches(object, entry, source, candidateVersion) {
  if (!object || object.key !== entry.key || object.size !== entry.size || !text(object.version, 256) || !text(object.etag, 256) || !same(metadata(object.httpMetadata, true), metadata(entry.httpMetadata, true)) || !same(metadata(object.customMetadata), metadata(entry.customMetadata)) || object.storageClass !== entry.storageClass) fail("OBJECT_METADATA_MISMATCH");
  if (source && (object.etag !== entry.etag || object.version !== entry.version || iso(object.uploaded) !== iso(entry.uploaded))) fail("SOURCE_CHANGED");
  iso(object.uploaded);
  if (!source && candidateVersion && object.version !== candidateVersion) fail("CANDIDATE_VERSION_CHANGED");
}
async function verifiedGet(bucket, entry, source = false, candidateVersion) {
  const object = await bucket.get(entry.key, source ? { onlyIf: { etagMatches: entry.etag } } : undefined);
  objectMatches(object, entry, source, candidateVersion);
  const bytes = await bodyBytes(object, entry.size);
  if (digest(bytes) !== entry.sha256) fail("CONTENT_HASH_MISMATCH");
  return { bytes, version: object.version };
}
async function inventory(candidate, allowed) {
  const seen = new Set(), cursors = new Set(); let cursor;
  for (let page = 0; page < B17_R2_LIMITS.listPages; page++) {
    const listed = await candidate.list({ limit: 1000, ...(cursor ? { cursor } : {}) });
    if (!Array.isArray(listed?.objects) || typeof listed.truncated !== "boolean" || listed.objects.length > 1000) fail("INVENTORY_INVALID");
    for (const object of listed.objects) {
      if (!text(object.key) || seen.has(object.key) || !allowed.has(object.key)) fail("CANDIDATE_EXTRA_OR_DUPLICATE_KEY");
      if (object.version !== allowed.get(object.key)) fail("CANDIDATE_INVENTORY_VERSION_CHANGED");
      seen.add(object.key);
    }
    if (seen.size > B17_R2_LIMITS.keys) fail("KEY_LIMIT");
    if (!listed.truncated) { if (!same([...seen].sort(), [...allowed.keys()].sort())) fail("CANDIDATE_KEY_MISSING"); return; }
    if (!text(listed.cursor, 4096) || cursors.has(listed.cursor)) fail("INVENTORY_CURSOR_INVALID");
    cursor = listed.cursor; cursors.add(cursor);
  }
  fail("INVENTORY_PAGE_LIMIT");
}
async function savedReceipt(receipt, adapter, previousSha256) {
  const receiptIdentitySha256 = hashB17R2Evidence({ accountId: receipt.accountId, candidateBucket: receipt.candidateBucket });
  // Trusted native storage must atomically create this stable identity once and
  // CAS later versions under an exclusive local lock. An omitted input receipt
  // cannot grant permission to replace an existing run's recovery evidence.
  // Identity is the physical candidate, independent of a newly generated plan.
  // Unresolved writes require approved recovery on a fresh candidate, not replay.
  const saved = await adapter.saveReceipt(freeze(clone(receipt)), { receiptIdentitySha256, createOnly: previousSha256 === undefined, expectedPreviousSha256: previousSha256 ?? null });
  if (saved?.sha256 !== hashB17R2Evidence(receipt) || saved.receiptIdentitySha256 !== receiptIdentitySha256 || saved.previousSha256 !== (previousSha256 ?? null)) fail("RECEIPT_NOT_DURABLE");
  return saved.sha256;
}
function copyContext(manifest, reviewedManifestSha256, lockPlan) {
  reviewed(manifest, reviewedManifestSha256); checkedPlan(lockPlan);
  if (lockPlan.manifestSha256 !== reviewedManifestSha256 || !same(identities(lockPlan), identities(manifest)) || !same(lockPlan.prefixes, manifest.prefixes) || iso(lockPlan.frozenAt) !== iso(manifest.frozenAt) || iso(lockPlan.deadline) !== iso(manifest.deadline)) fail("LOCK_MANIFEST_MISMATCH");
}
async function lockCheck(plan, adapter) { await checkIdentity(plan, adapter); return verifyB17R2Locks({ plan, actualRules: await adapter.readRules(target(plan)), now: adapter.now() }); }
export async function copyB17R2Objects({ manifest, reviewedManifestSha256, lockPlan, receipt: previousReceipt }, adapter) {
  let receipt, receiptSha256, attempted = false, verifiedObjects = 0, verifiedBytes = 0;
  try {
    copyContext(manifest, reviewedManifestSha256, lockPlan);
    if (previousReceipt) fail("REPLAY_FORBIDDEN");
    receipt = { format: "b17-r2-copy-receipt-v1", accountId: manifest.accountId, candidateBucket: manifest.candidateBucket, manifestSha256: reviewedManifestSha256, planSha256: lockPlan.sha256, status: "IN_PROGRESS", attempts: [] };
    const complete = new Map(); await lockCheck(lockPlan, adapter); await inventory(adapter.candidate, complete);
    receiptSha256 = await savedReceipt(receipt, adapter);
    for (let index = 0; index < manifest.objects.length; index++) {
      const entry = manifest.objects[index];
      await lockCheck(lockPlan, adapter); await inventory(adapter.candidate, complete); await lockCheck(lockPlan, adapter);
      const source = await verifiedGet(adapter.source, entry, true);
      await lockCheck(lockPlan, adapter);
      if (await adapter.candidate.head(entry.key) !== null) fail("CANDIDATE_EXISTS");
      const attempt = { index, keySha256: digest(entry.key), state: "ATTEMPTED", attemptedAt: iso(adapter.now()) };
      receipt.attempts.push(attempt); receiptSha256 = await savedReceipt(receipt, adapter, receiptSha256);
      await lockCheck(lockPlan, adapter);
      attempted = true;
      const httpMetadata = metadata(entry.httpMetadata, true); if (httpMetadata.cacheExpiry) httpMetadata.cacheExpiry = new Date(httpMetadata.cacheExpiry);
      const written = await adapter.candidate.put(entry.key, source.bytes, { onlyIf: { etagDoesNotMatch: "*" }, httpMetadata, customMetadata: metadata(entry.customMetadata), storageClass: entry.storageClass, sha256: entry.sha256 });
      if (written === null) { attempted = false; fail("CREATE_PRECONDITION_FAILED"); }
      objectMatches(written, entry, false);
      attempt.state = "RETURNED"; attempt.candidateVersion = written.version; receiptSha256 = await savedReceipt(receipt, adapter, receiptSha256);
      await verifiedGet(adapter.candidate, entry, false, written.version);
      await lockCheck(lockPlan, adapter); complete.set(entry.key, written.version); await inventory(adapter.candidate, complete);
      attempt.state = "VERIFIED"; receiptSha256 = await savedReceipt(receipt, adapter, receiptSha256);
      attempted = false; verifiedObjects++; verifiedBytes += entry.size;
    }
    await lockCheck(lockPlan, adapter); await inventory(adapter.candidate, complete); await lockCheck(lockPlan, adapter);
    receipt.status = "COMPLETE"; receiptSha256 = await savedReceipt(receipt, adapter, receiptSha256); await lockCheck(lockPlan, adapter);
    return { status: "VERIFIED", manifestSha256: reviewedManifestSha256, planSha256: lockPlan.sha256, receiptSha256, verifiedObjects, verifiedBytes, sourceInventory: "NOT_ENUMERATED_NOT_TRANSFERRED", configurationCAS: false };
  } catch (error) { return { status: attempted ? "RESULT_UNKNOWN" : "HOLD", code: safeError(error), manifestSha256: safeDigest(reviewedManifestSha256), planSha256: safeDigest(lockPlan?.sha256), receiptSha256, verifiedObjects, verifiedBytes, configurationCAS: false }; }
}
export async function reconcileB17R2Copy({ manifest, reviewedManifestSha256, lockPlan, receipt, expectedReceiptSha256 }, adapter) {
  try {
    copyContext(manifest, reviewedManifestSha256, lockPlan);
    if (!hex(expectedReceiptSha256) || hashB17R2Evidence(receipt) !== expectedReceiptSha256 || receipt?.format !== "b17-r2-copy-receipt-v1" || receipt.accountId !== manifest.accountId || receipt.candidateBucket !== manifest.candidateBucket || receipt.manifestSha256 !== reviewedManifestSha256 || receipt.planSha256 !== lockPlan.sha256 || !["IN_PROGRESS", "COMPLETE"].includes(receipt.status) || !Array.isArray(receipt.attempts) || receipt.attempts.length > manifest.objects.length || receipt.status === "COMPLETE" && (receipt.attempts.length !== manifest.objects.length || receipt.attempts.some(attempt => attempt.state !== "VERIFIED"))) fail("RECEIPT_INVALID");
    const completed = new Map(); let unknownWriter = false, bytes = 0;
    await lockCheck(lockPlan, adapter);
    for (let index = 0; index < receipt.attempts.length; index++) {
      const attempt = receipt.attempts[index], entry = manifest.objects[index];
      if (attempt.index !== index || attempt.keySha256 !== digest(entry.key) || !["ATTEMPTED", "RETURNED", "VERIFIED"].includes(attempt.state) || (attempt.state === "ATTEMPTED" ? attempt.candidateVersion !== undefined : !text(attempt.candidateVersion, 256)) || index < receipt.attempts.length - 1 && attempt.state !== "VERIFIED") fail("RECEIPT_INVALID");
      const attemptedAt = Date.parse(iso(attempt.attemptedAt));
      if (attemptedAt < Date.parse(manifest.frozenAt) || attemptedAt >= Date.parse(manifest.deadline)) fail("RECEIPT_INVALID");
      await verifiedGet(adapter.source, entry, true); const candidate = await verifiedGet(adapter.candidate, entry, false, attempt.candidateVersion);
      if (!attempt.candidateVersion) unknownWriter = true;
      completed.set(entry.key, candidate.version); bytes += entry.size;
      await lockCheck(lockPlan, adapter);
    }
    await inventory(adapter.candidate, completed); await lockCheck(lockPlan, adapter);
    const all = receipt.attempts.length === manifest.objects.length;
    return { status: unknownWriter ? "CONTENT_VERIFIED_RESULT_UNKNOWN" : all ? "VERIFIED_RECONCILED" : "PARTIAL_VERIFIED_NO_REPLAY", canProceed: !unknownWriter && all, verifiedObjects: completed.size, verifiedBytes: bytes, manifestSha256: reviewedManifestSha256, receiptSha256: expectedReceiptSha256, configurationCAS: false };
  } catch (error) { return { status: "HOLD", canProceed: false, code: safeError(error), manifestSha256: safeDigest(reviewedManifestSha256) }; }
}
