import { countNaverDispatches } from "../operations/provider-usage.server";
import { and, eq, sql } from "drizzle-orm";
import type { AppDb } from "../../db/client.server";
import { createDb } from "../../db/client.server";
import { naverLocalCategoryRuns, places as canonicalPlaces } from "../../db/schema";
import { assertNaverRegionQuota, getNaverLocalSearchApiCallsToday } from "../places/naver-region-quota.server";
import type { NaverLocalSearchAdapter } from "../candidates/naver-local-search.server";
import { commitAdminOperation, prepareAdminOperation, type AdminOperationInput } from "../operations/admin-operation.server";
import { tempCatalogBatches, tempCatalogEntries } from "./temp-catalog.schema";
import { tempPhotoSupplementBatches, tempPhotoSupplements } from "./temp-photo-supplement.schema";
import { supplementalPhotoKey, tempPhotoSupplementEntrySchema } from "./temp-photo-supplement";
import { categorySlug, coordinateEvidenceSchema, identityKey, photoObjectKey, tempEntrySchema, tempManifestSchema, verifiedCoordinates, type TempPublicInfo } from "./temp-catalog";

type EntryRow = { id: string; batch_id: string; source_id: string; place_id: string | null; owns_place: number; payload_json: string; latitude: number | null; longitude: number | null; geo_status: string };
type BatchRow = { id: string; status: string; version: number; manifest_hash: string };
type CanonicalRow = { id: string; name: string; address: string; status: string; latitude: number; longitude: number };
const nowValid = (now: string) => Number.isFinite(Date.parse(now)) && new Date(now).toISOString() === now;
async function assertAdmin(database: D1Database, actor: string) {
  if (!await database.prepare("SELECT id FROM users WHERE id=? AND role='ADMIN' AND email NOT LIKE 'withdrawn+%'").bind(actor).first()) throw new Error("ADMIN_REQUIRED");
}
export async function sha256(text: string) {
  return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text))), (b) => b.toString(16).padStart(2, "0")).join("");
}
async function batchRows(database: D1Database, batchId: string) {
  if (!/^temp100-[a-f0-9]{16}$/.test(batchId)) throw new Error("TEMP_BATCH_INVALID");
  const batch = await database.prepare("SELECT * FROM temp_catalog_batches WHERE id=?").bind(batchId).first<BatchRow>();
  if (!batch) throw new Error("TEMP_BATCH_NOT_FOUND");
  const rows = (await database.prepare("SELECT * FROM temp_catalog_entries WHERE batch_id=? ORDER BY source_id").bind(batchId).all<EntryRow>()).results;
  if (rows.length !== 100) throw new Error("TEMP100_COUNT_MISMATCH");
  return { batch, rows };
}
async function canonicalSnapshot(database: D1Database) {
  const before = await database.prepare("SELECT version FROM temp_catalog_versions WHERE id=1").first<{ version: number }>();
  const places = (await database.prepare("SELECT id,name,address,status,latitude,longitude FROM places LIMIT 10001").all<CanonicalRow>()).results;
  const after = await database.prepare("SELECT version FROM temp_catalog_versions WHERE id=1").first<{ version: number }>();
  if (!before || before.version !== after?.version || places.length > 10000) throw new Error("TEMP_CANONICAL_CONFLICT");
  return { version: before.version, places };
}
function verifyCanonicalReferences(rows: EntryRow[], canonical: CanonicalRow[]) {
  for (const row of rows) {
    const entry = tempEntrySchema.parse(JSON.parse(row.payload_json));
    const matches = canonical.filter((p) => identityKey(p) === identityKey(entry));
    if (row.place_id ? matches.length !== 1 || matches[0].id !== row.place_id || matches[0].status !== "PUBLISHED" : matches.length !== 0) throw new Error("TEMP_CANONICAL_CONFLICT");
  }
}
export async function stageTempCatalog(database: D1Database, input: { actorUserId: string; manifest: unknown; now: string }) {
  await assertAdmin(database, input.actorUserId);
  if (!nowValid(input.now)) throw new Error("TEMP_DATE_INVALID");
  const manifest = tempManifestSchema.parse(input.manifest);
  if (manifest.entries.some((e) => Date.parse(e.checkedAt) > Date.parse(input.now))) throw new Error("TEMP_DATE_INVALID");
  const manifestHash = await sha256(JSON.stringify(manifest));
  const batchId = `temp100-${manifestHash.slice(0, 16)}`;
  const existing = await database.prepare("SELECT id FROM temp_catalog_batches WHERE manifest_hash=?").bind(manifestHash).first();
  if (existing) return { batchId, replayed: true, count: 100 };
  const canonical = (await canonicalSnapshot(database)).places;
  const matches = new Map<string, typeof canonical>();
  for (const place of canonical) { const key = identityKey(place); matches.set(key, [...(matches.get(key) ?? []), place]); }
  const statements = [database.prepare("INSERT INTO temp_catalog_batches(id,source_hash,manifest_hash,status,created_at,updated_at) VALUES(?,?,?,'STAGED',?,?)").bind(batchId, manifest.sourceHash, manifestHash, input.now, input.now)];
  let reused = 0;
  for (const entry of manifest.entries) {
    const candidates = matches.get(identityKey(entry)) ?? [];
    if (candidates.length > 1 || candidates.some((p) => p.status !== "PUBLISHED" || !verifiedCoordinates(p.latitude, p.longitude))) throw new Error(`TEMP_CANONICAL_CONFLICT:${entry.sourceId}`);
    const place = candidates[0];
    if (place) reused++;
    statements.push(database.prepare("INSERT INTO temp_catalog_entries(id,batch_id,source_id,place_id,owns_place,payload_json,latitude,longitude,geo_status,created_at,updated_at) VALUES(?,?,?,?,0,?,?,?,?,?,?)")
      .bind(`${batchId}-${entry.sourceId}`, batchId, entry.sourceId, place?.id ?? null, JSON.stringify(entry), place?.latitude ?? null, place?.longitude ?? null, place ? "MATCHED" : "PENDING", input.now, input.now));
  }
  statements.push(database.prepare("INSERT INTO admin_audit_logs(id,actor_user_id,action,target_type,target_id,after_state,created_at) VALUES(?,?,'TEMP_CATALOG_STAGED','TEMP_BATCH',?,?,?)")
    .bind(crypto.randomUUID(), input.actorUserId, batchId, JSON.stringify({ count: 100, reused, photos: 23 }), input.now));
  await database.batch(statements);
  return { batchId, count: 100, reused, replayed: false };
}

