import { createHash } from "node:crypto";
import { env } from "cloudflare:workers";
import { afterEach, expect, it } from "vitest";
import { copyB17R2Objects, hashB17R2Evidence, hashB17R2Manifest, hashB17R2Rules, installB17R2Locks, planB17R2Locks, reconcileB17R2Copy, verifyB17R2Locks } from "../../scripts/b17-isolated-r2.mjs";

const { SOURCE_PHOTOS: source, CANDIDATE_PHOTOS: candidate } = env as unknown as { SOURCE_PHOTOS: R2Bucket; CANDIDATE_PHOTOS: R2Bucket };
const keys = new Set<string>();
const hash = (bytes: Uint8Array | string) => createHash("sha256").update(bytes).digest("hex");
const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value));
afterEach(async () => { if (keys.size) { await source.delete([...keys]); await candidate.delete([...keys]); } keys.clear(); });

async function fixture(label: string) {
  const key = `photos/${label}/approved.bin`, prefix = `photos/${label}/`, bytes = new TextEncoder().encode("synthetic preserved bytes");
  keys.add(key);
  await source.put(key, bytes, { httpMetadata: { contentType: "application/octet-stream", contentLanguage: "ko", contentDisposition: "inline", contentEncoding: "identity", cacheControl: "private, max-age=0", cacheExpiry: new Date("2027-01-01T00:00:00.000Z") }, customMetadata: { purpose: "synthetic-private-review", revision: "1" }, storageClass: "Standard" });
  const original = (await source.head(key))!;
  // Pinned Miniflare returns an empty storageClass even after explicit Standard.
  // Only this field is fixture-supplied, not claimed as native platform proof.
  expect(original.storageClass).toBe("");
  const normalizedObject = (object: R2Object | R2ObjectBody | null) => object === null ? null : { key: object.key, version: object.version, size: object.size, etag: object.etag, uploaded: object.uploaded, httpMetadata: object.httpMetadata, customMetadata: object.customMetadata, storageClass: "Standard", ...("body" in object ? { body: object.body } : {}), ...(object.range !== undefined ? { range: object.range } : {}) };
  const frozenAt = new Date(original.uploaded.getTime() + 10).toISOString(), deadline = new Date(Date.parse(frozenAt) + 60_000).toISOString();
  const manifest = { format: "b17-isolated-r2-v1", accountId: "a".repeat(32), sourceBucket: "synthetic-source", candidateBucket: "synthetic-candidate", frozenAt, deadline, prefixes: [prefix], objects: [{ key, etag: original.etag, version: original.version, size: original.size, uploaded: original.uploaded.toISOString(), sha256: hash(bytes), httpMetadata: clone(original.httpMetadata ?? {}), customMetadata: clone(original.customMetadata ?? {}), storageClass: "Standard" }] };
  const reviewedManifestSha256 = hashB17R2Manifest(manifest);
  const existing = [{ id: "keep-existing", enabled: false, prefix: "other/", condition: { type: "Age", maxAgeSeconds: 5 }, extension: { preserve: ["all", "fields"] } }];
  let rules: unknown[] = clone(existing), receipt: any = null, puts = 0, writes = 0;
  const plan = planB17R2Locks({ manifest, reviewedManifestSha256, existingRules: existing, expectedRulesSha256: hashB17R2Rules(existing), lockUntil: { type: "Date", date: new Date(Date.parse(deadline) + 60_000).toISOString() } });
  const adapter: any = {
    now: () => new Date(Date.parse(frozenAt) + 1).toISOString(),
    identities: async () => ({ accountId: manifest.accountId, sourceBucket: manifest.sourceBucket, candidateBucket: manifest.candidateBucket }),
    readRules: async () => clone(rules), writeRules: async ({ rules: next }: any) => { writes++; rules = clone(next); },
    saveReceipt: async (next: any, options: { receiptIdentitySha256: string; createOnly: boolean; expectedPreviousSha256: string | null }) => { if (options.createOnly ? receipt !== null : !receipt || hashB17R2Evidence(receipt) !== options.expectedPreviousSha256) throw Error("B17_R2_RECEIPT_CONFLICT"); receipt = clone(next); return { sha256: hashB17R2Evidence(next), receiptIdentitySha256: options.receiptIdentitySha256, previousSha256: options.expectedPreviousSha256 }; },
    source: { get: async (requested: string, options: R2GetOptions) => { expect(requested).toBe(key); expect(options.onlyIf).toMatchObject({ etagMatches: original.etag }); return normalizedObject(await source.get(requested, options)); } },
    candidate: { head: (requested: string) => candidate.head(requested), list: (options: R2ListOptions) => candidate.list(options), get: async (requested: string) => normalizedObject(await candidate.get(requested)), put: async (requested: string, value: Uint8Array, options: R2PutOptions) => { puts++; expect(options.onlyIf).toEqual({ etagDoesNotMatch: "*" }); expect(receipt?.attempts.at(-1)?.state).toBe("ATTEMPTED"); return normalizedObject(await candidate.put(requested, value, options)); } },
  };
  const args = { manifest, reviewedManifestSha256, lockPlan: plan };
  return { key, bytes, original, existing, plan, args, adapter, receipt: () => receipt, puts: () => puts, writes: () => writes, setRules: (next: unknown[]) => { rules = next; }, rules: () => clone(rules) };
}

