import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createDb } from "../../app/db/client.server";
import { getPoiMediaObjectKey } from "../../app/features/poi-media/poi-media";
import { getPublicPoiPhoto } from "../../app/features/poi-media/poi-media.server";
import { action, loader } from "../../app/routes/poi-media";

const now = "2026-11-26T02:00:00.000Z";
const sourceUrl = "https://example.com/approved-place-photo";
const jpeg = new Uint8Array([0xff, 0xd8, 0x01, 0x02, 0xff, 0xd9]);
const initialFlag = env.POI_MEDIA_PUBLIC_ENABLED;

async function seedPhoto(input: {
  state?: "STAGED" | "PUBLISHED" | "WITHDRAWN";
  placeStatus?: "DRAFT" | "PUBLISHED" | "HIDDEN";
  closed?: boolean;
  hasPrimaryCategory?: boolean;
  placeName?: string;
  source?: string;
  bytes?: Uint8Array<ArrayBuffer>;
  contentType?: string;
} = {}) {
  const id = crypto.randomUUID();
  const placesKey = `poi-test-place-${id}`;
  const categoryId = `poi-test-category-${id}`;
  const sha256 = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", jpeg)),
    (byte) => byte.toString(16).padStart(2, "0")).join("");
  await env.DB.batch([
    env.DB.prepare("INSERT INTO categories (id,slug,name,emoji,created_at,updated_at) VALUES(?,?,?,'☕',?,?)")
      .bind(categoryId, categoryId, categoryId, now, now),
    env.DB.prepare(`INSERT INTO places (id, slug, name, status, address, neighborhood,
      latitude, longitude, search_text, closed_at, created_at, updated_at)
      VALUES (?, ?, ?, ?, '광주', '동구', 35.1, 126.9, '합성 장소', ?, ?, ?)`)
      .bind(placesKey, placesKey, input.placeName ?? "합성 카페", input.placeStatus ?? "PUBLISHED", input.closed ? now : null, now, now),
    env.DB.prepare("INSERT INTO place_categories (place_id,category_id,is_primary) VALUES (?,?,?)")
      .bind(placesKey, categoryId, input.hasPrimaryCategory === false ? 0 : 1),
    env.DB.prepare(`INSERT INTO place_poi_media (
      id,place_id,state,source_url,attribution,rights_basis,rights_evidence,sha256,byte_size,content_type,reviewed_at)
      VALUES (?,?,?,?,?,'OWN_WORK','internal-approval-reference',?,?,'image/jpeg',?)`)
      .bind(id, placesKey, input.state ?? "PUBLISHED", input.source ?? sourceUrl, "합성 제공자", sha256, jpeg.length, now),
  ]);
  const objectKey = getPoiMediaObjectKey(id, sha256);
  await env.REVIEW_PHOTOS.put(objectKey, input.bytes ?? jpeg, {
    httpMetadata: { contentType: input.contentType ?? "image/jpeg" },
  });
  return { id, placeId: placesKey, objectKey };
}

function requestMedia(id: string, method = "GET") {
  return loader({
    request: new Request(`https://retaste.test/poi-media/${id}`, { method }),
    params: { mediaId: id },
  } as never);
}

beforeEach(() => {
  env.POI_MEDIA_PUBLIC_ENABLED = "true";
});

afterEach(() => {
  env.POI_MEDIA_PUBLIC_ENABLED = initialFlag;
  vi.restoreAllMocks();
});

