import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { createDb } from "../../app/db/client.server";
import { getPlaceBySlug, listPlaces } from "../../app/features/places/place.server";
import { commitTempPublication, confirmTempCoordinateEvidence, geocodeNextTempEntry, getTempPhoto, prepareTempPublication, stageTempCatalog, tempCatalogStatus } from "../../app/features/temp-catalog/temp-catalog.server";
import { photoObjectKey, TEMP_SOURCE_HASH, type TempManifest } from "../../app/features/temp-catalog/temp-catalog";
import { buildTemp100PublicationSql } from "../../scripts/temp100-publication-sql.mjs";
import { loader as tempAdminLoader } from "../../app/routes/admin-temp-catalog";

const now = "2026-11-14T01:00:00.000Z";
async function fixture() {
  const key = crypto.randomUUID(), actorUserId = `admin-${key}`, sessionId = `session-${key}`;
  await env.DB.prepare("INSERT INTO users(id,email,display_name,role,created_at,updated_at) VALUES(?,?,?,'ADMIN',?,?)").bind(actorUserId, `${key}@example.com`, "합성 관리자", now, now).run();
  await env.DB.prepare("INSERT INTO sessions(id,user_id,expires_at,created_at) VALUES(?,?,?,?)").bind(sessionId, actorUserId, "2026-11-15T01:00:00.000Z", now).run();
  const manifest: TempManifest = { schemaVersion: 1, sourceHash: TEMP_SOURCE_HASH, entries: Array.from({ length: 100 }, (_, i) => ({
    sourceId: `temp100-${String(i + 1).padStart(3, "0")}`, name: `합성 ${key} 식당 ${i}`, address: `광주 동구 합성길 ${i}`, region: "광주 동구", cuisine: "한식", summary: "합성 테스트용 독자 설명이며 실제 업소가 아닙니다.", sourceUrl: `https://tour.gwangju.go.kr/example?id=${i}`, sourceTitle: "공식 소개", checkedAt: now,
    evaluation: { kind: "OFFICIAL_CURATION", provider: "공식 관광", sourceUrl: `https://tour.gwangju.go.kr/example?id=${i}` },
    photo: i < 23 ? { sha256: "a".repeat(64), contentType: "image/jpeg", licenseType: "KOGL-1", licenseUrl: "https://www.kogl.or.kr/info/license.do", attribution: "합성 사진 저작자", creator: "합성", evidenceUrl: `https://www.yeosu.go.kr/example?id=${i}` } : null,
  })) };
  return { actorUserId, sessionId, manifest };
}
describe("TEMP catalog publication", () => {
  it("applies an explicitly bounded operator SQL atomically and removes its one-time trigger", async () => {
    const input = await fixture();
    const staged = await stageTempCatalog(env.DB, { ...input, now });
    await env.DB.prepare("UPDATE temp_catalog_entries SET latitude=35.1,longitude=126.9,geo_status='MATCHED' WHERE batch_id=?").bind(staged.batchId).run();
    const makePlan = async () => buildTemp100PublicationSql({ manifest: input.manifest, operatorId: input.actorUserId, now, snapshot: {
      canonicalVersion: (await env.DB.prepare("SELECT version FROM temp_catalog_versions WHERE id=1").first<{version:number}>())!.version,
      batch: await env.DB.prepare("SELECT * FROM temp_catalog_batches WHERE id=?").bind(staged.batchId).first(),
      entries: (await env.DB.prepare("SELECT * FROM temp_catalog_entries WHERE batch_id=?").bind(staged.batchId).all()).results,
      places: [], photos: input.manifest.entries.filter((e) => e.photo).map((e) => ({ key: photoObjectKey(staged.batchId, e), sha256: e.photo!.sha256, contentType: e.photo!.contentType })),
    } });
    let plan = await makePlan();
    expect(new TextEncoder().encode(plan.installSql).length).toBeLessThan(100_000);
    await env.DB.prepare(plan.installSql).run();
    await env.DB.prepare("UPDATE temp_catalog_batches SET version=version+1 WHERE id=?").bind(staged.batchId).run();
    try {
      await expect(env.DB.prepare(plan.applySql).run()).rejects.toThrow("TEMP_OPERATOR_CONFLICT");
      expect(await env.DB.prepare("SELECT id FROM admin_audit_logs WHERE id=?").bind(plan.marker).first()).toBeNull();
      expect(await env.DB.prepare("SELECT id FROM places WHERE id=?").bind(`${staged.batchId}-temp100-001`).first()).toBeNull();
    } finally { await env.DB.prepare(plan.cleanupSql).run(); }
    plan = await makePlan();
    await env.DB.prepare(plan.installSql).run();
    try {
      await env.DB.prepare(plan.applySql).run();
      await env.DB.prepare(plan.applySql).run();
      expect((await listPlaces(createDb(env.DB), { tempOnly: true, query: input.manifest.entries[0].name.split(" 식당 ")[0] })).length).toBe(100);
      expect(await env.DB.prepare("SELECT count(*) AS total FROM admin_audit_logs WHERE id=?").bind(plan.marker).first()).toEqual({ total: 1 });
    } finally { await env.DB.prepare(plan.cleanupSql).run(); }
    expect(await env.DB.prepare("SELECT name FROM sqlite_master WHERE type='trigger' AND name=?").bind(plan.trigger).first()).toBeNull();
  });
  it("stops at ambiguous coordinates without publishing or retrying", async () => {
    const input = await fixture();
    const staged = await stageTempCatalog(env.DB, { ...input, now });
    await expect(geocodeNextTempEntry(env.DB, { ...input, batchId: staged.batchId, now, adapter: { search: async () => [] } })).rejects.toThrow("TEMP_GEOCODE_EXACT_MATCH_REQUIRED");
    let requests = 0;
    await expect(geocodeNextTempEntry(env.DB, { ...input, batchId: staged.batchId, now, adapter: { search: async () => { requests++; return []; } } })).rejects.toThrow("TEMP_GEOCODE_STOPPED");
    expect(requests).toBe(0);
    expect((await tempCatalogStatus(env.DB, staged.batchId)).failed).toHaveLength(1);
    expect(await getTempPhoto(env.DB, `${staged.batchId}-temp100-001`)).toBeNull();
    const entry = input.manifest.entries[0];
    const evidence = { sourceId: entry.sourceId, name: entry.name, address: entry.address, latitude: 35.1, longitude: 126.9, sourceUrl: entry.sourceUrl, sourceSha256: "b".repeat(64), checkedAt: now };
    await expect(confirmTempCoordinateEvidence(env.DB, { ...input, batchId: staged.batchId, evidence: { ...evidence, sourceUrl: "https://tour.gwangju.go.kr/unrelated" }, now })).rejects.toThrow("TEMP_COORDINATE_SOURCE_MISMATCH");
    await confirmTempCoordinateEvidence(env.DB, { ...input, batchId: staged.batchId, evidence, now });
    expect((await tempCatalogStatus(env.DB, staged.batchId)).failed).toHaveLength(0);
  });
  it("publishes 100 through the session-bound contract, preserves canonical records and withdraws only new places", async () => {
    const input = await fixture();
    const first = input.manifest.entries[0], canonicalId = crypto.randomUUID();
    await env.DB.prepare("INSERT INTO places(id,slug,name,status,address,neighborhood,latitude,longitude,search_text,created_at,updated_at) VALUES(?,?,?,'PUBLISHED',?,'기존',35.1,126.9,?,?,?)").bind(canonicalId, canonicalId, first.name, first.address, first.name, now, now).run();
    await env.DB.prepare("INSERT INTO place_categories(place_id,category_id,is_primary) VALUES(?,'cat-korean-general',1)").bind(canonicalId).run();
    const staged = await stageTempCatalog(env.DB, { ...input, now });
    expect(staged.reused).toBe(1);
    expect((await stageTempCatalog(env.DB, { ...input, now })).replayed).toBe(true);
    const second = input.manifest.entries[1];
    await geocodeNextTempEntry(env.DB, { ...input, batchId: staged.batchId, now, adapter: { search: async () => [{ name: second.name, address: second.address, category: "음식점", latitude: 35.1, longitude: 126.9 }] } });
    // Remaining coordinates are synthetic fixtures, never source data or a live repair.
    await env.DB.prepare("UPDATE temp_catalog_entries SET latitude=35.1,longitude=126.9,geo_status='MATCHED' WHERE batch_id=?").bind(staged.batchId).run();
    for (const entry of input.manifest.entries.filter((e) => e.photo)) await env.REVIEW_PHOTOS.put(photoObjectKey(staged.batchId, entry)!, "synthetic image", { customMetadata: { sha256: entry.photo!.sha256 }, httpMetadata: { contentType: entry.photo!.contentType } });
    const preview = await prepareTempPublication(env.DB, env.REVIEW_PHOTOS, { ...input, batchId: staged.batchId, now, publish: true });
    const commitInput = { ...input, now, operationId: preview.operationId, kind: "TEMP_PUBLISH" as const };
    await expect(commitTempPublication(env.DB, env.REVIEW_PHOTOS, commitInput)).rejects.toThrow("ADMIN_RECENT_AUTH_REQUIRED");
    await env.DB.prepare("INSERT INTO admin_session_assurances(session_id,actor_user_id,method,verified_at,expires_at) VALUES(?,?,'PASSWORD',?,?)").bind(input.sessionId, input.actorUserId, now, "2026-11-14T01:09:00.000Z").run();
    await env.DB.prepare("UPDATE places SET name=name||' (본점)' WHERE id=?").bind(canonicalId).run();
    await expect(commitTempPublication(env.DB, env.REVIEW_PHOTOS, commitInput)).rejects.toThrow("ADMIN_OPERATION_CONFLICT");
    const refreshed = await prepareTempPublication(env.DB, env.REVIEW_PHOTOS, { ...input, batchId: staged.batchId, now, publish: true });
    commitInput.operationId = refreshed.operationId;
    await commitTempPublication(env.DB, env.REVIEW_PHOTOS, commitInput);
    expect((await commitTempPublication(env.DB, env.REVIEW_PHOTOS, commitInput)).replayed).toBe(true);
    const resumed = await tempAdminLoader({ request: new Request(`https://example.com/admin/temp-catalog?batch=${staged.batchId}&operation=${commitInput.operationId}&operationKind=TEMP_PUBLISH`, { headers: { Cookie: `retaste_session=${input.sessionId}` } }) } as never);
    expect(resumed.operationKind).toBe("TEMP_PUBLISH");
    expect(resumed.operation?.status).toBe("COMMITTED");
    const otherBatch = await env.DB.prepare("SELECT id FROM temp_catalog_batches WHERE id<>? LIMIT 1").bind(staged.batchId).first<{id:string}>();
    const unrelated = await tempAdminLoader({ request: new Request(`https://example.com/admin/temp-catalog?batch=${otherBatch!.id}&operation=${commitInput.operationId}&operationKind=TEMP_PUBLISH`, { headers: { Cookie: `retaste_session=${input.sessionId}` } }) } as never);
    expect(unrelated.operationId).toBeNull();
    const list = await listPlaces(createDb(env.DB), { tempOnly: true, query: first.name.split(" 식당 ")[0] });
    expect(list).toHaveLength(100);
    expect(list.every((p) => p.positive === 0 && p.negative === 0 && p.tempCatalog)).toBe(true);
    expect((await getPlaceBySlug(createDb(env.DB), `${staged.batchId}-temp100-002`)).tempCatalog?.photoUrl).toBeTruthy();
    expect(await getTempPhoto(env.DB, `${staged.batchId}-temp100-001`)).toMatchObject({ contentType: "image/jpeg" });
    const withdraw = await prepareTempPublication(env.DB, env.REVIEW_PHOTOS, { ...input, batchId: staged.batchId, now, publish: false });
    await commitTempPublication(env.DB, env.REVIEW_PHOTOS, { ...input, now, operationId: withdraw.operationId, kind: "TEMP_UNPUBLISH" });
    expect((await listPlaces(createDb(env.DB), { tempOnly: true, query: first.name.split(" 식당 ")[0] })).length).toBe(0);
    expect(await env.DB.prepare("SELECT status,neighborhood FROM places WHERE id=?").bind(canonicalId).first()).toEqual({ status: "PUBLISHED", neighborhood: "기존" });
    expect(await getTempPhoto(env.DB, `${staged.batchId}-temp100-001`)).toBeNull();
    await expect(env.DB.prepare("UPDATE places SET status='PUBLISHED' WHERE id=?").bind(`${staged.batchId}-temp100-002`).run()).rejects.toThrow("TEMP_BATCH_NOT_PUBLISHED");
  });
});
