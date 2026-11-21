import { env } from "cloudflare:workers";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { createDb } from "../../app/db/client.server";
import { businessLicenseExclusions, businessLicenses, categories, placeCategories, places, placeSourceLinks } from "../../app/db/schema";
import { parseCorrectionPlaceSearch } from "../../app/features/places/correction-place-search";
import { listCorrectionPlacePage, readCorrectionPlaceTarget } from "../../app/features/places/correction-place-search.server";
import { loader as searchLoader } from "../../app/routes/correction-places-resource";

const now = "2026-11-18T00:00:00.000Z";

async function fixture(count: number) {
  const db = createDb(env.DB), prefix = `correction-search-${crypto.randomUUID()}`;
  const categoryId = `${prefix}-category`;
  await db.insert(categories).values({ id: categoryId, slug: categoryId, name: "합성 식당", emoji: "", isActive: false, createdAt: now, updatedAt: now });
  await env.DB.prepare(`WITH RECURSIVE seq(n) AS (SELECT 1 UNION ALL SELECT n+1 FROM seq WHERE n<?)
    INSERT INTO places(id,slug,name,status,address,neighborhood,latitude,longitude,search_text,created_at,updated_at)
    SELECT ?||printf('%04d',n),?||printf('%04d',n),?,'PUBLISHED',?||printf('%04d',n),'합성동',35.14,126.92,?||printf('%04d',n),?,? FROM seq`)
    .bind(count, `${prefix}-`, `${prefix}-`, `${prefix} 같은 이름`, `${prefix} 주소 `, `${prefix} 검색 `, now, now).run();
  await env.DB.prepare("INSERT INTO place_categories(place_id,category_id,is_primary) SELECT id,?,1 FROM places WHERE substr(id,1,?)=?")
    .bind(categoryId, prefix.length + 1, `${prefix}-`).run();
  return { db, prefix, categoryId, ids: Array.from({ length: count }, (_, index) => `${prefix}-${String(index + 1).padStart(4, "0")}`) };
}

function input(query: string, cursor?: string) {
  const params = new URLSearchParams({ q: query, requestKey: "synthetic-search" });
  if (cursor) params.set("cursor", cursor);
  return parseCorrectionPlaceSearch(params);
}

function request(params: URLSearchParams) {
  return new Request(`https://retaste.test/resources/correction-places?${params}`);
}

async function linkExcludedSource(f: Awaited<ReturnType<typeof fixture>>, placeId: string, suffix: string, overridden = false) {
  const id = `${f.prefix}-license-${suffix}`;
  await f.db.insert(businessLicenses).values({ id, sourceType: "GENERAL_RESTAURANT", sourceManagementNo: id, businessName: "합성 업소", businessSubtype: "노래연습장업", normalizedStatus: "OPEN", regionCode: "GWANGJU", rawPayload: "{}", reviewStatus: "APPROVED", firstSeenAt: now, lastSeenAt: now, createdAt: now, updatedAt: now });
  await f.db.insert(placeSourceLinks).values({ id: `${id}-link`, placeId, businessLicenseId: id, isPrimary: true, createdAt: now });
  if (overridden) await f.db.insert(businessLicenseExclusions).values({ businessLicenseId: id, reason: "NOT_RESTAURANT", exclusionCategory: "BUSINESS_TYPE", status: "OVERRIDDEN", excludedAt: now, overriddenAt: now, createdAt: now, updatedAt: now });
}

