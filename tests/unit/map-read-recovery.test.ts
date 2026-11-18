import { expect, it } from "vitest";
import { keepMapShell, mapReadPath, readMapData, readMapResource, reconcileMapRead } from "../../app/features/maps/map-read-recovery";

it("normalizes single-fetch paths and preserves requested filters", async () => {
  const path = "/maps/ramen-detail?bbox=126.9%2C35.1%2C127%2C35.2&q=국밥&selected=p1&view=list";
  expect(mapReadPath(`https://example.test/maps/ramen-detail.data?q=국밥&view=list&selected=p1&bbox=126.9,35.1,127,35.2&_routes=routes/map-category`)).toBe(mapReadPath(path));
  expect(await readMapData(new Request(`https://example.test${path}`), async () => ({ places: [] }))).toMatchObject({ places: [], mapReadPath: mapReadPath(path) });
});

it("turns only transient failures into safe read feedback", async () => {
  const request = new Request("https://example.test/maps/ramen-detail?q=국밥");
  const failure = await readMapData(request, async () => { throw new Error("private provider details"); });
  expect(failure).toEqual({ mapReadFailed: true, status: 503, mapReadPath: mapReadPath(request.url) });
  expect(JSON.stringify(failure)).not.toContain("private");
  for (const status of [302, 400, 401, 403, 404, 429]) {
    const error = new Response(null, { status });
    await expect(readMapData(request, async () => { throw error; })).rejects.toBe(error);
  }
});

it("does not turn aborted or superseded requests into successful snapshots", async () => {
  const controller = new AbortController();
  const request = new Request("https://example.test/maps/ramen-detail", { signal: controller.signal });
  controller.abort();
  await expect(readMapData(request, async () => ({ places: [] }))).rejects.toMatchObject({ name: "AbortError" });
});

it("retains the last read within its owner scope and drops it on owner changes", () => {
  const previous = { scope: "member-a:/", data: { places: ["private-a"] }, path: "/?mode=now" };
  const failed = { mapReadFailed: true as const, status: 503, mapReadPath: "/?mode=taste" };
  expect(reconcileMapRead(previous, failed, previous.scope, failed.mapReadPath).data).toEqual(previous.data);
  expect(reconcileMapRead(previous, failed, "member-b:/", failed.mapReadPath).data).toBeNull();
  expect(reconcileMapRead(previous, previous.data, "member-b:/", "/", false).data).toBeNull();
});

it("refuses late data belonging to an older search", () => {
  const current = { scope: "member-a:/maps/a", data: { places: ["latest"] }, path: "/maps/a?q=latest" };
  const result = reconcileMapRead(current, { places: ["old"], mapReadPath: "/maps/a?q=old" }, current.scope, current.path);
  expect(result.data).toEqual(current.data);
  expect(result.failed).toBe(true);
});

it("keeps resource failure bound to the current token without caching or replaying", async () => {
  const request = new Request("https://example.test/resources/home-recommendations?requestToken=request-123");
  expect(await readMapResource(request, async () => { throw new Error("offline"); })).toEqual({ ok: false, requestToken: "request-123", message: "추천을 다시 불러오지 못했어요. 기존 결과를 유지합니다." });
  const forbidden = new Response(null, { status: 403 });
  await expect(readMapResource(request, async () => { throw forbidden; })).rejects.toBe(forbidden);
});

it("keeps the map shell only for same-path GET filter changes", () => {
  for (const pathname of ["/", "/maps/ramen-detail"]) {
    const currentUrl = new URL(`https://example.test${pathname}?q=before`), nextUrl = new URL(`https://example.test${pathname}?q=after`);
    expect(keepMapShell({ currentUrl, nextUrl })).toBe(true);
    expect(keepMapShell({ currentUrl, nextUrl, formMethod: "GET" })).toBe(true);
    for (const formMethod of ["POST", "PATCH", "PUT", "DELETE"]) expect(keepMapShell({ currentUrl, nextUrl, formMethod })).toBe(false);
    expect(keepMapShell({ currentUrl, nextUrl, actionStatus: 200 })).toBe(false);
    expect(keepMapShell({ currentUrl, nextUrl, actionResult: {} })).toBe(false);
    expect(keepMapShell({ currentUrl, nextUrl: currentUrl })).toBe(false);
  }
  for (const pathname of ["/login", "/me", "/admin", "/maps/one/two", "/signup"]) {
    expect(keepMapShell({ currentUrl: new URL(`https://example.test${pathname}?a=1`), nextUrl: new URL(`https://example.test${pathname}?a=2`) })).toBe(false);
  }
  expect(keepMapShell({ currentUrl: new URL("https://example.test/maps/one"), nextUrl: new URL("https://example.test/maps/two?q=next") })).toBe(false);
});
