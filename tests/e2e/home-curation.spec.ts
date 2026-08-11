import { expect, test } from "@playwright/test";

test.skip(Boolean(process.env.BASE_URL), "로컬 QA 시드가 있는 환경에서만 실행합니다.");

test("curated home shows five ranked places and preserves explicit browse", async ({ page }, testInfo) => {
  await page.goto("/?qa=1");

  const presentation = testInfo.project.name === "mobile-chromium"
    ? page.locator(".home-curation-sheet")
    : page.locator(".home-curation-panel");
  await expect(presentation.getByRole("heading", { name: "지금 갈 만한 5곳" })).toBeVisible();
  await expect(presentation.locator(".home-curation-card")).toHaveCount(5);
  await expect(presentation.locator(".home-curation-card").first()).toHaveAttribute("aria-pressed", "true");
  await expect(presentation).not.toContainText("QA 낮은 평가 제외");

  const reranked = page.waitForResponse((response) => (
    response.url().includes("/resources/home-recommendations.data")
    && new URL(response.url()).searchParams.get("mode") === "taste"
  ));
  await presentation.getByRole("button", { name: "내 취향" }).click();
  await expect((await reranked).status()).toBe(200);
  await expect(presentation.getByRole("button", { name: "내 취향" })).toHaveAttribute("aria-pressed", "true");
  await expect(presentation.locator(".home-curation-error")).toHaveCount(0);
  await presentation.locator(".home-curation-card").nth(1).click();
  await expect(presentation.locator(".home-curation-card").nth(1)).toHaveAttribute("aria-pressed", "true");

  if (testInfo.project.name === "mobile-chromium") {
    await expect(presentation).toHaveAttribute("data-snap", "half");
  }

  if (process.env.HOME_CURATION_EVIDENCE === "1") {
    await page.screenshot({ path: testInfo.outputPath(`home-curation-${testInfo.project.name}.png`), fullPage: true });
  }

  await presentation.getByRole("button", { name: "전체 지도" }).click();
  await expect(page.getByRole("button", { name: "추천 지도" })).toBeVisible();
  await expect(page.locator(".map-explorer-panel")).toBeVisible();
});
