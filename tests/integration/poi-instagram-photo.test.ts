import { env } from "cloudflare:workers";
import { expect, it } from "vitest";
import { loader } from "../../app/routes/place-detail";

const id = "place-intake-f7b108b403228b28211b8512";
const name = "젤라또 노베오";
const address = "전북 군산시 구영4길 18 (영화동)";
const slug = "poi-instagram-test";
const now = "2026-11-26T00:00:00.000Z";

function loadPlace(placeSlug = slug) {
  return loader({ request: new Request(`https://retaste.test/places/${placeSlug}`), params: { placeSlug } } as never);
}

it("serves a curated Instagram post only for the exact public and open venue while enabled", async () => {
  await env.DB.batch([
    env.DB.prepare("INSERT INTO categories (id,slug,name,emoji,created_at,updated_at) VALUES (?,?,?,'☕',?,?)")
      .bind(slug, slug, "합성 제과점", now, now),
    env.DB.prepare("INSERT INTO places (id,slug,name,address,neighborhood,latitude,longitude,status,search_text,created_at,updated_at) VALUES (?,?,?,?,'영화동',35.99,126.71,'PUBLISHED',?,?,?)")
      .bind(id, slug, name, address, name, now, now),
    env.DB.prepare("INSERT INTO place_categories (place_id,category_id,is_primary) VALUES (?,?,1)").bind(id, slug),
  ]);
  const previous = env.POI_INSTAGRAM_PHOTO_ENABLED;
  try {
    env.POI_INSTAGRAM_PHOTO_ENABLED = "false";
    expect((await loadPlace()).instagramPhoto).toBeNull();
    env.POI_INSTAGRAM_PHOTO_ENABLED = "true";
    expect((await loadPlace()).instagramPhoto).toEqual({
      postUrl: "https://www.instagram.com/p/DVU7dmQEnHV/",
      embedUrl: "https://www.instagram.com/p/DVU7dmQEnHV/embed/",
    });
    await env.DB.prepare("UPDATE places SET closed_at = ? WHERE id = ?").bind(now, id).run();
    expect((await loadPlace()).instagramPhoto).toBeNull();
    await env.DB.prepare("UPDATE places SET closed_at = NULL, address = ? WHERE id = ?").bind(`${address}, 2층`, id).run();
    expect((await loadPlace()).instagramPhoto).toBeNull();
  } finally {
    env.POI_INSTAGRAM_PHOTO_ENABLED = previous;
  }
});

it.each([
  {
    id: "064b24dd-9412-41a7-a237-5a46bf126c0d",
    name: "소금과 와사비",
    address: "전남광주통합특별시 동구 동명로 9-4, 1층 (장동)",
    shortcode: "DfoJ1gpSJ9e",
  },
  {
    id: "place-intake-7c405c2fb6be0ccd2a6bc790",
    name: "피쩨리아 델깜포",
    address: "전북 군산시 구영4길 24, 2호 (영화동)",
    shortcode: "DRMh-qcgOyX",
  },
])("serves the exact original Reel and embed only for $name while enabled", async ({ id, name, address, shortcode }) => {
  const placeSlug = `poi-reel-${shortcode.toLowerCase()}`;
  await env.DB.batch([
    env.DB.prepare("INSERT INTO categories (id,slug,name,emoji,created_at,updated_at) VALUES (?,?,?,'🍽',?,?)")
      .bind(placeSlug, placeSlug, "합성 음식점", now, now),
    env.DB.prepare("INSERT INTO places (id,slug,name,address,neighborhood,latitude,longitude,status,search_text,created_at,updated_at) VALUES (?,?,?,?,'합성동',35.99,126.71,'PUBLISHED',?,?,?)")
      .bind(id, placeSlug, name, address, name, now, now),
    env.DB.prepare("INSERT INTO place_categories (place_id,category_id,is_primary) VALUES (?,?,1)").bind(id, placeSlug),
  ]);
  const previous = env.POI_INSTAGRAM_PHOTO_ENABLED;
  try {
    env.POI_INSTAGRAM_PHOTO_ENABLED = "false";
    expect((await loadPlace(placeSlug)).instagramPhoto).toBeNull();
    env.POI_INSTAGRAM_PHOTO_ENABLED = "true";
    const postUrl = `https://www.instagram.com/reel/${shortcode}/`;
    expect((await loadPlace(placeSlug)).instagramPhoto).toEqual({ postUrl, embedUrl: `${postUrl}embed/` });
    await env.DB.prepare("UPDATE places SET address = ? WHERE id = ?").bind(`${address} 2층`, id).run();
    expect((await loadPlace(placeSlug)).instagramPhoto).toBeNull();
  } finally {
    env.POI_INSTAGRAM_PHOTO_ENABLED = previous;
  }
});
