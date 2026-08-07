import { expect, test } from "@playwright/test";

function qaPath(search = "") {
  const params = new URLSearchParams(search);
  params.set("qa", `${Date.now()}-${Math.random()}`);
  return `/?${params.toString()}`;
}

test("a map pin opens a quick bottom sheet while preserving the explorer list", async ({ page }) => {
  await page.goto(qaPath());
  const map = page.getByLabel("장소 지도");
  await map.getByRole("button", { name: /음식점 \d+곳, 확대해서 보기$/ }).first().click();
  await expect(map).toHaveAttribute("data-map-zoom", "13");
  await map.getByRole("button", { name: /음식점 \d+곳, 확대해서 보기$/ }).first().click();
  await expect(map).toHaveAttribute("data-map-zoom", "15");
  const pin = page.getByRole("button", { name: /지도 핀$/ }).first();
  await expect(pin).toBeVisible();
  await expect(pin).toHaveAttribute("data-influence", /^(base|medium|high)$/);
  const placeName = (await pin.getAttribute("aria-label"))?.replace(/ 지도 핀$/, "");

  await pin.click();

  await expect(page).toHaveURL(/selected=/);
  await expect(pin).toHaveClass(/is-selected/);
  await expect(page.getByRole("complementary", { name: "장소 탐색" })).toBeVisible();
  await expect(page.getByRole("dialog", { name: `${placeName} 빠른 정보` })).toBeVisible();
  await expect(page.getByRole("heading", { name: placeName })).toBeVisible();
  await expect(page.getByRole("progressbar", { name: "추천 지표" })).toBeVisible();
  await expect(page.getByText("검수 완료", { exact: true }).last()).toBeVisible();
  await expect(page.getByRole("link", { name: "상세 보기" })).toBeVisible();
});

test("the explorer presents the local food atlas identity and verified places", async ({ page }) => {
  await page.goto(qaPath());

  const explorer = page.getByRole("complementary", { name: "장소 탐색" });
  await expect(explorer.getByText("GWANGJU · JEONNAM FOOD ATLAS")).toBeVisible();
  await expect(explorer.getByRole("heading", { name: "동네의 맛을 지도에서 찾기" })).toBeVisible();
  await expect(explorer.getByText("검수 완료", { exact: true }).first()).toBeVisible();
});

test("tags and status badges use a friendly rounded shape", async ({ page }) => {
  await page.goto(qaPath());

  const categoryRadius = await page.getByRole("complementary", { name: "장소 탐색" })
    .getByRole("button", { name: "전체", exact: true })
    .evaluate((element) => getComputedStyle(element).borderRadius);
  const verifiedRadius = await page.getByText("검수 완료", { exact: true }).first()
    .evaluate((element) => getComputedStyle(element).borderRadius);

  expect(Number.parseFloat(categoryRadius)).toBeGreaterThanOrEqual(12);
  expect(Number.parseFloat(verifiedRadius)).toBeGreaterThanOrEqual(12);
});

test("desktop keeps the explorer beside the map and gives the map priority", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "chromium");
  await page.goto(qaPath());

  const explorerBox = await page.getByRole("complementary", { name: "장소 탐색" }).boundingBox();
  const mapBox = await page.getByLabel("장소 지도").boundingBox();

  expect(explorerBox).not.toBeNull();
  expect(mapBox).not.toBeNull();
  expect(explorerBox!.width).toBeLessThanOrEqual(420);
  expect(explorerBox!.x + explorerBox!.width).toBeLessThanOrEqual(mapBox!.x + 1);
  expect(mapBox!.width).toBeGreaterThan(explorerBox!.width);
});

test("a list item opens the same detail and returning preserves filters", async ({ page }) => {
  await page.goto(qaPath());
  const result = page.getByRole("button", { name: /선택$/ }).first();
  await expect(result).toBeVisible();

  await result.click();
  await expect(page).toHaveURL(/selected=/);
  await expect(page.getByLabel("장소 지도")).toHaveAttribute("data-focused-place", /.+/);
  await expect(page.getByRole("complementary", { name: "장소 탐색" })).toBeVisible();
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(page.getByRole("progressbar", { name: "추천 지표" })).toBeVisible();
  await page.getByRole("button", { name: "빠른 정보 닫기" }).click();

  await expect(page).toHaveURL(/qa=/);
  await expect(page).not.toHaveURL(/selected=/);
  await expect(result).toBeVisible();
});

