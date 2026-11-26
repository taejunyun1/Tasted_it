import { env } from "cloudflare:workers";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createDb } from "../../app/db/client.server";
import { grantAdminAssurance } from "../../app/features/auth/admin-assurance.server";
import { getPoiMediaObjectKey } from "../../app/features/poi-media/poi-media";
import {
  applyPoiMediaAdminTransition, getAdminPoiMedia, readAdminPoiMediaPreview,
} from "../../app/features/poi-media/poi-media-admin.server";
import { getPublishedPoiMedia } from "../../app/features/poi-media/poi-media.server";

const db = createDb(env.DB);
const bucket = env.REVIEW_PHOTOS;
const jpeg = new Uint8Array([0xff, 0xd8, 0x01, 0x02, 0xff, 0xd9]);
const alteredJpeg = new Uint8Array([0xff, 0xd8, 0x03, 0x04, 0xff, 0xd9]);
const rightsEvidence = "internal-approval-reference";
const placeName = "합성 카페";
const placeAddress = "광주광역시 동구 합성로 1";
const reviewedAt = "2026-11-26T02:00:00.000Z";

async function stagePhoto() {
  const id = crypto.randomUUID();
  const actorUserId = `poi-admin-${id}`;
  const sessionId = `poi-session-${id}`;
  const placeId = `poi-place-${id}`;
  const categoryId = `poi-category-${id}`;
  const now = new Date();
  const expires = new Date(now.getTime() + 86_400_000).toISOString();
  const sha256 = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", jpeg)),
    (byte) => byte.toString(16).padStart(2, "0")).join("");
  await env.DB.batch([
    env.DB.prepare("INSERT INTO users (id,email,display_name,role,created_at,updated_at) VALUES (?,?,?,'ADMIN',?,?)")
      .bind(actorUserId, `${actorUserId}@example.com`, "합성 관리자", reviewedAt, reviewedAt),
    env.DB.prepare("INSERT INTO sessions (id,user_id,expires_at,created_at) VALUES (?,?,?,?)")
      .bind(sessionId, actorUserId, expires, now.toISOString()),
    env.DB.prepare("INSERT INTO categories (id,slug,name,emoji,created_at,updated_at) VALUES (?,?,?,'☕',?,?)")
      .bind(categoryId, categoryId, "카페", reviewedAt, reviewedAt),
    env.DB.prepare(`INSERT INTO places (id,slug,name,status,address,neighborhood,latitude,longitude,
      search_text,created_at,updated_at) VALUES (?,?,?,'PUBLISHED',?,'동구',35.1,126.9,?,?,?)`)
      .bind(placeId, placeId, placeName, placeAddress, placeName, reviewedAt, reviewedAt),
    env.DB.prepare("INSERT INTO place_categories (place_id,category_id,is_primary) VALUES (?,?,1)")
      .bind(placeId, categoryId),
    env.DB.prepare(`INSERT INTO place_poi_media (id,place_id,state,source_url,attribution,rights_basis,
      rights_evidence,sha256,byte_size,content_type,reviewed_at) VALUES
      (?,?,'STAGED','https://example.com/photo','합성 제공자','OWN_WORK',?,?,?,'image/jpeg',?)`)
      .bind(id, placeId, rightsEvidence, sha256, jpeg.length, reviewedAt),
  ]);
  await grantAdminAssurance(env.DB, { actorUserId, sessionId, method: "PASSWORD", now });
  const objectKey = getPoiMediaObjectKey(id, sha256);
  await bucket.put(objectKey, jpeg, { httpMetadata: { contentType: "image/jpeg" } });
  const publish = {
    id,
    actorUserId,
    sessionId,
    now: now.toISOString(),
    intent: "PUBLISH" as const,
    expectedState: "STAGED" as const,
    expectedSha256: sha256,
    expectedPlaceName: placeName,
    expectedPlaceAddress: placeAddress,
    reason: "  확인된 장소 사진 공개  ",
  };
  return { id, actorUserId, sessionId, placeId, objectKey, publish };
}