/** One request, one provider lookup; a failed/ambiguous row stops the batch. No retries. */
export async function geocodeNextTempEntry(database: D1Database, input: { batchId: string; actorUserId: string; now: string; adapter: NaverLocalSearchAdapter }) {
  await assertAdmin(database, input.actorUserId);
  const { batch, rows } = await batchRows(database, input.batchId);
  if (batch.status !== "STAGED" || rows.some((r) => r.geo_status === "FAILED" || r.geo_status === "CLAIMED")) throw new Error("TEMP_GEOCODE_STOPPED");
  const row = rows.find((r) => r.geo_status === "PENDING");
  if (!row) return { complete: true, matched: 100 };
  const entry = tempEntrySchema.parse(JSON.parse(row.payload_json));
  const regionCode = entry.region.startsWith("광주") ? "GWANGJU" as const : "JEONNAM" as const;
  const db = createDb(database);
  if (!input.adapter.accounted) assertNaverRegionQuota({ regionCode, used: await getNaverLocalSearchApiCallsToday(db, input.now, regionCode) });
  const claimed = await database.prepare("UPDATE temp_catalog_entries SET geo_status='CLAIMED',updated_at=? WHERE id=? AND geo_status='PENDING' RETURNING id").bind(input.now, row.id).first();
  if (!claimed) throw new Error("TEMP_GEOCODE_CONFLICT");
  const runId = crypto.randomUUID();
  await db.insert(naverLocalCategoryRuns).values({ id: runId, mode: "PREVIEW", scope: "PENDING", status: "RUNNING", requestedLimit: 1, apiCallCount: 0, regionCode, startedAt: input.now, createdBy: input.actorUserId });
  try {
    const hits = (await input.adapter.search({ businessName: entry.name, address: entry.address, regionCode }, { source: "TEMP_GEOCODE", runId })).filter((hit) => identityKey(hit) === identityKey(entry) && verifiedCoordinates(hit.latitude, hit.longitude));
    if (hits.length !== 1) throw new Error("TEMP_GEOCODE_EXACT_MATCH_REQUIRED");
    const hit = hits[0];
    const calls = input.adapter.accounted ? await countNaverDispatches(database, runId) : 1;
    await database.batch([
      database.prepare("UPDATE temp_catalog_entries SET latitude=?,longitude=?,geo_status='MATCHED',geo_code='NAVER_EXACT_NAME_ADDRESS',updated_at=? WHERE id=? AND geo_status='CLAIMED'").bind(hit.latitude, hit.longitude, input.now, row.id),
      database.prepare("UPDATE temp_catalog_batches SET version=version+1,updated_at=? WHERE id=? AND status='STAGED'").bind(input.now, batch.id),
      database.prepare("UPDATE naver_local_category_runs SET status='COMPLETED',scanned_count=1,verified_count=1,api_call_count=?,finished_at=? WHERE id=?").bind(calls, input.now, runId),
      database.prepare("INSERT INTO admin_audit_logs(id,actor_user_id,action,target_type,target_id,after_state,created_at) VALUES(?,?,'TEMP_COORDINATE_MATCH','TEMP_ENTRY',?,?,?)").bind(crypto.randomUUID(), input.actorUserId, row.id, JSON.stringify({ code: "NAVER_EXACT_NAME_ADDRESS" }), input.now),
    ]);
    return { complete: false, matched: rows.filter((r) => r.geo_status === "MATCHED").length + 1, sourceId: entry.sourceId };
  } catch (error) {
    const code = error instanceof Error && "code" in error ? String(error.code) : "TEMP_GEOCODE_EXACT_MATCH_REQUIRED";
    const calls = input.adapter.accounted ? await countNaverDispatches(database, runId) : 1;
    const waiting = calls === 0 && ["NAVER_LOCAL_SEARCH_QUOTA", "NAVER_LOCAL_SEARCH_DISABLED", "NAVER_ACCOUNTING_UNAVAILABLE"].includes(code);
    await database.batch([
      database.prepare("UPDATE temp_catalog_entries SET geo_status=?,geo_code=?,updated_at=? WHERE id=? AND geo_status='CLAIMED' AND updated_at=?").bind(waiting ? "PENDING" : "FAILED", code, input.now, row.id, input.now),
      database.prepare("UPDATE temp_catalog_batches SET version=version+1,updated_at=? WHERE id=?").bind(input.now, batch.id),
      database.prepare("UPDATE naver_local_category_runs SET status='FAILED',failed_count=?,api_call_count=?,error_code=?,finished_at=? WHERE id=?").bind(waiting ? 0 : 1, calls, code, input.now, runId),
    ]);
    throw new Error(code);
  }
}

