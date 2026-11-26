import { env } from "cloudflare:workers";
import { eq } from "drizzle-orm";
import { expect, it } from "vitest";
import { createDb } from "../../app/db/client.server";
import { categories, placeCategories, places, reviewerProfiles, tempCatalogBatches, tempCatalogEntries, users } from "../../app/db/schema";
import { loader } from "../../app/routes/reviewer-ratings";
import { loader as searchLoader } from "../../app/routes/reviewer-places-resource";
import { listReviewerPlacePage } from "../../app/features/ratings/reviewer-place-search.server";
import { parseReviewerPlaceSearch } from "../../app/features/ratings/reviewer-place-search";
import { seedApprovedReviewerVote } from "./reviewer-public-fixtures";

const now = "2026-11-18T00:00:00.000Z";
async function fixture() {
  const db = createDb(env.DB), prefix = `search-${crypto.randomUUID()}`;
  const userId = `${prefix}-reviewer`, sessionId = `${prefix}-session`, categoryId = `${prefix}-category`;
  await db.insert(users).values({ id: userId, email: `${userId}@example.test`, displayName: "합성 리뷰어", role: "REVIEWER", emailVerifiedAt: now, createdAt: now, updatedAt: now });
  await env.DB.prepare("INSERT INTO sessions(id,user_id,expires_at,created_at) VALUES(?,?,'2099-01-01T00:00:00.000Z',?)").bind(sessionId,userId,now).run();
  await db.insert(reviewerProfiles).values({ userId, slug: userId, status: "ACTIVE", occupation: "합성", tasteDirection: "균형", regionCode: "GWANGJU", specialtySlugs: "[]", lastActivityAt: now, approvedAt: now, createdAt: now, updatedAt: now });
  await db.insert(categories).values({ id: categoryId, slug: categoryId, name: "라멘", emoji: "", sortOrder: 999, isActive: true, createdAt: now, updatedAt: now });
  const ids = [];
  for (let index = 0; index < 43; index++) {
    const id = `${prefix}-place-${index}`, name = `${prefix} 맛집 ${String(index).padStart(2,"0")}`;
    ids.push(id);
    await db.insert(places).values({ id, slug: id, name, address: `광주 ${index}`, neighborhood: "합성동", latitude: 35.1, longitude: 126.9, status: "PUBLISHED", searchText: name, createdAt: now, updatedAt: now });
    await db.insert(placeCategories).values({ placeId: id, categoryId, isPrimary: true });
  }
  return { db, prefix, userId, sessionId, categoryId, ids };
}

it("bounds the initial reviewer place picker instead of loading every eligible place", async () => {
  const f = await fixture();
  const result = await loader({ request: new Request(`https://retaste.test/reviewer/ratings?q=${f.prefix}`, { headers: { Cookie: `retaste_session=${f.sessionId}` } }) } as never);
  expect(result.places.length).toBeLessThanOrEqual(20);
  expect(result.places.length).toBeGreaterThan(0);
});

