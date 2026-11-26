import { env } from "cloudflare:workers";
import { expect, it } from "vitest";
import { loader } from "../../app/routes/place-detail";

it("returns only the reviewed original for the exact current public venue", async () => {
  const id = "place-intake-684ed24c5417c7ec77450dac";
  const slug = "photo-original-source-test";
  const name = "복순이네";
  const address = "전남광주 동구 양림로 120 (학동)";
  const now = "2026-11-27T00:00:00.000Z";

  const tempPayload = JSON.stringify({
    sourceId: "temp100-001", name, address, region: "광주", cuisine: "한식", summary: "장소 출처 표시를 확인하는 합성 테스트 자료입니다.",
    sourceUrl: "https://tour.gwangju.go.kr/example", sourceTitle: "합성 목록", checkedAt: now,
    evaluation: { kind: "OFFICIAL_CURATION", provider: "합성", sourceUrl: "https://tour.gwangju.go.kr/example" }, photo: null,
  });
  await env.DB.batch([
    env.DB.prepare("INSERT INTO categories(id,slug,name,emoji,created_at,updated_at) VALUES ('source-link-category','source-link-category','한식','🍚',?,?)").bind(now, now),
    env.DB.prepare(`INSERT INTO places(id,slug,name,address,status,neighborhood,latitude,longitude,search_text,created_at,updated_at)
      VALUES (?,?,?,?,'PUBLISHED','학동',35.14,126.92,?,?,?)`).bind(id, slug, name, address, name, now, now),
    env.DB.prepare("INSERT INTO place_categories(place_id,category_id,is_primary) VALUES (?,'source-link-category',1)").bind(id),
  ]);

  const load = () => loader({ request: new Request(`https://retaste.test/places/${slug}`), params: { placeSlug: slug } } as never);
  expect(await load()).toMatchObject({
    photoOriginal: { url: "https://tour.gwangju.go.kr/home/tour/info/food.cs?act=view&infoId=1138", publisher: "오매광주" },
    instagramPhoto: null,
    poiPhoto: null,
  });

  await env.DB.prepare("UPDATE places SET address=? WHERE id=?").bind(`${address} 2호`, id).run();
  expect((await load()).photoOriginal).toBeNull();

  await env.DB.prepare("UPDATE places SET address=?,closed_at=? WHERE id=?").bind(address, now, id).run();
  expect((await load()).photoOriginal).toBeNull();

  await env.DB.batch([
    env.DB.prepare("UPDATE places SET closed_at=NULL WHERE id=?").bind(id),
    env.DB.prepare("INSERT INTO temp_catalog_batches(id,source_hash,manifest_hash,status,created_at,updated_at) VALUES (?,?,?,'PUBLISHED',?,?)")
      .bind(slug, slug, slug, now, now),
    env.DB.prepare("INSERT INTO temp_catalog_entries(id,batch_id,source_id,place_id,payload_json,created_at,updated_at) VALUES (?,?,?,?,?,?,?)")
      .bind(slug, slug, "temp100-001", id, tempPayload, now, now),
  ]);
  expect((await load()).photoOriginal).toBeNull();
  await env.DB.prepare("UPDATE temp_catalog_batches SET status='WITHDRAWN' WHERE id=?").bind(slug).run();

  const originalFlag = env.POI_MEDIA_PUBLIC_ENABLED;
  try {
    env.POI_MEDIA_PUBLIC_ENABLED = "true";
    await env.DB.prepare(`INSERT INTO place_poi_media
      (id,place_id,state,source_url,attribution,rights_basis,rights_evidence,sha256,byte_size,content_type,reviewed_at)
      VALUES (?,?,'PUBLISHED','https://example.test/approved','합성 제공자','OWN_WORK','synthetic',?,4,'image/jpeg',?)`)
      .bind("469f0000-0000-4000-8000-000000000001", id, "a".repeat(64), now).run();
    expect(await load()).toMatchObject({ photoOriginal: null, poiPhoto: { sourceUrl: "https://example.test/approved" } });
  } finally {
    env.POI_MEDIA_PUBLIC_ENABLED = originalFlag;
  }

  await env.DB.prepare("UPDATE places SET status='HIDDEN',closed_at=NULL WHERE id=?").bind(id).run();
  await expect(load()).rejects.toMatchObject({ status: 404 });
});