it("preserves additive rules and copies only reviewed bytes/metadata using actual local R2 conditional operations", async () => {
  const f = await fixture("success");
  expect(await installB17R2Locks({ plan: f.plan, reviewedPlanSha256: f.plan.sha256 }, f.adapter)).toMatchObject({ status: "VERIFIED_OBSERVATION", configurationCAS: false });
  expect(f.rules()[0]).toEqual(f.existing[0]); expect(f.writes()).toBe(1);
  const normalizedDate = clone(f.rules()) as any[]; normalizedDate[1].condition.date = normalizedDate[1].condition.date.replace(/Z$/, "000Z");
  expect(normalizedDate[1].condition.date).not.toBe((f.rules()[1] as any).condition.date);
  expect(verifyB17R2Locks({ plan: f.plan, actualRules: normalizedDate, now: f.adapter.now() }).status).toBe("VERIFIED_OBSERVATION");
  const drift = clone(f.rules()) as any[]; drift[1].enabled = false;
  expect(() => verifyB17R2Locks({ plan: f.plan, actualRules: drift, now: f.adapter.now() })).toThrow("LOCK_CHANGED_OR_EXPIRED");
  expect(() => verifyB17R2Locks({ plan: f.plan, actualRules: f.rules(), now: f.args.manifest.deadline })).toThrow("LOCK_CHANGED_OR_EXPIRED");
  expect(() => hashB17R2Manifest({ ...f.args.manifest, objects: [f.args.manifest.objects[0], f.args.manifest.objects[0]] })).toThrow("OBJECT_MANIFEST_INVALID");
  expect(() => hashB17R2Manifest({ ...f.args.manifest, objects: [{ ...f.args.manifest.objects[0], uploaded: f.args.manifest.frozenAt }] })).toThrow("APPROVED_KEY_LATE");
  // Local control-plane rules are simulated; this does not test enforcement of
  // real Cloudflare bucket locks. Unreferenced late source keys are not copied.
  const extra = `photos/success/unreviewed.bin`; keys.add(extra); await source.put(extra, "unreviewed late source work");
  const result = await copyB17R2Objects(f.args, f.adapter);
  expect(result.code).toBeUndefined();
  expect(result).toMatchObject({ status: "VERIFIED", verifiedObjects: 1, verifiedBytes: f.bytes.length, sourceInventory: "NOT_ENUMERATED_NOT_TRANSFERRED", configurationCAS: false });
  const copied = (await candidate.get(f.key))!;
  expect(hash(new Uint8Array(await copied.arrayBuffer()))).toBe(hash(f.bytes));
  expect(copied.httpMetadata).toEqual(f.original.httpMetadata); expect(copied.customMetadata).toEqual(f.original.customMetadata);
  expect(await candidate.head(extra)).toBeNull(); expect(f.puts()).toBe(1);
  expect(JSON.stringify(result)).not.toContain(f.key);
  expect(await copyB17R2Objects({ ...f.args, receipt: f.receipt() }, f.adapter)).toMatchObject({ status: "HOLD", code: "B17_R2_REPLAY_FORBIDDEN" });
  expect(f.puts()).toBe(1);
  const empty = { ...f.args.manifest, objects: [] }; const emptyHash = hashB17R2Manifest(empty);
  const emptyPlan = planB17R2Locks({ manifest: empty, reviewedManifestSha256: emptyHash, existingRules: [], expectedRulesSha256: hashB17R2Rules([]), lockUntil: { type: "Indefinite" } });
  f.setRules(emptyPlan.rules);
  expect(await copyB17R2Objects({ manifest: empty, reviewedManifestSha256: emptyHash, lockPlan: emptyPlan }, f.adapter)).toMatchObject({ status: "HOLD", code: "B17_R2_CANDIDATE_EXTRA_OR_DUPLICATE_KEY" });
});