it("marks only published TEMP entries in initial, hydrated and restored place results", async () => {
  const f = await fixture();
  const [publishedPlaceId, stagedPlaceId, ordinaryPlaceId] = f.ids;
  const batches = [
    { id: `${f.prefix}-published`, status: "PUBLISHED" as const, placeId: publishedPlaceId },
    { id: `${f.prefix}-staged`, status: "STAGED" as const, placeId: stagedPlaceId },
  ];
  await f.db.batch([
    f.db.insert(tempCatalogBatches).values(batches.map(({ id, status }) => ({
      id, status, sourceHash: id, manifestHash: id, createdAt: now, updatedAt: now,
    }))),
    f.db.insert(tempCatalogEntries).values(batches.map(({ id, placeId }) => ({
      id, batchId: id, sourceId: id, placeId, payloadJson: "{}", createdAt: now, updatedAt: now,
    }))),
  ]);

  const headers = { Cookie: `retaste_session=${f.sessionId}` };
  const query = new URLSearchParams({ q: f.prefix });
  const initial = await loader({ request: new Request(`https://retaste.test/reviewer/ratings?${query}`, { headers }) } as never);
  const search = await searchLoader({ request: new Request(`https://retaste.test/resources/reviewer-places?${query}`, { headers }) } as never);
  if (!search.data.ok) throw new Error("Expected a search page");
  const expected = [
    { placeId: publishedPlaceId, isTemporary: true },
    { placeId: stagedPlaceId, isTemporary: false },
    { placeId: ordinaryPlaceId, isTemporary: false },
  ];
  for (const options of [initial.placePage.places, search.data.page.places]) {
    expect(options).toEqual(expect.arrayContaining(expected.map((place) => expect.objectContaining(place))));
  }

  query.set("q", `${f.prefix} 맛집 02`);
  query.set("selectedId", publishedPlaceId);
  const restored = await searchLoader({ request: new Request(`https://retaste.test/resources/reviewer-places?${query}`, { headers }) } as never);
  expect(restored.data).toMatchObject({ ok: true, page: { places: [expected[2]] }, selectedPlace: expected[0] });
});

it("pages through every matching place once and resolves a saved selection outside the first page", async () => {
  const f = await fixture(), seen: string[] = [];
  const duplicateName = `${f.prefix} 같은 이름`;
  const duplicateIds = [f.ids[21], f.ids[22]];
  for (const placeId of duplicateIds) await f.db.update(places).set({ name: duplicateName }).where(eq(places.id, placeId));
  await seedApprovedReviewerVote(f.db, { reviewerId: f.userId, placeId: f.ids[42], eventId: `${f.prefix}-visited`, value: 1, now, projectVote: false });
  let cursor: string | null = null;
  do {
    const query = new URLSearchParams({ q: f.prefix, selectedId: f.ids[42], requestKey: "test-page" });
    if (cursor) query.set("cursor", cursor);
    const response = await searchLoader({ request: new Request(`https://retaste.test/resources/reviewer-places?${query}`, { headers: { Cookie: `retaste_session=${f.sessionId}` } }) } as never);
    expect(response.init?.headers).toMatchObject({ "Cache-Control": "private, no-store", Vary: "Cookie" });
    expect(response.data.ok).toBe(true);
    if (!response.data.ok) throw new Error("Expected a search page");
    expect(response.data.page.places.length).toBeLessThanOrEqual(20);
    expect(response.data.selectedPlace).toMatchObject({ placeId: f.ids[42], address: "광주 42" });
    seen.push(...response.data.page.places.map((place) => place.placeId));
    cursor = response.data.page.nextCursor;
  } while (cursor);
  expect(seen).toHaveLength(43);
  expect(new Set(seen).size).toBe(43);
  expect(new Set(seen)).toEqual(new Set(f.ids));
  expect(seen.at(-1)).toBe(f.ids[42]);
  const matches = await listReviewerPlacePage(f.db, f.userId, parseReviewerPlaceSearch(new URLSearchParams({ q: duplicateName })));
  expect(matches.page.places).toMatchObject([
    { placeId: duplicateIds[0], placeName: duplicateName, neighborhood: "합성동", address: "광주 21" },
    { placeId: duplicateIds[1], placeName: duplicateName, neighborhood: "합성동", address: "광주 22" },
  ]);
});