export async function tempCatalogStatus(database: D1Database, batchId: string) {
  const { batch, rows } = await batchRows(database, batchId);
  return { ...batch, count: rows.length, matched: rows.filter((r) => r.geo_status === "MATCHED").length,
    failed: rows.filter((r) => ["FAILED", "CLAIMED"].includes(r.geo_status)).map((r) => r.source_id),
    pending: rows.filter((r) => r.geo_status === "PENDING").length, reused: rows.filter((r) => r.place_id && !r.owns_place).length };
}

/** Explicit administrator confirmation of coordinates from the same official source.
 * The evidence is supplied by the reviewed offline collector, not inferred from map centres. */
export async function confirmTempCoordinateEvidence(database: D1Database, input: { actorUserId: string; batchId: string; evidence: unknown; now: string }) {
  await assertAdmin(database, input.actorUserId);
  const proof = coordinateEvidenceSchema.parse(input.evidence);
  const { batch, rows } = await batchRows(database, input.batchId);
  const row = rows.find((r) => r.source_id === proof.sourceId);
  if (batch.status !== "STAGED" || !row || row.place_id || row.geo_status === "CLAIMED" || Date.parse(proof.checkedAt) > Date.parse(input.now)) throw new Error("TEMP_COORDINATE_CONFLICT");
  if (row.geo_status === "MATCHED") {
    if (row.latitude === proof.latitude && row.longitude === proof.longitude) return { sourceId: row.source_id, code: "OFFICIAL_SOURCE_CONFIRMED" };
    throw new Error("TEMP_COORDINATE_CONFLICT");
  }
  const entry = tempEntrySchema.parse(JSON.parse(row.payload_json));
  if (identityKey(entry) !== identityKey(proof) || entry.sourceUrl !== proof.sourceUrl) throw new Error("TEMP_COORDINATE_SOURCE_MISMATCH");
  await database.batch([
    database.prepare("UPDATE temp_catalog_entries SET latitude=?,longitude=?,geo_status='MATCHED',geo_code='OFFICIAL_SOURCE_CONFIRMED',updated_at=? WHERE id=?").bind(proof.latitude, proof.longitude, input.now, row.id),
    database.prepare("UPDATE temp_catalog_batches SET version=version+1,updated_at=? WHERE id=?").bind(input.now, batch.id),
    database.prepare("INSERT INTO admin_audit_logs(id,actor_user_id,action,target_type,target_id,after_state,created_at) VALUES(?,?,'TEMP_COORDINATE_SOURCE_CONFIRMED','TEMP_ENTRY',?,?,?)")
      .bind(crypto.randomUUID(), input.actorUserId, row.id, JSON.stringify(proof), input.now),
  ]);
  return { sourceId: row.source_id, code: "OFFICIAL_SOURCE_CONFIRMED" };
}

