import { expect, test, type Page, type TestInfo } from "@playwright/test";

async function list(page: Page, testInfo: TestInfo) {
  const url = String(testInfo.project.use.baseURL ?? "http://127.0.0.1:5173");
  await page.context().addCookies([{ name: "retaste_session", value: "qa-reviewer-member-session", url }]);
  await page.goto("/places?bbox=126.80,35.10,127.00,35.25");
  const links = page.locator("section.discovery-all").getByRole("link", { name: /상세 보기$/ });
  await expect(links.first()).toBeVisible();
  return links;
}

function dataPath(href: string) { return `${new URL(href, "https://example.test").pathname}.data`; }
function detailRead(url: URL, path: string) {
  return url.pathname === path && url.searchParams.getAll("_routes").some((routes) => routes.split(",").includes("routes/place-detail"));
}

test("changing sheet selection never displays the previous place while the new request waits", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const links = await list(page, testInfo);
  const firstName = (await links.nth(0).getAttribute("aria-label"))!.replace(/ 상세 보기$/, "");
  const secondName = (await links.nth(1).getAttribute("aria-label"))!.replace(/ 상세 보기$/, "");
  const secondPath = dataPath((await links.nth(1).getAttribute("href"))!);
  await links.nth(0).click();
  await expect(page.getByRole("dialog").getByRole("heading", { name: firstName, exact: true })).toBeVisible();
  await page.getByRole("button", { name: "상세 정보 닫기" }).click();

  let release!: () => void;
  const wait = new Promise<void>((resolve) => { release = resolve; });
  await page.route((url) => detailRead(url, secondPath), async (route) => { await wait; await route.continue(); });
  try {
    await links.nth(1).click();
    const sheet = page.getByRole("dialog");
    await expect(sheet.getByText("장소 정보를 불러오는 중…")).toBeVisible();
    await expect(sheet.getByRole("heading", { name: firstName, exact: true })).toHaveCount(0);
    release();
    await expect(sheet.getByRole("heading", { name: secondName, exact: true })).toBeVisible();
  } finally { release(); }
});

test("sheet read failure stays local and a user retry loads the place", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const links = await list(page, testInfo);
  const path = dataPath((await links.first().getAttribute("href"))!);
  const name = (await links.first().getAttribute("aria-label"))!.replace(/ 상세 보기$/, "");
  let requests = 0;
  await page.route((url) => detailRead(url, path), async (route) => {
    requests++;
    if (requests === 1) await route.fulfill({ status: 503, contentType: "text/plain", body: "synthetic temporary outage" });
    else await route.continue();
  });
  await links.first().click();
  const sheet = page.getByRole("dialog");
  await expect(sheet.getByRole("heading", { name: "장소 정보를 불러오지 못했어요." })).toBeVisible();
  const originalSheet = await sheet.elementHandle();
  expect(originalSheet).not.toBeNull();
  await expect(page.locator("section.discovery-all")).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("sheet-read-error-mobile.png"), animations: "disabled" });
  const beforeRetry = requests;
  await sheet.getByRole("button", { name: "다시 불러오기" }).click();
  await expect(page.getByRole("dialog").getByRole("heading", { name, exact: true })).toBeVisible();
  await expect.poll(() => originalSheet!.evaluate((dialog) => dialog.matches("dialog:modal")
    && dialog.contains(document.activeElement))).toBe(true);
  await sheet.getByRole("button", { name: "상세 정보 닫기" }).click();
  await expect(links.first()).toBeFocused();
  // The router may also revalidate the same read when its parent URL settles.
  expect(requests).toBeGreaterThan(beforeRetry);
});

test("lost save response locks resubmission until the current state is read", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const links = await list(page, testInfo);
  const path = dataPath((await links.first().getAttribute("href"))!);
  await links.first().click();
  const sheet = page.getByRole("dialog");
  const save = sheet.getByRole("button", { name: /맛집지도에 추가|맛집지도에서 빼기/ });
  await expect(save).toBeEnabled();
  let release!: () => void;
  const wait = new Promise<void>((resolve) => { release = resolve; });
  let posts = 0;
  await page.route((url) => url.pathname === path, async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    posts++;
    await wait;
    await route.abort("failed");
  });
  try {
    await save.click();
    await expect(sheet.getByRole("button", { name: "저장 중…" })).toBeDisabled();
    await expect.poll(() => posts).toBe(1);
    release();
    await expect(sheet.getByRole("alert")).toContainText("처리 결과를 확인하지 못했어요.");
    await expect(sheet.getByRole("button", { name: /맛집지도에 추가|맛집지도에서 빼기/ })).toHaveCount(0);
    await sheet.getByRole("alert").scrollIntoViewIfNeeded();
    await sheet.screenshot({ path: testInfo.outputPath("sheet-save-unknown-mobile.png"), animations: "disabled" });
    await sheet.getByRole("button", { name: "현재 상태 다시 확인" }).click();
    await expect(page.getByRole("dialog").getByRole("button", { name: /맛집지도에 추가|맛집지도에서 빼기/ })).toBeEnabled();
    await expect(page.getByRole("dialog").getByRole("alert")).toHaveCount(0);
    expect(posts).toBe(1);
  } finally { release(); }
});

test("a missing place during desktop navigation is identified without showing a successful detail", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const links = await list(page, testInfo);
  const path = dataPath((await links.first().getAttribute("href"))!);
  await page.route((url) => detailRead(url, path), async (route) => {
    const missing = new URL(route.request().url());
    missing.pathname = "/places/synthetic-missing-sheet-place.data";
    // Preserve the framework's actual 404 data format instead of treating an
    // undecodable plain-text response as a known not-found result.
    const response = await route.fetch({ url: missing.toString() });
    expect(response.status()).toBe(404);
    await route.fulfill({ response });
  });
  await links.first().click();
  await expect(page.getByRole("heading", { name: "이 장소를 찾을 수 없어요." })).toBeVisible();
  await expect(page.getByText("404 / UNAVAILABLE")).toBeVisible();
  await expect(page.getByRole("button", { name: "다시 불러오기" })).toHaveCount(0);
  await page.screenshot({ path: testInfo.outputPath("detail-missing-desktop.png"), fullPage: true });
});