describe("public correction target search", () => {
  it("reaches every one of more than 1000 places once through bounded pages and keeps independent targets", async () => {
    const f = await fixture(1001);
    const extraCategory = `${f.prefix}-second-category`;
    await f.db.insert(categories).values({ id: extraCategory, slug: extraCategory, name: "추가 합성 분류", emoji: "", createdAt: now, updatedAt: now });
    await f.db.insert(placeCategories).values({ placeId: f.ids[0], categoryId: extraCategory, isPrimary: true });

    const seen: string[] = [];
    let cursor: string | undefined;
    let pageCount = 0;
    do {
      const page = await listCorrectionPlacePage(f.db, input(f.prefix, cursor));
      expect(page.query).toBe(f.prefix);
      expect(page.places.length).toBeLessThanOrEqual(20);
      expect(page.places.length).toBeGreaterThan(0);
      seen.push(...page.places.map(place => place.id));
      cursor = page.nextCursor ?? undefined;
      pageCount += 1;
      if (pageCount > 51) throw new Error("Correction cursor did not terminate");
    } while (cursor);

    expect(pageCount).toBe(51);
    expect(seen).toHaveLength(1001);
    expect(new Set(seen)).toEqual(new Set(f.ids));
    const last = await readCorrectionPlaceTarget(f.db, f.ids[1000]);
    expect(last.id).toBe(f.ids[1000]);
    expect(Object.keys(last).sort()).toEqual(["address", "id", "name"]);
    const searched = await listCorrectionPlacePage(f.db, input(`${f.prefix} 주소 1001`));
    expect(searched.places.map(place => place.id)).toEqual([f.ids[1000]]);
    expect(searched.nextCursor).toBeNull();
  }, 20_000);

  it("has no extra cursor at an exact page boundary and returns an empty page for no match", async () => {
    const f = await fixture(20);
    const page = await listCorrectionPlacePage(f.db, input(f.prefix));
    expect(page.places).toHaveLength(20);
    expect(page.nextCursor).toBeNull();
    expect(await listCorrectionPlacePage(f.db, input(`${f.prefix}-missing`))).toEqual({ query: `${f.prefix}-missing`, places: [], nextCursor: null });
  });

  it("uses the same existing public eligibility for both search and selected target", async () => {
    const f = await fixture(8);
    await f.db.update(places).set({ status: "HIDDEN" }).where(eq(places.id, f.ids[1]));
    await f.db.update(places).set({ closedAt: now }).where(eq(places.id, f.ids[2]));
    await f.db.update(placeCategories).set({ isPrimary: false }).where(eq(placeCategories.placeId, f.ids[3]));
    await f.db.update(places).set({ name: `${f.prefix} 황금 카바레` }).where(eq(places.id, f.ids[4]));
    await linkExcludedSource(f, f.ids[5], "blocked");
    await f.db.update(places).set({ name: `${f.prefix} 합성 카바레` }).where(eq(places.id, f.ids[6]));
    await linkExcludedSource(f, f.ids[6], "overridden", true);
    await linkExcludedSource(f, f.ids[7], "one-overridden", true);
    await linkExcludedSource(f, f.ids[7], "other-blocked");

    const page = await listCorrectionPlacePage(f.db, input(f.prefix));
    expect(new Set(page.places.map(place => place.id))).toEqual(new Set([f.ids[0], f.ids[6]]));
    for (const id of [f.ids[0], f.ids[6]]) expect((await readCorrectionPlaceTarget(f.db, id)).id).toBe(id);
    for (const id of [f.ids[1], f.ids[2], f.ids[3], f.ids[4], f.ids[5], f.ids[7], `${f.prefix}-missing`]) {
      await expect(readCorrectionPlaceTarget(f.db, id)).rejects.toMatchObject({ status: 404 });
    }
    for (const value of ["", " leading-space", "a".repeat(129), "bad\u0000id", null]) {
      await expect(readCorrectionPlaceTarget(f.db, value)).rejects.toMatchObject({ status: 400 });
    }
  });

  it("treats wildcard characters and quotes as literal search text", async () => {
    const f = await fixture(2);
    const literal = `${f.prefix} %_ 국밥 '원조'`;
    await f.db.update(places).set({ name: literal, searchText: literal }).where(eq(places.id, f.ids[0]));
    for (const query of ["%_", "'원조'"]) {
      const page = await listCorrectionPlacePage(f.db, input(query));
      expect(page.places.map(place => place.id)).toEqual([f.ids[0]]);
    }
  });

  it("allows anonymous bounded lookup and isolates malformed or reused cursors as private 400 responses", async () => {
    const f = await fixture(21);
    const result = await searchLoader({ request: request(new URLSearchParams({ q: f.prefix, requestKey: "first" })) } as never);
    expect(result.init?.headers).toMatchObject({ "Cache-Control": "private, no-store" });
    expect(result.data).toMatchObject({ ok: true, requestKey: "first" });
    if (!result.data.ok) throw new Error("Expected a public search page");
    expect(result.data.page.places).toHaveLength(20);
    expect(result.data.page.nextCursor).toBeTruthy();
    for (const params of [
      new URLSearchParams({ q: `${f.prefix}-changed`, cursor: result.data.page.nextCursor!, requestKey: "changed" }),
      new URLSearchParams({ q: f.prefix, cursor: "malformed", requestKey: "invalid" }),
    ]) {
      const rejected = await searchLoader({ request: request(params) } as never);
      expect(rejected.init?.status).toBe(400);
      expect(rejected.init?.headers).toMatchObject({ "Cache-Control": "private, no-store" });
      expect(rejected.data).toMatchObject({ ok: false, requestKey: params.get("requestKey") });
    }
  });
});
