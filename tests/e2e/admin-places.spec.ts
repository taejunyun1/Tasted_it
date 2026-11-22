import { expect, test } from "@playwright/test";
import { isControlledLocalBaseUrl } from "./local-test-target";

const emptyFixture = process.env.CST_ADMIN_PLACES_EMPTY_FIXTURE === "1";
test.skip(!isControlledLocalBaseUrl(), "Admin places requires a loopback Worker with a synthetic session.");

test("admin can inspect places and receives row-specific CSV errors", async ({
  baseURL, context, page,
}, testInfo) => {
  test.skip(emptyFixture, "Uses the populated fixture.");
  await context.addCookies([{ name: "retaste_session", value: "qa-admin-session", url: baseURL! }]);
  await page.goto("/admin/places");

  await expect(page).toHaveURL(/\/admin\/places$/);
  await expect(page.getByRole("heading", { name: "장소 관리" })).toBeVisible();
  const table = page.getByRole("table", { name: /^등록된 장소 목록/ });
  await expect(table.getByRole("columnheader", { name: "장소", exact: true })).toBeVisible();
  await expect(table.getByText("Re:Taste 샘플 라멘 동명")).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("admin-places-populated.png"), animations: "disabled" });

  await page.getByRole("link", { name: "CSV 가져오기" }).click();
  await page.getByLabel("장소 CSV").setInputFiles({
    name: "invalid.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(
      "name,slug,address,neighborhood,latitude,longitude,primary_category\n오류장소,error-place,광주광역시 동구,동명동,invalid,126.9,ramen",
    ),
  });
  await page.getByRole("button", { name: "검증하기" }).click();

  await expect(page.getByText(/2행.*latitude/)).toBeVisible();
});

test("admin can read the empty list and reach management actions without horizontal scrolling", async ({
  baseURL, context, page,
}, testInfo) => {
  // Apply only migrations and the synthetic admin session before running this case.
  test.skip(!emptyFixture, "Uses an isolated D1 fixture without any places.");
  if (testInfo.project.name === "mobile-chromium") await page.setViewportSize({ width: 320, height: 800 });
  await context.addCookies([{ name: "retaste_session", value: "qa-admin-session", url: baseURL! }]);
  await page.route((url) => url.origin !== new URL(baseURL!).origin && url.protocol.startsWith("http"), route => route.abort());
  const response = await page.goto("/admin/places");
  expect(response?.status()).toBe(200);

  const main = page.getByRole("main");
  await expect(main.getByRole("heading", { name: "장소 관리", exact: true })).toBeVisible();
  const empty = main.getByText("등록된 장소가 없습니다. 장소 검수 또는 CSV 가져오기에서 추가해 주세요.", { exact: true });
  await expect(empty).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("admin-places-empty.png"), animations: "disabled" });
  const textFits = await empty.evaluate(element => {
    const range = document.createRange();
    range.selectNodeContents(element);
    const right = Math.min(document.documentElement.clientWidth, element.closest(".overflow-x-auto")?.getBoundingClientRect().right ?? Infinity);
    return [...range.getClientRects()].every(rect => rect.left >= 0 && rect.right <= right + 1);
  });
  expect(textFits).toBe(true);
  await expect(main.getByRole("region", { name: "장소 목록 가로 스크롤" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "본문으로 건너뛰기" })).toHaveAttribute("href", "#main");
  await page.keyboard.press("Tab");
  await expect(page.getByRole("link", { name: "본문으로 건너뛰기" })).toBeFocused();
  await page.keyboard.press("Enter");
  await page.keyboard.press("Tab");
  await expect(main.getByRole("link", { name: "장소 검수", exact: true })).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(main.getByRole("link", { name: "CSV 가져오기", exact: true })).toBeFocused();
});
