import { applyD1Migrations } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { expect, it, vi } from "vitest";
import {
  assertB17ReferenceCoverage, hashB17TransferApproval, readB17IsolatedR2References, runB17IsolatedTransfer,
} from "../../scripts/b17-isolated-transfer.mjs";
import { buildB17FreezeStatements, getB17BaselineCatalogQuery, verifyB17IsolatedD1 } from "../../scripts/b17-isolated-d1.mjs";
import { hashB17R2Evidence, hashB17R2Manifest, hashB17R2Rules, planB17R2Locks } from "../../scripts/b17-isolated-r2.mjs";

const bindings = env as unknown as {
  DB: D1Database;
  MIGRATION_DB: D1Database;
  SOURCE_PHOTOS: R2Bucket;
  CANDIDATE_PHOTOS: R2Bucket;
  TEST_MIGRATIONS: D1Migration[];
};

it("requires a retained TEMP photo and excludes an unrelated pending cleanup key", async () => {
  await applyD1Migrations(bindings.DB, bindings.TEST_MIGRATIONS);
  const batchId = "temp100-0123456789abcdef";
  const sourceId = "temp100-010";
  const photo = { contentType: "image/webp", sha256: "d".repeat(64) };
  await bindings.DB.batch([
    bindings.DB.prepare(`INSERT INTO temp_catalog_batches(id,source_hash,manifest_hash,status,created_at,updated_at)
      VALUES (?,'synthetic','synthetic','WITHDRAWN','t','t')`).bind(batchId),
    bindings.DB.prepare(`INSERT INTO temp_catalog_entries(id,batch_id,source_id,payload_json,created_at,updated_at)
      VALUES (?,?,?,?,'t','t')`).bind(`${batchId}-${sourceId}`, batchId, sourceId, JSON.stringify({ sourceId, photo })),
    bindings.DB.prepare(`INSERT INTO reviewer_photo_cleanup_jobs(review_id,object_keys_json,next_attempt_at,created_at,updated_at)
      VALUES ('synthetic-review','["reviews/synthetic-review/orphan.jpg"]','t','t','t')`),
  ]);
  const { references, counts } = await readB17IsolatedR2References(bindings.DB);
  const key = `temp100/${batchId}/${sourceId}-${photo.sha256}.webp`;
  const object = { key, size: 10, sha256: photo.sha256, httpMetadata: { contentType: photo.contentType } };
  expect(references).toEqual([{ key, ...photo }]);
  expect(counts).toEqual({ reviewer: 0, originalTemp: 1, supplementalTemp: 0, heldCleanupKeys: 1, heldDeleteJobs: 0 });
  expect(() => assertB17ReferenceCoverage(references, [object])).not.toThrow();
  expect(() => assertB17ReferenceCoverage(references, [])).toThrow("B17_TRANSFER_R2_COVERAGE");
  expect(() => assertB17ReferenceCoverage(references, [{ ...object, sha256: "e".repeat(64) }]))
    .toThrow("B17_TRANSFER_R2_REFERENCE_MISMATCH");
  expect(() => assertB17ReferenceCoverage(references, [{ ...object, key: "reviews/synthetic-review/orphan.jpg" }]))
    .toThrow("B17_TRANSFER_R2_REFERENCE_MISMATCH");
  await bindings.DB.batch([
    bindings.DB.prepare("DELETE FROM temp_catalog_entries WHERE batch_id=?").bind(batchId),
    bindings.DB.prepare("DELETE FROM temp_catalog_batches WHERE id=?").bind(batchId),
    bindings.DB.prepare("DELETE FROM reviewer_photo_cleanup_jobs WHERE review_id='synthetic-review'"),
  ]);
});

it("holds before adapter access if approval aliases the same physical D1", async () => {
  const readIdentity = vi.fn();
  const id = "11111111-1111-1111-1111-111111111111";
  const result = await runB17IsolatedTransfer({
    mode: "copy",
    approval: { sourceD1Id: id, candidateD1Id: id },
  }, { sourceD1: bindings.DB, candidateD1: bindings.DB, d1Identities: readIdentity });
  expect(result).toEqual({ status: "HOLD", code: "B17_TRANSFER_APPROVAL" });
  expect(readIdentity).not.toHaveBeenCalled();
});

