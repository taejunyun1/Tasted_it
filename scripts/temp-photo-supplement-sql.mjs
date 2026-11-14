import { createHash } from "node:crypto";
import { lstat, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { tempPhotoSupplementManifestSchema, supplementalPhotoKey } from "../app/features/temp-catalog/temp-photo-supplement.ts";

const quote = (value) => `'${String(value).replaceAll("'", "''")}'`;
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const MAX_PHOTO_BYTES = 8 * 1024 * 1024;
const MAX_TOTAL_BYTES = 64 * 1024 * 1024;

export function buildTempPhotoSupplementSql({ manifest: raw, snapshot, operatorId, now, action = "apply" }) {
  const parsed = tempPhotoSupplementManifestSchema.parse(raw);
  const manifest = { ...parsed, entries: [...parsed.entries].sort((a, b) => a.sourceId.localeCompare(b.sourceId)) };
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(operatorId) || !Number.isFinite(Date.parse(now)) || new Date(now).toISOString() !== now || !["apply", "withdraw"].includes(action)) throw new Error("TEMP_PHOTO_OPERATOR_INVALID");
  const manifestJson = JSON.stringify(manifest), manifestHash = sha256(manifestJson), id = `tempphotos-${manifestHash.slice(0, 16)}`;
  if (Buffer.byteLength(manifestJson) > 1024 * 1024 || snapshot.targetBatch?.id !== manifest.targetBatchId || !Number.isSafeInteger(snapshot.targetBatch.version) || !Number.isSafeInteger(snapshot.canonicalVersion)) throw new Error("TEMP_PHOTO_SNAPSHOT_INVALID");
  let sql;
  const expectedKeys = manifest.entries.map((entry) => supplementalPhotoKey(manifest.targetBatchId, entry));
  if (action === "apply") {
    if (snapshot.targetBatch.status !== "PUBLISHED" || snapshot.entries?.length !== 100) throw new Error("TEMP_PHOTO_TARGET_INVALID");
    const empty = snapshot.entries.filter((row) => JSON.parse(row.payload_json).photo === null);
    if (empty.length !== 77) throw new Error("TEMP_PHOTO_COUNT_INVALID");
    let total = 0;
    for (const entry of manifest.entries) {
      const row = empty.find((item) => item.id === `${manifest.targetBatchId}-${entry.sourceId}`);
      const base = row ? JSON.parse(row.payload_json) : null;
      if (!row || row.batch_id !== manifest.targetBatchId || !row.place_id || base.name !== entry.name || base.address !== entry.address || Date.parse(entry.checkedAt) > Date.parse(now)) throw new Error("TEMP_PHOTO_TARGET_INVALID");
      const key = supplementalPhotoKey(manifest.targetBatchId, entry);
      // sha256 is computed from downloaded R2 bytes, not custom metadata.
      const verified = snapshot.photos?.find((item) => item.key === key);
      if (!verified || verified.sha256 !== entry.sha256 || verified.contentType !== entry.contentType || !Number.isSafeInteger(verified.size) || verified.size < 1 || verified.size > MAX_PHOTO_BYTES) throw new Error("TEMP_PHOTO_BYTES_UNVERIFIED");
      total += verified.size;
    }
    if (total > MAX_TOTAL_BYTES) throw new Error("TEMP_PHOTO_TOTAL_TOO_LARGE");
    sql = `INSERT INTO temp_photo_supplement_batches(id,target_batch_id,manifest_hash,manifest_json,target_version,canonical_version,status,version,created_by,updated_by,created_at,updated_at) SELECT ${[id,manifest.targetBatchId,manifestHash,manifestJson].map(quote).join(",")},${snapshot.targetBatch.version},${snapshot.canonicalVersion},'ACTIVE',0,${quote(operatorId)},${quote(operatorId)},${quote(now)},${quote(now)} WHERE NOT EXISTS(SELECT 1 FROM temp_photo_supplement_batches WHERE id=${quote(id)}) ON CONFLICT(id) DO NOTHING;\n`;
  } else {
    const batch = snapshot.supplementBatch;
    if (!batch || batch.id !== id || batch.manifest_hash !== manifestHash || batch.target_batch_id !== manifest.targetBatchId || batch.status !== "ACTIVE" || !Number.isSafeInteger(batch.version)) throw new Error("TEMP_PHOTO_SNAPSHOT_INVALID");
    sql = `UPDATE temp_photo_supplement_batches SET status='WITHDRAWN',version=version+1,updated_by=${quote(operatorId)},updated_at=${quote(now)} WHERE id=${quote(id)} AND manifest_hash=${quote(manifestHash)} AND status='ACTIVE' AND version=${batch.version};\n`;
  }
  if (Buffer.byteLength(sql) > 100_000) throw new Error("TEMP_PHOTO_SQL_TOO_LARGE");
  return { id, targetBatchId: manifest.targetBatchId, manifestHash, sql, sqlSha256: sha256(sql), expectedKeys, count: 77 };
}

async function privateJson(file) {
  const stat = await lstat(file);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.mode & 0o077 || stat.size > 2 * 1024 * 1024) throw new Error("TEMP_PHOTO_PRIVATE_FILE_REQUIRED");
  return JSON.parse(await readFile(file, "utf8"));
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [manifestFile, snapshotFile, operatorId, now, outputFile, action] = process.argv.slice(2);
  if (!outputFile?.includes(`${path.sep}.superpowers${path.sep}operations${path.sep}`)) throw new Error("TEMP_PHOTO_PRIVATE_FILE_REQUIRED");
  const plan = buildTempPhotoSupplementSql({ manifest: await privateJson(manifestFile), snapshot: await privateJson(snapshotFile), operatorId, now, action });
  await writeFile(outputFile, plan.sql, { mode: 0o600, flag: "wx" });
  console.log(JSON.stringify({ id: plan.id, targetBatchId: plan.targetBatchId, manifestHash: plan.manifestHash, sqlSha256: plan.sqlSha256, count: plan.count }));
}