async function assertPhotos(bucket: R2Bucket, rows: EntryRow[]) {
  let remainingBytes = 25 * 1024 * 1024;
  for (const row of rows) {
    const entry = tempEntrySchema.parse(JSON.parse(row.payload_json));
    const key = photoObjectKey(row.batch_id, entry);
    if (!key) continue;
    const bytes = await readVerifiedTempPhoto(bucket, { key, contentType: entry.photo!.contentType, sha256: entry.photo!.sha256 }, remainingBytes);
    remainingBytes -= bytes.byteLength;
  }
}

/** Content hash is authoritative; CLI uploads need no custom metadata. */
export async function readVerifiedTempPhoto(bucket: R2Bucket, photo: { key: string; contentType: string; sha256: string }, byteBudget = 8 * 1024 * 1024) {
  const extension = ({ "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" } as Record<string, string>)[photo.contentType];
  if (!Number.isSafeInteger(byteBudget) || byteBudget <= 0 || !extension || !/^(temp100|temp100-naver)\/temp100-[a-f0-9]{16}\/temp100-\d{3}-[a-f0-9]{64}\.(jpg|png|webp)$/.test(photo.key)
    || !photo.key.endsWith(`-${photo.sha256}.${extension}`)) throw new Error("TEMP_PHOTO_NOT_READY");
  const object = await bucket.get(photo.key);
  const limit = Math.min(8 * 1024 * 1024, byteBudget);
  if (!object) throw new Error("TEMP_PHOTO_NOT_READY");
  if (object.size <= 0 || object.size > limit || object.httpMetadata?.contentType !== photo.contentType) {
    await object.body.cancel();
    throw new Error("TEMP_PHOTO_NOT_READY");
  }
  const reader = object.body.getReader(), chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > limit) { await reader.cancel(); throw new Error("TEMP_PHOTO_NOT_READY"); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  if (length !== object.size) throw new Error("TEMP_PHOTO_NOT_READY");
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  const digest = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)), (byte) => byte.toString(16).padStart(2, "0")).join("");
  if (digest !== photo.sha256) throw new Error("TEMP_PHOTO_NOT_READY");
  return bytes;
}
export async function prepareTempPublication(database: D1Database, bucket: R2Bucket, input: { actorUserId: string; sessionId: string; batchId: string; now: string; publish: boolean }) {
  const { batch, rows } = await batchRows(database, input.batchId);
  const canonical = await canonicalSnapshot(database);
  if (input.publish) {
    if (batch.status !== "STAGED" || rows.some((r) => r.geo_status !== "MATCHED")) throw new Error("TEMP_NOT_READY");
    await assertPhotos(bucket, rows);
    verifyCanonicalReferences(rows, canonical.places);
  } else if (batch.status !== "PUBLISHED") throw new Error("TEMP_NOT_PUBLISHED");
  return prepareAdminOperation(database, { ...input, kind: input.publish ? "TEMP_PUBLISH" : "TEMP_UNPUBLISH", payload: { batchId: batch.id, version: batch.version, canonicalVersion: canonical.version }, summary: { title: input.publish ? "TEMP 100곳 베타 공개" : "TEMP 100곳 공개 회수", count: 100 } });
}
export async function commitTempPublication(database: D1Database, bucket: R2Bucket, input: AdminOperationInput) {
  if (!["TEMP_PUBLISH", "TEMP_UNPUBLISH"].includes(input.kind)) throw new Error("TEMP_OPERATION_INVALID");
  return commitAdminOperation(database, input, async (operation) => {
    const payload = operation.payload as { batchId: string; version: number; canonicalVersion: number };
    const { batch, rows } = await batchRows(database, payload.batchId);
    const publish = input.kind === "TEMP_PUBLISH";
    if (publish) await assertPhotos(bucket, rows);
    const checks = [database.prepare("INSERT INTO admin_operation_checks(operation_id,check_name,passed) VALUES(?,'TEMP_BATCH_VERSION',CASE WHEN EXISTS(SELECT 1 FROM temp_catalog_batches WHERE id=? AND version=? AND status=?) THEN 1 ELSE 0 END)")
      .bind(operation.id, batch.id, payload.version, publish ? "STAGED" : "PUBLISHED"),
      database.prepare("INSERT INTO admin_operation_checks(operation_id,check_name,passed) VALUES(?,'TEMP_CANONICAL_VERSION',CASE WHEN EXISTS(SELECT 1 FROM temp_catalog_versions WHERE id=1 AND version=?) THEN 1 ELSE 0 END)").bind(operation.id, payload.canonicalVersion)];
    const statements: D1PreparedStatement[] = [database.prepare("UPDATE temp_catalog_batches SET status=?,version=version+1,updated_at=? WHERE id=?").bind(publish ? "PUBLISHED" : "WITHDRAWN", input.now, batch.id)];
    for (const row of rows) {
      const entry = tempEntrySchema.parse(JSON.parse(row.payload_json));
      if (publish) {
        checks.push(database.prepare("INSERT INTO admin_operation_checks(operation_id,check_name,passed) VALUES(?,?,CASE WHEN EXISTS(SELECT 1 FROM temp_catalog_entries WHERE id=? AND geo_status='MATCHED' AND latitude IS NOT NULL AND longitude IS NOT NULL) THEN 1 ELSE 0 END)").bind(operation.id, row.source_id, row.id));
        if (row.place_id) {
          const existing = await database.prepare("SELECT name,address FROM places WHERE id=? AND status='PUBLISHED'").bind(row.place_id).first<{ name: string; address: string }>();
          if (!existing || identityKey(existing) !== identityKey(entry)) throw new Error("TEMP_CANONICAL_CONFLICT");
          checks.push(database.prepare("INSERT INTO admin_operation_checks(operation_id,check_name,passed) VALUES(?,?,CASE WHEN EXISTS(SELECT 1 FROM places WHERE id=? AND status='PUBLISHED' AND name=? AND address=?) THEN 1 ELSE 0 END)").bind(operation.id, `existing-${row.source_id}`, row.place_id, existing.name, existing.address));
          continue;
        }
        const placeId = row.id, slug = row.id;
        // Recheck duplicate identity at the actual commit boundary; never upsert canonical data.
        checks.push(database.prepare("INSERT INTO admin_operation_checks(operation_id,check_name,passed) VALUES(?,?,CASE WHEN NOT EXISTS(SELECT 1 FROM places WHERE replace(replace(lower(name),' ',''),'　','')=? AND replace(replace(lower(address),' ',''),'　','')=?) AND EXISTS(SELECT 1 FROM categories WHERE slug=? AND is_active=1) THEN 1 ELSE 0 END)").bind(operation.id, `new-${row.source_id}`, entry.name.toLowerCase().replace(/[\s　]/g, ""), entry.address.toLowerCase().replace(/[\s　]/g, ""), categorySlug(entry)));
        statements.push(database.prepare("INSERT INTO places(id,slug,name,status,address,neighborhood,latitude,longitude,hero_image_url,search_text,created_at,updated_at) VALUES(?,?,?,'PUBLISHED',?,?,?,?,?,?,?,?)")
          .bind(placeId, slug, entry.name, entry.address, entry.region, row.latitude, row.longitude, entry.photo ? `/temp-photos/${row.id}` : null, `${entry.name} ${entry.address} ${entry.region} ${entry.cuisine} TEMP`, input.now, input.now));
        statements.push(database.prepare("INSERT INTO place_categories(place_id,category_id,is_primary) SELECT ?,id,1 FROM categories WHERE slug=? AND is_active=1").bind(placeId, categorySlug(entry)));
        statements.push(database.prepare("UPDATE temp_catalog_entries SET place_id=?,owns_place=1,updated_at=? WHERE id=?").bind(placeId, input.now, row.id));
      } else if (row.owns_place && row.place_id) {
        statements.push(database.prepare("UPDATE places SET status='HIDDEN',updated_at=? WHERE id=?").bind(input.now, row.place_id));
      }
    }
    return { checks, statements, result: { batchId: batch.id, count: 100, status: publish ? "PUBLISHED" : "WITHDRAWN", photos: 23, reused: rows.filter((r) => r.place_id && !r.owns_place).length } };
  });
}

