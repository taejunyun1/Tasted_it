import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { createDb } from "../../app/db/client.server";
import { categories, placeCategories, places } from "../../app/db/schema";
import { action, loader } from "../../app/routes/place-correction";

let target: string;
let hidden: string;
let closed: string;
const now = "2026-11-13T00:00:00.000Z";
const load = loader as unknown as (args: { request: Request }) => Promise<unknown>;

beforeEach(async () => {
  const db = createDb(env.DB);
  target = `correction-entry-${crypto.randomUUID()}`;
  hidden = `${target}-hidden`;
  closed = `${target}-closed`;
  const categoryId = `${target}-category`;
  await db.insert(categories).values({ id: categoryId, slug: categoryId, name: "국밥·해장국", emoji: "🍲", createdAt: now, updatedAt: now });
  for (const id of [target, hidden, closed]) {
    await db.insert(places).values({ id, slug: id, name: "합성 검수 국밥", status: id === hidden ? "HIDDEN" : "PUBLISHED", address: "광주 합성 주소", neighborhood: "합성 동네", latitude: 35.14, longitude: 126.92, searchText: "합성 국밥", closedAt: id === closed ? now : null, createdAt: now, updatedAt: now });
    await db.insert(placeCategories).values({ placeId: id, categoryId, isPrimary: true });
  }
});

function request(query = "") { return new Request(`https://retaste.test/corrections/new${query}`); }

describe("place correction entry", () => {
  it("preselects the exact place from the detail entry without changing its public information", async () => {
    expect(await load({ request: request(`?placeId=${target}`) })).toMatchObject({ selectedPlaceId: target, places: expect.arrayContaining([expect.objectContaining({ id: target })]) });
    expect(await env.DB.prepare("SELECT status,name FROM places WHERE id=?").bind(target).first()).toEqual({ status: "PUBLISHED", name: "합성 검수 국밥" });
  });

  it("keeps untargeted entry unselected", async () => {
    expect(await load({ request: request() })).toMatchObject({ selectedPlaceId: "" });
  });

  it("keeps a safe return destination independently of the target and rejects external destinations", async () => {
    expect(await load({ request: request(`?placeId=${target}&returnTo=%2Fplaces%2Fdetail%3Ffrom%3Dmap`) })).toMatchObject({ selectedPlaceId: target, returnTo: "/places/detail?from=map" });
    expect(await load({ request: request("?returnTo=https%3A%2F%2Fexternal.example") })).toMatchObject({ returnTo: "/" });
  });

  it.each(["?placeId=", "?placeId=a&placeId=b", `?placeId=${"a".repeat(129)}`])("rejects ambiguous or invalid target %s", async query => {
    await expect(load({ request: request(query) })).rejects.toMatchObject({ status: 400 });
  });

  it("does not preselect missing, hidden or closed places", async () => {
    for (const id of ["does-not-exist", hidden, closed]) {
      await expect(load({ request: request(`?placeId=${id}`) })).rejects.toMatchObject({ status: 404 });
    }
  });

  it("retains a target beyond the general option window without duplicating it", async () => {
    const prefix = `bulk-${target}-`;
    await env.DB.prepare(`WITH RECURSIVE seq(n) AS (SELECT 1 UNION ALL SELECT n+1 FROM seq WHERE n<1000)
      INSERT INTO places(id,slug,name,status,address,neighborhood,latitude,longitude,search_text,created_at,updated_at)
      SELECT ?||n,?||n,'AAA 합성 국밥 '||n,'PUBLISHED','광주 합성 주소','합성 동네',35.14,126.92,'합성 국밥',?,? FROM seq`)
      .bind(prefix, prefix, now, now).run();
    await env.DB.prepare("INSERT INTO place_categories(place_id,category_id,is_primary) SELECT id,?,1 FROM places WHERE substr(id,1,?)=?")
      .bind(`${target}-category`, prefix.length, prefix).run();
    const result = await load({ request: request(`?placeId=${target}`) }) as { selectedPlaceId: string; selectedPlace: { id: string }; places: Array<{ id: string }> };
    expect(result.selectedPlaceId).toBe(target);
    expect(result.places.length).toBeLessThanOrEqual(20);
    expect(result.selectedPlace?.id).toBe(target);
  });

  it("checks a posted hidden target before any mail request or public change", async () => {
    await expect(action({ request: new Request("https://retaste.test/corrections/new", {
      method: "POST", headers: { Origin: "https://retaste.test", "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ placeId: hidden, email: "synthetic@example.test", relation: "방문자", evidenceNote: "합성 정정 근거", requestType: "INFORMATION" }),
    }) } as never)).resolves.toMatchObject({ init: { status: 404 }, data: { ok: false, code: "CORRECTION_TARGET_UNAVAILABLE", values: { placeId: hidden, evidenceNote: "합성 정정 근거" } } });
    expect(await env.DB.prepare("SELECT COUNT(*) as n FROM place_correction_requests WHERE place_id=?").bind(hidden).first()).toEqual({ n: 0 });
  });
});
