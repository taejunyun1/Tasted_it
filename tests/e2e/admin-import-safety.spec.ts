import { expect, test } from "@playwright/test";

test("admin CSV previews validated rows and requires recent authentication to commit", async ({ context, page }, testInfo) => {
  const base = process.env.BASE_URL ?? "http://127.0.0.1:5173";
  await context.addCookies([{ name: "retaste_session", value: "qa-admin-session", url: base }]);
  await page.goto("/admin/import");
  await expect(page.getByRole("heading", { name: "장소 CSV 가져오기" })).toBeVisible();
  const header = "name,slug,address,neighborhood,latitude,longitude,primary_category,status";
  const slug = `csv-${testInfo.project.name}-${Date.now()}`;
  await page.getByLabel("장소 CSV").setInputFiles({ name: "invalid.csv", mimeType: "text/csv", buffer: Buffer.from(`${header}\n검수 장소,${slug},광주 동구,동명동,invalid,126.9,ramen-detail,DRAFT`) });
  await page.getByRole("button", { name: "검증하기" }).click();
  await expect(page.getByText(/2행.*latitude/)).toBeVisible();
  await page.getByLabel("장소 CSV").setInputFiles({ name: "draft.csv", mimeType: "text/csv", buffer: Buffer.from(`${header}\n검수용 임시 장소,${slug},광주 동구,동명동,35.14,126.9,ramen-detail,DRAFT`) });
  await page.getByRole("button", { name: "검증하기" }).click();
  await expect(page.getByRole("heading", { name: "1개 장소 확인" })).toBeVisible();
  await expect(page.locator('input[name="operationId"]')).toHaveCount(1);
  await expect(page.locator('[name="csv"]')).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: `docs/evidence/admin-csv-p0-20261114/${testInfo.project.name}-preview.png`, fullPage: true });
  await page.getByRole("button", { name: "전체 반영하기" }).click();
  await expect(page.getByRole("link", { name: "관리자 재인증 후 계속" })).toBeVisible();
  expect((await page.request.get(`/places/${slug}`)).status()).toBe(404);
});