export async function attachTempCatalog<T extends { id: string; heroImageUrl?: string | null }>(db: AppDb, places: T[]): Promise<Array<T & { tempCatalog?: TempPublicInfo }>> {
  if (!places.length) return places;
  const rows = await db.select({ id: tempCatalogEntries.id, placeId: tempCatalogEntries.placeId, payload: tempCatalogEntries.payloadJson,
    supplement: tempPhotoSupplements.payloadJson, supplementStatus: tempPhotoSupplementBatches.status })
    .from(tempCatalogEntries).innerJoin(tempCatalogBatches, eq(tempCatalogEntries.batchId, tempCatalogBatches.id))
    .innerJoin(canonicalPlaces, and(eq(canonicalPlaces.id, tempCatalogEntries.placeId), eq(canonicalPlaces.status, "PUBLISHED")))
    .leftJoin(tempPhotoSupplements, eq(tempPhotoSupplements.entryId, tempCatalogEntries.id))
    .leftJoin(tempPhotoSupplementBatches, and(eq(tempPhotoSupplementBatches.id, tempPhotoSupplements.supplementBatchId), eq(tempPhotoSupplementBatches.targetBatchId, tempCatalogEntries.batchId)))
    .where(and(sql`${tempCatalogEntries.placeId} in (select value from json_each(${JSON.stringify(places.map((p) => p.id))}))`, eq(tempCatalogBatches.status, "PUBLISHED")));
  const byId = new Map(rows.map((row) => {
    const entry = tempEntrySchema.parse(JSON.parse(row.payload));
    const photoSupplement = !entry.photo && row.supplement && row.supplementStatus === "ACTIVE" ? tempPhotoSupplementEntrySchema.parse(JSON.parse(row.supplement)) : undefined;
    return [row.placeId, { ...entry, entryId: row.id, photoUrl: entry.photo || photoSupplement ? `/temp-photos/${row.id}` : null, ...(photoSupplement ? { photoSupplement } : {}) }];
  }));
  return places.map((place) => {
    const tempCatalog = byId.get(place.id);
    return tempCatalog ? { ...place, ...(tempCatalog.photoSupplement && !place.heroImageUrl ? { heroImageUrl: tempCatalog.photoUrl } : {}), tempCatalog } : place;
  });
}
export async function getTempPhoto(database: D1Database, entryId: string) {
  if (!/^temp100-[a-f0-9]{16}-temp100-\d{3}$/.test(entryId)) return null;
  const row = await database.prepare("SELECT e.* FROM temp_catalog_entries e JOIN temp_catalog_batches b ON b.id=e.batch_id JOIN places p ON p.id=e.place_id WHERE e.id=? AND b.status='PUBLISHED' AND p.status='PUBLISHED'").bind(entryId).first<EntryRow>();
  if (!row) return null;
  const entry = tempEntrySchema.parse(JSON.parse(row.payload_json));
  const key = photoObjectKey(row.batch_id, entry);
  if (key && entry.photo) return { key, contentType: entry.photo.contentType, sha256: entry.photo.sha256 };
  const supplemental = await database.prepare("SELECT s.payload_json,s.object_key FROM temp_photo_supplements s JOIN temp_photo_supplement_batches b ON b.id=s.supplement_batch_id WHERE s.entry_id=? AND b.target_batch_id=? AND b.status='ACTIVE'").bind(row.id, row.batch_id).first<{ payload_json: string; object_key: string }>();
  if (!supplemental) return null;
  const photo = tempPhotoSupplementEntrySchema.parse(JSON.parse(supplemental.payload_json));
  if (photo.sourceId !== entry.sourceId || photo.name !== entry.name || photo.address !== entry.address || supplemental.object_key !== supplementalPhotoKey(row.batch_id, photo)) return null;
  return { key: supplemental.object_key, contentType: photo.contentType, sha256: photo.sha256 };
}
