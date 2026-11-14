import { env } from "cloudflare:workers";
import { expect, it } from "vitest";
import { createDb } from "../../app/db/client.server";
import { getPlaceBySlug } from "../../app/features/places/place.server";
import { sha256 } from "../../app/features/temp-catalog/temp-catalog.server";
import { TEMP_PHOTO_TARGET_BATCH, supplementalPhotoKey, type TempPhotoSupplementManifest } from "../../app/features/temp-catalog/temp-photo-supplement";
import { buildTempPhotoSupplementSql } from "../../scripts/temp-photo-supplement-sql.mjs";
import { loader as photoLoader } from "../../app/routes/temp-photo";

it("atomically supplements only 77 empty photos and withdraws without changing canonical data", async () => {
  const now = "2026-11-14T03:00:00.000Z", target = TEMP_PHOTO_TARGET_BATCH, admin = `admin-${crypto.randomUUID()}`;
  const hash = await sha256("synthetic supplement bytes");
  await env.DB.prepare("INSERT INTO users(id,email,display_name,role,created_at,updated_at) VALUES(?,?,?,'ADMIN',?,?)").bind(admin, `${admin}@example.test`, "합성 관리자", now, now).run();
  await env.DB.prepare("INSERT INTO temp_catalog_batches(id,source_hash,manifest_hash,status,created_at,updated_at) VALUES(?,?,?,'PUBLISHED',?,?)").bind(target, "a".repeat(64), "b".repeat(64), now, now).run();
  const supplements: TempPhotoSupplementManifest["entries"] = [];
  for (let i = 1; i <= 100; i++) {
    const sourceId = `temp100-${String(i).padStart(3, "0")}`, id = `${target}-${sourceId}`, name = `합성 식당 ${i}`, address = `광주 합성로 ${i}`;
    const photo = i <= 23 ? { sha256: hash, contentType: "image/jpeg", licenseType: "KOGL-1", licenseUrl: "https://www.kogl.or.kr/info/license.do", attribution: "기존 사진", creator: "합성", evidenceUrl: "https://www.yeosu.go.kr/example" } : null;
    const payload = JSON.stringify({ sourceId, name, address, region: "광주", cuisine: "한식", summary: "실제 업소가 아닌 합성 테스트 자료입니다.", sourceUrl: "https://tour.gwangju.go.kr/example", sourceTitle: "공식 합성", checkedAt: now, evaluation: { kind: "OFFICIAL_CURATION", provider: "합성", sourceUrl: "https://tour.gwangju.go.kr/example" }, photo });
    await env.DB.prepare("INSERT INTO places(id,slug,name,status,address,neighborhood,latitude,longitude,hero_image_url,search_text,created_at,updated_at) VALUES(?,?,?,'PUBLISHED',?,'합성',35.1,126.9,?,?,?,?)").bind(id, id, name, address, i <= 23 ? "/original.jpg" : null, name, now, now).run();
    await env.DB.prepare("INSERT INTO place_categories(place_id,category_id,is_primary) VALUES(?,'cat-korean-general',1)").bind(id).run();
    await env.DB.prepare("INSERT INTO temp_catalog_entries(id,batch_id,source_id,place_id,owns_place,payload_json,latitude,longitude,geo_status,created_at,updated_at) VALUES(?,?,?,?,1,?,35.1,126.9,'MATCHED',?,?)").bind(id, target, sourceId, id, payload, now, now).run();
    if (!photo) supplements.push({ sourceId, name, address, sourcePageUrl: `https://m.place.naver.com/restaurant/${i}/photo`, imageUrl: `https://ldb-phinf.pstatic.net/${i}.jpg`, sha256: hash, contentType: "image/jpeg", checkedAt: now, rightsStatus: "UNVERIFIED", attribution: "NAVER 공개 합성 사진" });
  }
  const manifest: TempPhotoSupplementManifest = { schemaVersion: 1, targetBatchId: target, entries: supplements };
  const before = await env.DB.prepare("SELECT payload_json FROM temp_catalog_entries ORDER BY id").all();
  const canonicalBefore = await env.DB.prepare("SELECT id,name,status,address,hero_image_url FROM places ORDER BY id").all();
  const photos = manifest.entries.map((entry) => ({ key: supplementalPhotoKey(target, entry), sha256: hash, contentType: entry.contentType, size: 26 }));
  const snapshot = {
    targetBatch: (await env.DB.prepare("SELECT * FROM temp_catalog_batches WHERE id=?").bind(target).first())!,
    canonicalVersion: (await env.DB.prepare("SELECT version FROM temp_catalog_versions WHERE id=1").first<{ version: number }>())!.version,
    entries: (await env.DB.prepare("SELECT * FROM temp_catalog_entries WHERE batch_id=?").bind(target).all()).results,
    photos,
  };
  const plan = buildTempPhotoSupplementSql({ manifest, snapshot, operatorId: admin, now });
  expect(() => buildTempPhotoSupplementSql({ manifest: { ...manifest, entries: manifest.entries.slice(1) }, snapshot, operatorId: admin, now })).toThrow();
  expect(() => buildTempPhotoSupplementSql({ manifest: { ...manifest, entries: [{ ...manifest.entries[0], sourceId: "temp100-001" }, ...manifest.entries.slice(1)] }, snapshot, operatorId: admin, now })).toThrow("TEMP_PHOTO_TARGET_INVALID");
  const firstId = `${target}-temp100-024`;
  await env.DB.prepare("UPDATE places SET updated_at=? WHERE id=?").bind(now, firstId).run();
  await expect(env.DB.prepare(plan.sql).run()).rejects.toThrow("TEMP_PHOTO_VERSION_CONFLICT");
  expect(await env.DB.prepare("SELECT count(*) count FROM temp_photo_supplements").first()).toEqual({ count: 0 });
  snapshot.canonicalVersion = (await env.DB.prepare("SELECT version FROM temp_catalog_versions WHERE id=1").first<{ version: number }>())!.version;
  const fresh = buildTempPhotoSupplementSql({ manifest, snapshot, operatorId: admin, now });
  await expect(env.DB.prepare(fresh.sql.replace('"rightsStatus":"UNVERIFIED"', '"rightsStatus":"PERMITTED"')).run()).rejects.toThrow("TEMP_PHOTO_TARGET_INVALID");
  expect(await env.DB.prepare("SELECT count(*) count FROM admin_audit_logs WHERE action='TEMP_PHOTO_SUPPLEMENT_APPLIED'").first()).toEqual({ count: 0 });
  await env.DB.prepare(fresh.sql).run();
  await env.DB.prepare(fresh.sql).run();
  const replacement = buildTempPhotoSupplementSql({ manifest: { ...manifest, entries: manifest.entries.map((entry, i) => i ? entry : { ...entry, attribution: "수정 시도" }) }, snapshot, operatorId: admin, now });
  await expect(env.DB.prepare(replacement.sql).run()).rejects.toThrow("UNIQUE constraint failed");
  expect(await env.DB.prepare("SELECT count(*) count FROM temp_photo_supplements").first()).toEqual({ count: 77 });
  expect(await env.DB.prepare("SELECT count(*) count FROM admin_audit_logs WHERE action='TEMP_PHOTO_SUPPLEMENT_APPLIED'").first()).toEqual({ count: 1 });
  expect((await env.DB.prepare("SELECT payload_json FROM temp_catalog_entries ORDER BY id").all()).results).toEqual(before.results);
  expect((await env.DB.prepare("SELECT id,name,status,address,hero_image_url FROM places ORDER BY id").all()).results).toEqual(canonicalBefore.results);
  const place = await getPlaceBySlug(createDb(env.DB), firstId);
  expect(place.heroImageUrl).toBe(`/temp-photos/${firstId}`);
  expect(place.tempCatalog?.photoSupplement?.rightsStatus).toBe("UNVERIFIED");
  expect((await getPlaceBySlug(createDb(env.DB), `${target}-temp100-001`)).heroImageUrl).toBe("/original.jpg");
  const firstPhoto = manifest.entries[0];
  await env.REVIEW_PHOTOS.put(supplementalPhotoKey(target, firstPhoto), "synthetic supplement bytes", { httpMetadata: { contentType: "image/jpeg" } });
  const request = { request: new Request("https://example.test/photo"), params: { entryId: firstId } } as never;
  expect((await photoLoader(request)).status).toBe(200);
  await env.DB.prepare("UPDATE places SET status='HIDDEN' WHERE id=?").bind(firstId).run();
  expect((await photoLoader(request)).status).toBe(404);
  await env.DB.prepare("UPDATE places SET status='PUBLISHED' WHERE id=?").bind(firstId).run();
  const withdraw = buildTempPhotoSupplementSql({ manifest, snapshot: { ...snapshot, supplementBatch: await env.DB.prepare("SELECT * FROM temp_photo_supplement_batches WHERE id=?").bind(fresh.id).first() }, operatorId: admin, now, action: "withdraw" });
  await env.DB.prepare(withdraw.sql).run();
  await env.DB.prepare(withdraw.sql).run();
  await env.DB.prepare(fresh.sql).run();
  expect((await photoLoader(request)).status).toBe(404);
  expect((await getPlaceBySlug(createDb(env.DB), firstId)).heroImageUrl).toBeNull();
  expect(await env.DB.prepare("SELECT count(*) count FROM admin_audit_logs WHERE action='TEMP_PHOTO_SUPPLEMENT_WITHDRAWN'").first()).toEqual({ count: 1 });
  await expect(env.DB.prepare("UPDATE temp_photo_supplements SET payload_json='{}' WHERE entry_id=?").bind(firstId).run()).rejects.toThrow("TEMP_PHOTO_IMMUTABLE");
});
