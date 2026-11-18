import { expect, test, type Page } from "@playwright/test";

test.skip(Boolean(process.env.BASE_URL) && !/https?:\/\/(127\.0\.0\.1|localhost)(:|\/)/.test(process.env.BASE_URL), "Geolocation policy regression runs only on the local QA map");

async function openLocalMap(page: Page, origin: string) {
  const naverRequests: string[] = [];
  await page.route((url) => url.origin !== origin && url.protocol.startsWith("http"), async (route) => {
    if (/naver|pstatic/.test(new URL(route.request().url()).hostname)) naverRequests.push(route.request().url());
    await route.abort();
  });
  const response = await page.goto("/?view=browse&qa=location-permission");
  await expect(page.getByLabel("장소 지도")).toBeVisible();
  const list = page.getByRole("button", { name: "목록", exact: true });
  if (await list.isVisible()) await list.click();
  return { response: response!, naverRequests };
}

test("the real response policy permits a granted native location only after the locate button", async ({ page, context, baseURL }, testInfo) => {
  await context.grantPermissions(["geolocation"], { origin: new URL(baseURL!).origin });
  await context.setGeolocation({ latitude: 35.18, longitude: 126.9, accuracy: 20 });
  const { response, naverRequests } = await openLocalMap(page, new URL(baseURL!).origin);
  const policy = response.headers()["permissions-policy"];
  expect(new URL(page.url()).searchParams.get("locationSource")).not.toBe("gps");
  await page.getByRole("button", { name: /내 주변/ }).click();
  await testInfo.attach("actual-response-policy", { body: JSON.stringify({ permissionsPolicy: policy }), contentType: "application/json" });
  await expect.poll(() => new URL(page.url()).searchParams.get("locationSource")).toBe("gps");
  await expect.poll(() => new URL(page.url()).searchParams.get("bbox")).toBe("126.87500,35.16200,126.92500,35.19800");
  expect(policy).toBe("camera=(), microphone=(), payment=(), geolocation=(self)");
  expect(naverRequests).toEqual([]);
  await page.screenshot({ path: `docs/evidence/2026-11-18-location-granted-${testInfo.project.name}.png`, fullPage: true });
});

test("native permission denial keeps the existing map and explains how to retry", async ({ page, context, baseURL }, testInfo) => {
  const cdp = await context.newCDPSession(page);
  await cdp.send("Browser.setPermission", { permission: { name: "geolocation" }, setting: "denied", origin: new URL(baseURL!).origin });
  const { response, naverRequests } = await openLocalMap(page, new URL(baseURL!).origin);
  const before = new URL(page.url()).searchParams.get("bbox");
  await page.getByRole("button", { name: /내 주변/ }).click();
  await expect(page.getByRole("status")).toHaveText("위치 권한을 확인한 뒤 다시 시도해주세요.");
  const notice = await page.getByRole("status").boundingBox();
  const toggle = await page.locator(".home-curation-view-toggle").boundingBox();
  expect(notice).not.toBeNull();
  expect(toggle).not.toBeNull();
  expect(notice!.y).toBeGreaterThanOrEqual(toggle!.y + toggle!.height);
  expect(new URL(page.url()).searchParams.get("locationSource")).not.toBe("gps");
  expect(new URL(page.url()).searchParams.get("bbox")).toBe(before);
  expect(response.headers()["permissions-policy"]).toContain("geolocation=(self)");
  expect(naverRequests).toEqual([]);
  await page.screenshot({ path: `docs/evidence/2026-11-18-location-denied-${testInfo.project.name}.png`, fullPage: true });
});