it("verifies an isolated pair and holds if D1 drifts during read-only reconciliation", async () => {
  const { DB: source, MIGRATION_DB: candidate } = bindings;
  for (const db of [source, candidate]) {
    await applyD1Migrations(db, bindings.TEST_MIGRATIONS);
    await db.prepare("UPDATE d1_migrations SET applied_at='2026-11-18 00:00:00'").run();
  }
  const catalog = (await source.prepare(getB17BaselineCatalogQuery()).all()).results;
  const freeze = buildB17FreezeStatements(catalog);
  await source.batch(freeze.statements.map(statement => source.prepare(statement.sql)));
  const before = await verifyB17IsolatedD1({ source, candidate });
  expect(before.ok).toBe(true);

  const accountId = "a".repeat(32);
  const manifest = {
    format: "b17-isolated-r2-v1",
    accountId,
    sourceBucket: "synthetic-source",
    candidateBucket: "synthetic-candidate",
    prefixes: ["reviews/"],
    frozenAt: "2026-11-18T00:00:00.000Z",
    deadline: "2026-11-18T00:10:00.000Z",
    objects: [],
  };
  const r2ManifestSha256 = hashB17R2Manifest(manifest);
  const lockPlan = planB17R2Locks({
    manifest,
    reviewedManifestSha256: r2ManifestSha256,
    existingRules: [],
    expectedRulesSha256: hashB17R2Rules([]),
    lockUntil: { type: "Date", date: "2026-11-18T01:00:00.000Z" },
  });
  const approval = {
    sourceD1Id: "11111111-1111-1111-1111-111111111111",
    candidateD1Id: "22222222-2222-2222-2222-222222222222",
    d1SnapshotSha256: before.snapshotSha256,
    r2ManifestSha256,
    r2LockPlanSha256: lockPlan.sha256,
  };
  const receipt = {
    format: "b17-r2-copy-receipt-v1", accountId, candidateBucket: manifest.candidateBucket,
    manifestSha256: r2ManifestSha256, planSha256: lockPlan.sha256,
    status: "COMPLETE", attempts: [],
  };
  const currentRules = vi.fn(async () => lockPlan.rules);
  const saveReceipt = vi.fn();
  const adapters = {
    sourceD1: source,
    candidateD1: candidate,
    d1Identities: async () => ({ accountId, sourceD1Id: approval.sourceD1Id, candidateD1Id: approval.candidateD1Id }),
    r2: {
      source: bindings.SOURCE_PHOTOS,
      candidate: bindings.CANDIDATE_PHOTOS,
      identities: async () => ({ accountId, sourceBucket: manifest.sourceBucket, candidateBucket: manifest.candidateBucket }),
      readRules: currentRules,
      now: () => "2026-11-18T00:01:00.000Z",
      saveReceipt,
    },
  };
  const input = {
    mode: "reconcile", approval, reviewedApprovalSha256: hashB17TransferApproval(approval),
    manifest, lockPlan, receipt, expectedReceiptSha256: hashB17R2Evidence(receipt),
  };
  expect(await runB17IsolatedTransfer(input, adapters))
    .toMatchObject({ status: "VERIFIED_BASELINE", tableCount: 82, verifiedObjects: 0 });
  currentRules.mockImplementationOnce(async () => {
    await candidate.prepare("UPDATE temp_catalog_versions SET version=version+1 WHERE id=1").run();
    return lockPlan.rules;
  });
  expect(await runB17IsolatedTransfer(input, adapters))
    .toMatchObject({ status: "HOLD", code: "B17_TRANSFER_D1_AFTER", canProceed: false, receiptSha256: input.expectedReceiptSha256 });
  expect(saveReceipt).not.toHaveBeenCalled();
});
