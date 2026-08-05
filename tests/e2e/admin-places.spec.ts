import { expect, test } from "@playwright/test";

test("admin can inspect places and receives row-specific CSV errors", async ({
  context, page,
}) => {
  await context.addCookies([{ name: "retaste_session", value: "qa-admin-session", url: "http://127.0.0.1:5173" }]);
  await page.goto("/admin/places");

  await expect(page).toHaveURL(/\/admin\/places$/);
  await expect(page.getByRole("heading", { name: "장소 관리" })).toBeVisible();
  await expect(page.getByText("Re:Taste 샘플 라멘 동명")).toBeVisible();

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