describe("approved place photo resource", () => {
  it("returns only public attribution and verified JPEG responses without caching", async () => {
    const { id, placeId } = await seedPhoto();
    expect(await getPublicPoiPhoto(createDb(env.DB), placeId, env.POI_MEDIA_PUBLIC_ENABLED)).toEqual({
      url: `/poi-media/${id}`, sourceUrl, attribution: "합성 제공자",
    });

    const get = await requestMedia(id);
    expect(get.status).toBe(200);
    expect(get.headers.get("content-type")).toBe("image/jpeg");
    expect(get.headers.get("content-length")).toBe(String(jpeg.length));
    expect(get.headers.get("cache-control")).toBe("private, no-store");
    expect(get.headers.get("x-content-type-options")).toBe("nosniff");
    expect(new Uint8Array(await get.arrayBuffer())).toEqual(jpeg);

    const head = await requestMedia(id, "HEAD");
    expect(head.status).toBe(200);
    expect(head.headers.get("content-length")).toBe(String(jpeg.length));
    expect(head.body).toBeNull();
    expect(action().status).toBe(405);
  });

  it("skips the new D1 table and R2 when disabled or the opaque ID is invalid", async () => {
    const { id, placeId } = await seedPhoto();
    const prepare = vi.spyOn(env.DB, "prepare");
    const get = vi.spyOn(env.REVIEW_PHOTOS, "get");
    env.POI_MEDIA_PUBLIC_ENABLED = undefined;
    expect(await getPublicPoiPhoto(createDb(env.DB), placeId)).toBeNull();
    expect((await requestMedia(id)).status).toBe(404);
    env.POI_MEDIA_PUBLIC_ENABLED = "true";
    expect((await requestMedia("invalid-photo-id")).status).toBe(404);
    expect(prepare).not.toHaveBeenCalled();
    expect(get).not.toHaveBeenCalled();
  });

  it.each([
    { state: "STAGED" as const },
    { state: "WITHDRAWN" as const },
    { placeStatus: "DRAFT" as const },
    { placeStatus: "HIDDEN" as const },
    { closed: true },
    { hasPrimaryCategory: false },
    { placeName: "합성 노래방" },
    { source: "https://user:private@example.com/photo" },
  ])("rejects ineligible source %o before reading R2", async (input) => {
    const { id, placeId } = await seedPhoto(input);
    const get = vi.spyOn(env.REVIEW_PHOTOS, "get");
    expect(await getPublicPoiPhoto(createDb(env.DB), placeId, "true")).toBeNull();
    expect((await requestMedia(id)).status).toBe(404);
    expect((await requestMedia(id, "HEAD")).status).toBe(404);
    expect(get).not.toHaveBeenCalled();
  });

  it("keeps the original TEMP photo flow exclusive for places in a published TEMP batch", async () => {
    const { id, placeId } = await seedPhoto();
    await env.DB.batch([
      env.DB.prepare("INSERT INTO temp_catalog_batches(id,source_hash,manifest_hash,status,created_at,updated_at) VALUES(?,?,?,'PUBLISHED',?,?)")
        .bind(id, id, id, now, now),
      env.DB.prepare("INSERT INTO temp_catalog_entries(id,batch_id,source_id,place_id,payload_json,created_at,updated_at) VALUES(?,?,?,?, '{}',?,?)")
        .bind(id, id, id, placeId, now, now),
    ]);
    const get = vi.spyOn(env.REVIEW_PHOTOS, "get");
    expect(await getPublicPoiPhoto(createDb(env.DB), placeId, "true")).toBeNull();
    expect((await requestMedia(id)).status).toBe(404);
    expect(get).not.toHaveBeenCalled();
  });

  it("checks exact object metadata and bytes before serving them", async () => {
    const corruptJpeg = new Uint8Array([0xff, 0xd8, 0x02, 0x01, 0xff, 0xd9]);
    for (const input of [{ bytes: corruptJpeg }, { contentType: "text/plain" }]) {
      const { id } = await seedPhoto(input);
      expect((await requestMedia(id)).status).toBe(404);
      expect((await requestMedia(id, "HEAD")).status).toBe(404);
    }
  });

  it("prevents changing provenance or republishing the same withdrawn photo ID", async () => {
    const { id } = await seedPhoto();
    await expect(env.DB.prepare("UPDATE place_poi_media SET source_url = ? WHERE id = ?")
      .bind("https://example.com/different", id).run()).rejects.toThrow("POI_MEDIA_PROVENANCE_IMMUTABLE");
    await env.DB.prepare("UPDATE place_poi_media SET state = 'WITHDRAWN' WHERE id = ?").bind(id).run();
    expect((await requestMedia(id)).status).toBe(404);
    await expect(env.DB.prepare("UPDATE place_poi_media SET state = 'PUBLISHED' WHERE id = ?")
      .bind(id).run()).rejects.toThrow("POI_MEDIA_INVALID_STATE_TRANSITION");
  });
});
