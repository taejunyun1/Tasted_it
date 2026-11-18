import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { createDb } from "../../app/db/client.server";
import { getPlaceBySlug } from "../../app/features/places/place.server";

async function fixture() {
  const id = `public-info-${crypto.randomUUID()}`, now = "2026-11-17T18:30:00.000Z";
  await env.DB.batch([
    env.DB.prepare("INSERT INTO categories(id,slug,name,emoji,created_at,updated_at) VALUES(?,?,?,'🍜',?,?)").bind(id,id,"정보 확인",now,now),
    env.DB.prepare("INSERT INTO places(id,slug,name,status,address,neighborhood,latitude,longitude,search_text,last_verified_at,created_at,updated_at) VALUES(?,?,?,'PUBLISHED',?,'동구',35.15,126.92,?,?,?,?)").bind(id,id,"정보 확인 장소","광주광역시 동구",id,now,now,now),
    env.DB.prepare("INSERT INTO place_categories(place_id,category_id,is_primary) VALUES(?,?,1)").bind(id,id),
  ]);
  return { id, now };
}

describe("public place information", () => {
  it("exposes the recorded KST date and only public operating-hour fields", async () => {
    const { id, now } = await fixture();
    const verifierId = `${id}-admin`;
    await env.DB.prepare("INSERT INTO users(id,email,display_name,role,created_at,updated_at) VALUES(?,?,?,'ADMIN',?,?)").bind(verifierId,`${verifierId}@example.test`,"합성 검수자",now,now).run();
    await env.DB.prepare("INSERT INTO place_operating_hours(id,place_id,weekday,opens_at,closes_at,is_closed,verified_by,last_verified_at,created_at,updated_at) VALUES(?,?,1,'18:00','02:00',0,?,?,?,?)").bind(`${id}-hours`,id,verifierId,now,now,now).run();
    const place = await getPlaceBySlug(createDb(env.DB),id);
    expect(place).toMatchObject({ informationVerifiedOn: "2026-11-18", operatingHours: [{ weekday: 1, summary: "18:00–다음 날 02:00", verifiedOn: "2026-11-18" }] });
    expect(JSON.stringify(place.operatingHours)).not.toMatch(/verifiedBy|verified_by|createdAt|created_at/);
    expect(JSON.stringify(place)).not.toContain(verifierId);
  });

  it("keeps missing information unknown and preserves public visibility gates", async () => {
    const { id } = await fixture();
    await env.DB.prepare("UPDATE places SET last_verified_at=NULL WHERE id=?").bind(id).run();
    expect(await getPlaceBySlug(createDb(env.DB),id)).toMatchObject({ informationVerifiedOn: null, operatingHours: [] });
    await env.DB.prepare("UPDATE places SET status='HIDDEN' WHERE id=?").bind(id).run();
    await expect(getPlaceBySlug(createDb(env.DB),id)).rejects.toMatchObject({ status: 404 });
  });
});