test("an unavailable selected place returns to the list", async ({ page }) => {
  await page.goto(qaPath("selected=missing-place"));

  await expect(page).not.toHaveURL(/selected=/);
  await expect(page.getByRole("complementary", { name: "장소 탐색" })).toBeVisible();
});

test("search input follows URL history", async ({ page }) => {
  await page.goto(qaPath("q=국밥"));
  const search = page.getByLabel("장소 검색");
  await expect(search).toHaveValue("국밥");

  await page.evaluate(() => {
    const next = new URL(location.href);
    next.searchParams.set("q", "라멘");
    history.pushState(null, "", next);
    window.dispatchEvent(new PopStateEvent("popstate"));
  });
  await expect(search).toHaveValue("라멘");

  await page.goBack();

  await expect(search).toHaveValue("국밥");
});

test("region groups keep the explorer list and map focus in sync", async ({ page }) => {
  await page.goto(qaPath());

  const districtGroup = page.getByRole("button", { name: /.+(?:구|시|군) \d+곳, 지도에서 보기$/ }).first();
  await expect(districtGroup).toBeVisible();
  const districtLabel = await districtGroup.getAttribute("data-region-label");
  expect(districtLabel).toBeTruthy();

  await districtGroup.click();

  await expect(page.getByLabel("장소 지도")).toHaveAttribute("data-focused-region", districtLabel!);
  await expect(page.getByRole("button", { name: /.+(?:동|읍|면|리|지구) \d+곳, 지도에서 보기$/ }).first()).toBeVisible();
});

test("an outside current location falls back to the default Gwangju area", async ({ page, context }) => {
  await context.grantPermissions(["geolocation"]);
  await context.setGeolocation({ latitude: 37.5665, longitude: 126.978, accuracy: 20 });
  await page.goto(qaPath());

  await page.getByRole("button", { name: /내 주변/ }).click();

  await expect(page.getByRole("status")).toHaveText("현재 위치는 전라남도 범위 밖에 있습니다.");
  await expect.poll(() => new URL(page.url()).searchParams.get("bbox"))
    .toBe("126.72000,35.03000,127.02000,35.25000");
  await expect(page.getByRole("complementary", { name: "장소 탐색" }).getByRole("button", { name: /선택$/ }).first()).toBeVisible();
});

test("mobile starts with the map panel collapsed", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "mobile-chromium");
  await page.goto(qaPath());

  await expect(page.getByRole("button", { name: "지도", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("button", { name: "목록", exact: true })).toHaveAttribute("aria-pressed", "false");
});

test("mobile overlays the explorer control on the full map", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "mobile-chromium");
  await page.goto(qaPath());

  const explorerBox = await page.getByRole("complementary", { name: "장소 탐색" }).boundingBox();
  const mapBox = await page.getByLabel("장소 지도").boundingBox();

  expect(explorerBox).not.toBeNull();
  expect(mapBox).not.toBeNull();
  expect(explorerBox!.x).toBeGreaterThan(mapBox!.x);
  expect(explorerBox!.x + explorerBox!.width).toBeLessThan(mapBox!.x + mapBox!.width);
  expect(explorerBox!.y).toBeGreaterThan(mapBox!.y);
});

test("mobile collapses the list when quick information opens and restores it on demand", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "mobile-chromium");
  await page.goto(qaPath());
  const explorer = page.getByRole("complementary", { name: "장소 탐색" });

  await page.getByRole("button", { name: "목록", exact: true }).click();
  await expect(explorer).toHaveAttribute("data-mobile-view", "list");
  await page.getByRole("button", { name: /선택$/ }).first().click();

  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(explorer).toHaveAttribute("data-mobile-view", "map");

  await page.getByRole("button", { name: "목록", exact: true }).click();
  await expect(explorer).toHaveAttribute("data-mobile-view", "list");
  await expect(page.getByRole("button", { name: /선택$/ }).first()).toBeVisible();
});

test("mobile detail sheet keeps the verified place context", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "mobile-chromium");
  await page.goto(qaPath());

  await page.getByRole("button", { name: "목록", exact: true }).click();
  await page.getByRole("button", { name: /선택$/ }).first().click();
  await page.getByRole("link", { name: "상세 보기" }).click();

  const detail = page.getByRole("dialog", { name: /상세 정보$/ });
  await expect(detail).toBeVisible();
  await expect(detail.getByText("검수 완료", { exact: true })).toBeVisible();
});
