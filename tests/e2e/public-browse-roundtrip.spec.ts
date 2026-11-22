import { expect, test } from "@playwright/test";

const bbox = "126.90,35.14,126.93,35.16";
const publicPlaces = ".discovery-grid > .place-card > a[aria-label]";
const mapPlaces = ".map-place-list button[aria-label]";

test.beforeEach(async ({ page }, info) => {
  await page.setViewportSize(info.project.name === "mobile-chromium"
    ? { width: 390, height: 844 } : { width: 1440, height: 900 });
  await page.route(/https:\/\/[^/]*(?:naver\.com|naver\.net|pstatic\.net)\//, route => route.abort());
});

test("a list with only a viewport opens the same public search and can return", async ({ page }, info) => {
  const start = `/places?${new URLSearchParams({ bbox })}`;
  await page.goto(start);
  const all = page.locator(publicPlaces);
  await expect(all.first()).toBeVisible();
  const listNames = await all.evaluateAll(links => links.map(link => link.getAttribute("aria-label")!.replace(/ 상세 보기$/u, "")).sort());
  expect(listNames.length).toBeGreaterThan(0);

  const mapLink = page.getByRole("link", { name: "지도에서 보기", exact: true });
  const target = new URL(await mapLink.getAttribute("href") ?? "", page.url());
  expect(target.searchParams.get("view")).toBe("browse");
  expect(target.searchParams.get("bbox")).toBe(bbox);
  await mapLink.click();
  const panel = page.getByRole("complementary", { name: "장소 탐색", exact: true });
  await expect(panel).toBeAttached();
  if (info.project.name === "mobile-chromium") {
    await panel.getByRole("button", { name: "목록", exact: true }).click();
  }
  const found = page.locator(mapPlaces);
  await expect(found).toHaveCount(listNames.length);
  expect(await found.evaluateAll(buttons => buttons.map(button => button.getAttribute("aria-label")!.replace(/ 선택$/u, "")).sort())).toEqual(listNames);
  await expect(panel.locator(".map-result-head strong")).toHaveText(String(listNames.length));
  await page.screenshot({ path: info.outputPath("browse-map.png") });

  const backToList = panel.getByRole("link", { name: "목록에서 보기", exact: true });
  await backToList.click();
  await expect(page).toHaveURL(url => url.pathname === "/places" && url.searchParams.get("bbox") === bbox);
  await expect(all).toHaveCount(listNames.length);
  expect(await all.evaluateAll(links => links.map(link => link.getAttribute("aria-label")!.replace(/ 상세 보기$/u, "")).sort())).toEqual(listNames);
  await page.screenshot({ path: info.outputPath("browse-list.png") });

  await page.goBack();
  await expect(page).toHaveURL(url => url.pathname === "/" && url.searchParams.get("view") === "browse" && url.searchParams.get("bbox") === bbox);
  await page.reload();
  await expect(found).toHaveCount(listNames.length);
});

test("a zero-result search stays empty through the map and can reset explicitly", async ({ page }, info) => {
  const query = "없는장소-cst-browse-roundtrip";
  await page.goto(`/places?${new URLSearchParams({ bbox, q: query, category: "ramen-detail" })}`);
  await expect(page.locator("#place-search-status")).toContainText("전체 0곳");
  await page.getByRole("link", { name: "지도에서 보기", exact: true }).click();
  const panel = page.getByRole("complementary", { name: "장소 탐색", exact: true });
  if (info.project.name === "mobile-chromium") {
    await panel.getByRole("button", { name: "목록", exact: true }).click();
  }
  await expect(panel.locator(".map-result-head strong")).toHaveText("0");
  await expect(page.locator(mapPlaces)).toHaveCount(0);
  await panel.getByRole("link", { name: "목록에서 보기", exact: true }).click();
  await expect(page).toHaveURL(url => url.pathname === "/places" && url.searchParams.get("q") === query
    && url.searchParams.get("category") === "ramen-detail" && url.searchParams.get("bbox") === bbox);
  await expect(page.locator("#place-search-status")).toContainText("전체 0곳");
  await page.getByRole("link", { name: "검색 조건 초기화", exact: true }).click();
  await expect(page).toHaveURL(url => url.pathname === "/places" && url.search === "");
  await expect(page.getByRole("textbox", { name: "장소 검색", exact: true })).toHaveValue("");
  await expect(page.locator(publicPlaces).first()).toBeVisible();
});
