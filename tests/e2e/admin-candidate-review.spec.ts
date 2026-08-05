import { expect, test } from "@playwright/test";

test.beforeEach(async ({ context }) => {
  await context.addCookies([{ name: "retaste_session", value: "qa-admin-session", url: "http://127.0.0.1:5173" }]);
});

test("admin filters candidates and sees automatic primary classification", async ({ page }) => {
  await page.goto("/admin/candidates");
  await page.getByRole("button", { name: /QA 양평해장국/ }).click();
  await expect(page.getByText("자동 분류 신뢰도 · 높음")).toBeVisible();
  await expect(page.getByRole("combobox").last()).toHaveValue("cat-gukbap");
  await expect(page.getByLabel("동네")).toHaveValue("운림동");
  await expect(page.getByText("보조 카테고리")).toHaveCount(0);

  await page.getByLabel("좌표").selectOption("missing");
  await page.getByRole("button", { name: "필터 적용" }).click();
  await expect(page.getByRole("heading", { name: "QA 카페봄" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "QA 양평해장국" })).toHaveCount(0);
  await expect(page.getByText("QA 폐업국밥")).toHaveCount(0);
});

test("bulk review only enables safe high-confidence candidates", async ({ page }) => {
  await page.goto("/admin/candidates/bulk");
  await expect(page.getByText("일괄 승인 가능").locator("..").getByText("1")).toBeVisible();
  await expect(page.getByRole("checkbox", { name: /QA 양평해장국/ })).toBeChecked();
  await expect(page.getByRole("checkbox", { name: /QA 스시하루/ })).toBeDisabled();
  await expect(page.getByRole("checkbox", { name: /QA 맛있는집/ })).toBeDisabled();
  await expect(page.getByRole("checkbox", { name: /QA 카페봄/ })).toBeDisabled();
  await expect(page.getByRole("checkbox", { name: /Re:Taste 샘플 라멘 동명/ })).toBeDisabled();
  await expect(page.getByText("기존 공개 장소와 중복")).toBeVisible();
});
