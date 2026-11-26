import { env } from "cloudflare:workers";
import { expect, it } from "vitest";
import { loader } from "../../app/routes/place-detail";

const id = "place-intake-f7b108b403228b28211b8512";
const name = "젤라또 노베오";
const address = "전북 군산시 구영4길 18 (영화동)";
const slug = "poi-instagram-test";
const now = "2026-11-26T00:00:00.000Z";

function loadPlace() {
  return loader({ request: new Request(`https://retaste.test/places/${slug}`), params: { placeSlug: slug } } as never);
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