it("does not return hidden, closed, inactive-category or unsupported-category places through search or selected ID", async () => {
  const f = await fixture();
  await f.db.update(places).set({ status: "HIDDEN", address: "합성 비공개 주소" }).where(eq(places.id, f.ids[0]));
  await f.db.update(places).set({ closedAt: now }).where(eq(places.id, f.ids[1]));
  const query = new URLSearchParams({ q: `${f.prefix} 맛집 0`, selectedId: f.ids[0] });
  await listReviewerPlacePage(f.db, f.userId, parseReviewerPlaceSearch(query));
  let response = await searchLoader({ request: new Request(`https://retaste.test/resources/reviewer-places?${query}`, { headers: { Cookie: `retaste_session=${f.sessionId}` } }) } as never);
  expect(response.data.ok).toBe(true);
  if (!response.data.ok) throw new Error("Expected a search page");
  expect(response.data.page.places.map((place) => place.placeId)).not.toContain(f.ids[0]);
  expect(response.data.page.places.map((place) => place.placeId)).not.toContain(f.ids[1]);
  expect(response.data.selectedPlace).toBeNull();
  expect(JSON.stringify(response.data)).not.toContain("합성 비공개 주소");
  await f.db.update(categories).set({ isActive: false }).where(eq(categories.id, f.categoryId));
  response = await searchLoader({ request: new Request(`https://retaste.test/resources/reviewer-places?${query}`, { headers: { Cookie: `retaste_session=${f.sessionId}` } }) } as never);
  expect(response.data).toMatchObject({ ok: true, page: { places: [] }, selectedPlace: null });
  await f.db.update(categories).set({ isActive: true, name: "지원하지 않는 업종" }).where(eq(categories.id, f.categoryId));
  response = await searchLoader({ request: new Request(`https://retaste.test/resources/reviewer-places?${query}`, { headers: { Cookie: `retaste_session=${f.sessionId}` } }) } as never);
  expect(response.data).toMatchObject({ ok: true, page: { places: [] }, selectedPlace: null });
});

it("treats wildcard search text literally and rejects a cursor reused with another query", async () => {
  const f = await fixture();
  const request = (query: string) => new Request(`https://retaste.test/resources/reviewer-places?${query}`, { headers: { Cookie: `retaste_session=${f.sessionId}` } });
  const wildcard = await searchLoader({ request: request(new URLSearchParams({ q: "%" }).toString()) } as never);
  expect(wildcard.data).toMatchObject({ ok: true, page: { places: [] } });
  const first = await searchLoader({ request: request(new URLSearchParams({ q: f.prefix }).toString()) } as never);
  if (!first.data.ok) throw new Error("Expected a search page");
  const changed = await searchLoader({ request: request(new URLSearchParams({ q: "다른 검색", cursor: first.data.page.nextCursor!, requestKey: "changed" }).toString()) } as never);
  expect(changed.init?.status).toBe(400);
  expect(changed.data).toMatchObject({ ok: false, requestKey: "changed" });
});

it("requires the current active reviewer role for every search request", async () => {
  const f = await fixture();
  const request = () => new Request("https://retaste.test/resources/reviewer-places?requestKey=permission", { headers: { Cookie: `retaste_session=${f.sessionId}` } });
  await f.db.update(reviewerProfiles).set({ status: "DORMANT" }).where(eq(reviewerProfiles.userId, f.userId));
  const inactive = await searchLoader({ request: request() } as never);
  expect(inactive.init?.status).toBe(403);
  expect(inactive.data).toMatchObject({ ok: false, requestKey: "permission" });
  await f.db.update(reviewerProfiles).set({ status: "ACTIVE" }).where(eq(reviewerProfiles.userId, f.userId));
  await f.db.update(users).set({ role: "USER" }).where(eq(users.id, f.userId));
  expect((await searchLoader({ request: request() } as never)).init?.status).toBe(403);
  await expect(searchLoader({ request: new Request("https://retaste.test/resources/reviewer-places") } as never)).rejects.toMatchObject({ status: 302 });
});

it("targets the reviewer workspace after authentication instead of the resource URL or home", async () => {
  let response: unknown;
  try { await searchLoader({ request: new Request("https://retaste.test/resources/reviewer-places?q=라멘&requestKey=expired") } as never); }
  catch (error) { response = error; }
  expect(response).toBeInstanceOf(Response);
  expect((response as Response).headers.get("Location")).toBe("/login?returnTo=%2Freviewer%2Fratings");
  expect((response as Response).headers.get("Cache-Control")).toBe("private, no-store");
});