it("rejects an actual source rewrite and existing candidate without overwriting either", async () => {
  const expiry = await fixture("expired-install"); expiry.adapter.now = () => expiry.args.manifest.deadline;
  expect(await installB17R2Locks({ plan: expiry.plan, reviewedPlanSha256: expiry.plan.sha256 }, expiry.adapter)).toMatchObject({ status: "HOLD" }); expect(expiry.writes()).toBe(0);
  const age = clone(expiry.plan) as any; age.lockUntil = { type: "Age", maxAgeSeconds: 1 }; age.rules.at(-1).condition = age.lockUntil; age.expectedRulesSha256 = hashB17R2Rules(age.rules); delete age.sha256; age.sha256 = hashB17R2Evidence(age);
  expect(() => verifyB17R2Locks({ plan: age, actualRules: age.rules, now: expiry.adapter.now() })).toThrow("LOCK_PLAN_INVALID");
  const receiptExpiry = await fixture("expired-receipt"); await installB17R2Locks({ plan: receiptExpiry.plan, reviewedPlanSha256: receiptExpiry.plan.sha256 }, receiptExpiry.adapter);
  const save = receiptExpiry.adapter.saveReceipt;
  receiptExpiry.adapter.saveReceipt = async (next: any, options: any) => { const result = await save(next, options); if (next.attempts.at(-1)?.state === "ATTEMPTED") receiptExpiry.adapter.now = () => receiptExpiry.args.manifest.deadline; return result; };
  expect(await copyB17R2Objects(receiptExpiry.args, receiptExpiry.adapter)).toMatchObject({ status: "HOLD", code: "B17_R2_LOCK_CHANGED_OR_EXPIRED" }); expect(receiptExpiry.puts()).toBe(0);
  const changed = await fixture("source-changed");
  await installB17R2Locks({ plan: changed.plan, reviewedPlanSha256: changed.plan.sha256 }, changed.adapter);
  await source.put(changed.key, changed.bytes, { httpMetadata: changed.original.httpMetadata, customMetadata: changed.original.customMetadata });
  expect(await copyB17R2Objects(changed.args, changed.adapter)).toMatchObject({ status: "HOLD", code: "B17_R2_SOURCE_CHANGED" });
  expect(changed.puts()).toBe(0); expect(await candidate.head(changed.key)).toBeNull();
  // A new plan cannot reuse the same still-empty physical candidate after a
  // durable earlier attempt/receipt, even if the caller omits previousReceipt.
  const replacement = { ...changed.args.manifest, objects: [] }, replacementHash = hashB17R2Manifest(replacement);
  const replacementPlan = planB17R2Locks({ manifest: replacement, reviewedManifestSha256: replacementHash, existingRules: [], expectedRulesSha256: hashB17R2Rules([]), lockUntil: { type: "Indefinite" } });
  changed.setRules(replacementPlan.rules);
  expect(await copyB17R2Objects({ manifest: replacement, reviewedManifestSha256: replacementHash, lockPlan: replacementPlan }, changed.adapter)).toMatchObject({ status: "HOLD", code: "B17_R2_RECEIPT_CONFLICT" });
  expect(changed.puts()).toBe(0);
  const collision = await fixture("collision"); await installB17R2Locks({ plan: collision.plan, reviewedPlanSha256: collision.plan.sha256 }, collision.adapter);
  await candidate.put(collision.key, "existing candidate must survive");
  expect(await copyB17R2Objects(collision.args, collision.adapter)).toMatchObject({ status: "HOLD", code: "B17_R2_CANDIDATE_EXTRA_OR_DUPLICATE_KEY" });
  expect(await (await candidate.get(collision.key))!.text()).toBe("existing candidate must survive"); expect(collision.puts()).toBe(0);
  // Exercise the actual binding precondition independently of the earlier
  // inventory guard: create-only PUT must not replace an existing object.
  expect(await candidate.put(collision.key, "forbidden overwrite", { onlyIf: { etagDoesNotMatch: "*" } })).toBeNull();
  expect(await (await candidate.get(collision.key))!.text()).toBe("existing candidate must survive");
  await candidate.delete(collision.key);
  const raced = await fixture("candidate-race"); await installB17R2Locks({ plan: raced.plan, reviewedPlanSha256: raced.plan.sha256 }, raced.adapter);
  const get = raced.adapter.candidate.get;
  raced.adapter.candidate.get = async (requested: string) => { const object = await get(requested); await candidate.put(requested, raced.bytes, { httpMetadata: raced.original.httpMetadata, customMetadata: raced.original.customMetadata }); return object; };
  expect(await copyB17R2Objects(raced.args, raced.adapter)).toMatchObject({ status: "RESULT_UNKNOWN", code: "B17_R2_CANDIDATE_INVENTORY_VERSION_CHANGED" });
});