async function auditRows(id: string) {
  const { results } = await env.DB.prepare(`SELECT actor_user_id, action, before_state, after_state
    FROM admin_audit_logs WHERE target_type = 'PLACE_POI_MEDIA' AND target_id = ?
    ORDER BY rowid`).bind(id).all<{
    actor_user_id: string; action: string; before_state: string; after_state: string;
  }>();
  return results;
}

afterEach(() => vi.restoreAllMocks());

describe("POI media admin transitions", () => {
  it("previews exact bytes and atomically publishes and audits the staged asset once", async () => {
    const { id, publish, actorUserId } = await stagePhoto();
    expect(await getAdminPoiMedia(db, id)).toMatchObject({
      placeName, placeAddress, state: "STAGED", rightsEvidence, eligibleForPublication: true,
    });
    expect(new Uint8Array((await readAdminPoiMediaPreview(db, bucket, id))!)).toEqual(jpeg);
    const attempts = await Promise.all([
      applyPoiMediaAdminTransition(db, bucket, publish),
      applyPoiMediaAdminTransition(db, bucket, publish),
    ]);
    expect(attempts).toEqual(expect.arrayContaining([
      { ok: true, state: "PUBLISHED", changed: true },
      { ok: true, state: "PUBLISHED", changed: false },
    ]));
    expect(await getPublishedPoiMedia(db, id)).toMatchObject({ id, sha256: publish.expectedSha256 });
    const rows = await auditRows(id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ actor_user_id: actorUserId, action: "POI_MEDIA_PUBLISH" });
    expect(JSON.parse(rows[0]!.before_state)).toEqual({ state: "STAGED", sha256: publish.expectedSha256 });
    expect(JSON.parse(rows[0]!.after_state)).toEqual({
      state: "PUBLISHED", sha256: publish.expectedSha256, reason: "확인된 장소 사진 공개",
    });
  });

  it("rejects a different digest, wrong stored bytes, and R2 MIME mismatch", async () => {
    const { id, objectKey, publish } = await stagePhoto();
    expect(await applyPoiMediaAdminTransition(db, bucket, { ...publish, expectedSha256: "a".repeat(64) }))
      .toEqual({ ok: false, code: "STALE" });
    await bucket.put(objectKey, alteredJpeg, { httpMetadata: { contentType: "image/jpeg" } });
    expect(await readAdminPoiMediaPreview(db, bucket, id)).toBeNull();
    expect(await applyPoiMediaAdminTransition(db, bucket, publish)).toEqual({ ok: false, code: "ASSET_UNVERIFIED" });
    await bucket.put(objectKey, jpeg, { httpMetadata: { contentType: "image/png" } });
    expect(await applyPoiMediaAdminTransition(db, bucket, publish)).toEqual({ ok: false, code: "ASSET_UNVERIFIED" });
    expect(await getPublishedPoiMedia(db, id)).toBeNull();
    expect(await auditRows(id)).toHaveLength(0);
  });

  it.each(["address", "closed", "temp", "session", "assurance"] as const)(
    "rejects %s drift after the R2 read began",
    async (drift) => {
      const { id, actorUserId, sessionId, placeId, publish } = await stagePhoto();
      const realGet = bucket.get.bind(bucket);
      vi.spyOn(bucket, "get").mockImplementationOnce(async (key) => {
        const obj = await realGet(key);
        switch (drift) {
          case "address":
            await env.DB.prepare("UPDATE places SET address = ? WHERE id = ?")
              .bind("광주광역시 동구 합성로 2", placeId).run();
            break;
          case "closed":
            await env.DB.prepare("UPDATE places SET closed_at = ? WHERE id = ?").bind(reviewedAt, placeId).run();
            break;
          case "temp":
            await env.DB.batch([
              env.DB.prepare(`INSERT INTO temp_catalog_batches (id,source_hash,manifest_hash,status,created_at,updated_at)
                VALUES (?,?,?,'PUBLISHED',?,?)`).bind(id, id, id, reviewedAt, reviewedAt),
              env.DB.prepare(`INSERT INTO temp_catalog_entries (id,batch_id,source_id,place_id,payload_json,created_at,updated_at)
                VALUES (?,?,?,?,'{}',?,?)`).bind(id, id, id, placeId, reviewedAt, reviewedAt),
            ]);
            break;
          case "session":
            await env.DB.prepare("DELETE FROM sessions WHERE id = ?").bind(sessionId).run();
            break;
          case "assurance":
            await grantAdminAssurance(env.DB, { actorUserId, sessionId, method: "EMAIL", now: new Date() });
            break;
        }
        return obj;
      });
      const expected = { address: "STALE", closed: "INELIGIBLE", temp: "INELIGIBLE", session: "FORBIDDEN", assurance: "FORBIDDEN" };
      expect(await applyPoiMediaAdminTransition(db, bucket, publish)).toEqual({ ok: false, code: expected[drift] });
      expect((await getAdminPoiMedia(db, id))?.state).toBe(drift === "address" ? "WITHDRAWN" : "STAGED");
      expect((await auditRows(id)).map((row) => row.action))
        .toEqual(drift === "address" ? ["POI_MEDIA_IDENTITY_WITHDRAWN"] : []);
    },
  );

  it("rolls back publication when its audit insert fails", async () => {
    const { id, publish } = await stagePhoto();
    const reason = "Test audit write failure";
    await env.DB.prepare(`CREATE TRIGGER poi_media_test_abort_audit BEFORE INSERT ON admin_audit_logs
      WHEN NEW.action = 'POI_MEDIA_PUBLISH' AND json_extract(NEW.after_state, '$.reason') = 'Test audit write failure'
      BEGIN SELECT RAISE(ABORT, 'POI_MEDIA_TEST_AUDIT_FAILURE'); END`).run();
    try {
      await expect(applyPoiMediaAdminTransition(db, bucket, { ...publish, reason })).rejects.toThrow("POI_MEDIA_TEST_AUDIT_FAILURE");
      expect((await getAdminPoiMedia(db, id))?.state).toBe("STAGED");
      expect(await auditRows(id)).toHaveLength(0);
    } finally {
      await env.DB.prepare("DROP TRIGGER poi_media_test_abort_audit").run();
    }
  });

  it.each(["STAGED", "PUBLISHED"] as const)(
    "withdraws %s media even after a place closes, with no bucket, and retains the evidence",
    async (expectedState) => {
      const { id, placeId, objectKey, publish } = await stagePhoto();
      if (expectedState === "PUBLISHED") {
        expect(await applyPoiMediaAdminTransition(db, bucket, publish))
          .toEqual({ ok: true, state: "PUBLISHED", changed: true });
      }
      await env.DB.prepare("UPDATE places SET closed_at = ? WHERE id = ?").bind(reviewedAt, placeId).run();
      const withdraw = {
        ...publish,
        intent: "WITHDRAW" as const,
        expectedState,
        reason: "권리 이의 확인",
      };
      expect(await applyPoiMediaAdminTransition(db, undefined, withdraw))
        .toEqual({ ok: true, state: "WITHDRAWN", changed: true });
      expect(await applyPoiMediaAdminTransition(db, undefined, withdraw))
        .toEqual({ ok: true, state: "WITHDRAWN", changed: false });
      expect(await getPublishedPoiMedia(db, id)).toBeNull();
      expect(await readAdminPoiMediaPreview(db, bucket, id)).toBeNull();
      expect(await getAdminPoiMedia(db, id)).toMatchObject({ state: "WITHDRAWN", rightsEvidence });
      expect(await bucket.head(objectKey)).not.toBeNull();
      expect((await auditRows(id)).map((row) => row.action)).toEqual(
        expectedState === "PUBLISHED" ? ["POI_MEDIA_PUBLISH", "POI_MEDIA_WITHDRAW"] : ["POI_MEDIA_WITHDRAW"],
      );
    },
  );
});
