import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const quote = (value) => value === null ? "NULL" : typeof value === "number" ? String(value) : `'${String(value).replaceAll("'", "''")}'`;
const sha = (value) => createHash("sha256").update(value).digest("hex");
const normalize = (value) => value.normalize("NFKC").toLowerCase().replace(/\([^)]*\)/g, "").replace(/[\s.,·-]/gu, "");
const addressKey = (value) => normalize(value.replace(/^(전남광주통합특별시|광주광역시|전라남도|광주|전남)\s*/, ""));
/** One explicitly reviewed operator rollout; no HTTP route calls this generator. */
export function buildTemp100PublicationSql({ manifest, snapshot, operatorId, now, action = "publish" }) {
  if (!["publish", "withdraw"].includes(action) || !/^[A-Za-z0-9_-]{1,128}$/.test(operatorId) || !Number.isFinite(Date.parse(now))) throw new Error("TEMP_OPERATOR_INPUT_INVALID");
  const manifestHash = sha(JSON.stringify(manifest)), batchId = `temp100-${manifestHash.slice(0, 16)}`;
  if (manifest.sourceHash !== "d949f94c4a760aa42c2894ff220c0203d272da49a793cbe402dc79e38cedc900" || manifest.entries.length !== 100 || new Set(manifest.entries.map((e) => e.sourceId)).size !== 100 || manifest.entries.filter((e) => e.photo).length !== 23 || snapshot.entries.length !== 100 || snapshot.batch.id !== batchId || snapshot.batch.manifest_hash !== manifestHash || !Number.isSafeInteger(snapshot.batch.version) || !Number.isSafeInteger(snapshot.canonicalVersion)) throw new Error("TEMP_SNAPSHOT_MISMATCH");
  const publish = action === "publish", expectedStatus = publish ? "STAGED" : "PUBLISHED";
  if (snapshot.batch.status !== expectedStatus) throw new Error("TEMP_SNAPSHOT_MISMATCH");
  const marker = `temp-operator-${action}-${manifestHash}`, trigger = `temp_operator_${action}_${manifestHash.slice(0, 16)}`;
  const checks = [`NEW.actor_user_id=${quote(operatorId)} AND EXISTS(SELECT 1 FROM users WHERE id=${quote(operatorId)} AND role='ADMIN' AND email NOT LIKE 'withdrawn.%@invalid.local')`,
    `EXISTS(SELECT 1 FROM temp_catalog_batches WHERE id=${quote(batchId)} AND manifest_hash=${quote(manifestHash)} AND version=${snapshot.batch.version} AND status=${quote(expectedStatus)})`,
    `EXISTS(SELECT 1 FROM temp_catalog_versions WHERE id=1 AND version=${snapshot.canonicalVersion})`,
    `(SELECT count(*) FROM temp_catalog_entries WHERE batch_id=${quote(batchId)})=100`];
  const mutations = [`UPDATE temp_catalog_batches SET status=${quote(publish ? "PUBLISHED" : "WITHDRAWN")},version=version+1,updated_at=${quote(now)} WHERE id=${quote(batchId)};`];
  for (const entry of manifest.entries) {
    const row = snapshot.entries.find((r) => r.source_id === entry.sourceId);
    if (!row || row.batch_id !== batchId || row.id !== `${batchId}-${entry.sourceId}` || row.payload_json !== JSON.stringify(entry)) throw new Error("TEMP_ENTRY_MISMATCH");
    // Source fields are immutable under 0044; the batch hash binds their reviewed manifest.
    checks.push(`EXISTS(SELECT 1 FROM temp_catalog_entries WHERE id=${quote(row.id)} AND batch_id=${quote(batchId)} AND place_id IS ${quote(row.place_id)} AND owns_place=${Number(row.owns_place)} AND latitude IS ${quote(row.latitude)} AND longitude IS ${quote(row.longitude)} AND geo_status=${quote(row.geo_status)})`);
    if (publish) {
      if (row.geo_status !== "MATCHED" || !Number.isFinite(row.latitude) || !Number.isFinite(row.longitude) || row.latitude < 33 || row.latitude > 36 || row.longitude < 125 || row.longitude > 128) throw new Error("TEMP_COORDINATES_NOT_READY");
      if (entry.photo) {
        const extension = ({ "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" })[entry.photo.contentType];
        const key = `temp100/${batchId}/${entry.sourceId}-${entry.photo.sha256}.${extension}`;
        if (!snapshot.photos?.some((p) => p.key === key && p.sha256 === entry.photo.sha256 && p.contentType === entry.photo.contentType)) throw new Error("TEMP_PHOTO_NOT_READY");
      }
      if (row.place_id) {
        const place = snapshot.places.find((p) => p.id === row.place_id);
        if (!place || place.status !== "PUBLISHED" || normalize(place.name) !== normalize(entry.name) || addressKey(place.address) !== addressKey(entry.address)) throw new Error("TEMP_CANONICAL_CONFLICT");
        checks.push(`EXISTS(SELECT 1 FROM places WHERE id=${quote(place.id)} AND name=${quote(place.name)} AND address=${quote(place.address)} AND status='PUBLISHED')`);
        continue;
      }
      if (snapshot.places.some((p) => normalize(p.name) === normalize(entry.name) && addressKey(p.address) === addressKey(entry.address))) throw new Error("TEMP_CANONICAL_CONFLICT");
    }
  }
  const selection = `e.batch_id=${quote(batchId)} AND e.place_id IS NULL`;
  const cuisine = "json_extract(e.payload_json,'$.cuisine')";
  const categorySql = `CASE WHEN ${cuisine} LIKE '%해산물%' OR ${cuisine} LIKE '%장어%' THEN 'seafood-dish' WHEN ${cuisine} LIKE '%고기%' THEN 'grill' WHEN ${cuisine}='중식' THEN 'chinese-general' WHEN ${cuisine}='일식' THEN 'japanese-general' WHEN ${cuisine}='양식' THEN 'western-general' ELSE 'korean-general' END`;
  if (publish) {
    checks.push(`NOT EXISTS(SELECT 1 FROM temp_catalog_entries e LEFT JOIN categories c ON c.slug=(${categorySql}) AND c.is_active=1 WHERE ${selection} AND c.id IS NULL)`);
    checks.push(`NOT EXISTS(SELECT 1 FROM temp_catalog_entries e JOIN places p ON replace(lower(p.name),' ','')=replace(lower(json_extract(e.payload_json,'$.name')),' ','') AND replace(lower(p.address),' ','')=replace(lower(json_extract(e.payload_json,'$.address')),' ','') WHERE ${selection})`);
    mutations.push(`INSERT INTO places(id,slug,name,status,address,neighborhood,latitude,longitude,hero_image_url,search_text,created_at,updated_at)
SELECT e.id,e.id,json_extract(e.payload_json,'$.name'),'PUBLISHED',json_extract(e.payload_json,'$.address'),json_extract(e.payload_json,'$.region'),e.latitude,e.longitude,
CASE WHEN json_type(e.payload_json,'$.photo')='object' THEN '/temp-photos/'||e.id ELSE NULL END,
json_extract(e.payload_json,'$.name')||' '||json_extract(e.payload_json,'$.address')||' '||json_extract(e.payload_json,'$.region')||' '||${cuisine}||' TEMP',${quote(now)},${quote(now)} FROM temp_catalog_entries e WHERE ${selection};`,
      `INSERT INTO place_categories(place_id,category_id,is_primary) SELECT e.id,c.id,1 FROM temp_catalog_entries e JOIN categories c ON c.slug=(${categorySql}) AND c.is_active=1 WHERE ${selection};`,
      `UPDATE temp_catalog_entries SET place_id=id,owns_place=1,updated_at=${quote(now)} WHERE batch_id=${quote(batchId)} AND place_id IS NULL;`);
  } else mutations.push(`UPDATE places SET status='HIDDEN',updated_at=${quote(now)} WHERE id IN (SELECT place_id FROM temp_catalog_entries WHERE batch_id=${quote(batchId)} AND owns_place=1);`);
  const guarded = checks.map((check) => `SELECT CASE WHEN NOT (${check}) THEN RAISE(ABORT,'TEMP_OPERATOR_CONFLICT') END;`).join("\n");
  const installSql = `CREATE TRIGGER IF NOT EXISTS ${trigger} AFTER INSERT ON admin_audit_logs WHEN NEW.id=${quote(marker)} AND NEW.action='TEMP_CATALOG_OPERATOR_APPLY' AND NEW.target_type='TEMP_BATCH' AND NEW.target_id=${quote(batchId)} BEGIN\n${guarded}\n${mutations.join("\n")}\nEND;\n`;
  const audit = JSON.stringify({ action, batchId, manifestHash, count: 100, photos: 23, coordinates: "verified", policy: "explicit-reviewed-one-time-operator-rollout" });
  const applySql = `INSERT OR IGNORE INTO admin_audit_logs(id,actor_user_id,action,target_type,target_id,after_state,created_at) VALUES(${quote(marker)},${quote(operatorId)},'TEMP_CATALOG_OPERATOR_APPLY','TEMP_BATCH',${quote(batchId)},${quote(audit)},${quote(now)});\n`;
  const cleanupSql = `DROP TRIGGER IF EXISTS ${trigger};\n`;
  return { batchId, marker, trigger, installSql, applySql, cleanupSql, sha256: sha(installSql + applySql + cleanupSql) };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [manifestFile, snapshotFile, operatorId, now, outputPrefix, action] = process.argv.slice(2);
  if (!outputPrefix?.includes(`${path.sep}.superpowers${path.sep}operations${path.sep}`)) throw new Error("TEMP_PRIVATE_OUTPUT_REQUIRED");
  const plan = buildTemp100PublicationSql({ manifest: JSON.parse(await readFile(manifestFile, "utf8")), snapshot: JSON.parse(await readFile(snapshotFile, "utf8")), operatorId, now, action });
  for (const [suffix, text] of [["install", plan.installSql], ["apply", plan.applySql], ["cleanup", plan.cleanupSql]]) await writeFile(`${outputPrefix}.${suffix}.sql`, text, { mode: 0o600, flag: "wx" });
  console.log(JSON.stringify({ batchId: plan.batchId, marker: plan.marker, trigger: plan.trigger, sha256: plan.sha256 }));
}