it("reconciles lost responses by read only and keeps unknown writer identity UNKNOWN", async () => {
  const f = await fixture("response-lost"); await installB17R2Locks({ plan: f.plan, reviewedPlanSha256: f.plan.sha256 }, f.adapter);
  const put = f.adapter.candidate.put;
  f.adapter.candidate.put = async (...args: unknown[]) => { await put(...args); throw Error("synthetic lost response"); };
  expect(await copyB17R2Objects(f.args, f.adapter)).toMatchObject({ status: "RESULT_UNKNOWN", verifiedObjects: 0 });
  const receipt = f.receipt();
  expect(receipt.attempts[0]).toMatchObject({ state: "ATTEMPTED" }); expect(receipt.attempts[0].candidateVersion).toBeUndefined();
  expect(await reconcileB17R2Copy({ ...f.args, receipt, expectedReceiptSha256: hashB17R2Evidence(receipt) }, f.adapter)).toMatchObject({ status: "CONTENT_VERIFIED_RESULT_UNKNOWN", canProceed: false, verifiedObjects: 1 });
  expect(await copyB17R2Objects({ ...f.args, receipt }, f.adapter)).toMatchObject({ status: "HOLD", code: "B17_R2_REPLAY_FORBIDDEN" });
  expect(f.puts()).toBe(1);
  await candidate.delete(f.key);
  const known = await fixture("readback-lost"); await installB17R2Locks({ plan: known.plan, reviewedPlanSha256: known.plan.sha256 }, known.adapter);
  const get = known.adapter.candidate.get; let lost = false;
  known.adapter.candidate.get = async (requested: string) => { if (!lost) { lost = true; throw Error("synthetic readback response lost"); } return get(requested); };
  expect(await copyB17R2Objects(known.args, known.adapter)).toMatchObject({ status: "RESULT_UNKNOWN" });
  const knownReceipt = known.receipt(); expect(knownReceipt.attempts[0].state).toBe("RETURNED");
  expect(await reconcileB17R2Copy({ ...known.args, receipt: knownReceipt, expectedReceiptSha256: hashB17R2Evidence(knownReceipt) }, known.adapter)).toMatchObject({ status: "VERIFIED_RECONCILED", canProceed: true }); expect(known.puts()).toBe(1);
});
