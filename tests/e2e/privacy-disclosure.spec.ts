import { expect, test } from "@playwright/test";

test("guest and reviewer data disclosure stays publicly readable and clearly marked as a review draft", async ({ page }, testInfo) => {
  expect((await page.goto("/privacy"))?.status()).toBe(200);
  const main = page.getByRole("main");
  await expect(main.getByRole("heading", { name: "Re:Taste 개인정보 처리방침", exact: true })).toBeVisible();
  await expect(main.locator(".legal-notice")).toContainText("출시 전 검토본");
  await expect(main.locator(".legal-notice")).toContainText("실제 운영자 연락처");
  await expect(main.getByRole("heading", { name: "2. 보유기간", exact: true })).toBeVisible();
  await expect(main.getByRole("link", { name: "/me", exact: true })).toHaveAttribute("href", "/me");
  await expect(main).toContainText("방문일, 방문 설명, 이해관계 신고");
  await expect(main).toContainText("승인되기 전에는 공개하지 않습니다");
  await expect(main).toContainText("방문 설명과 권리 확인을 위한 내부 설명은 공개하지 않습니다");
  await expect(main).toContainText("자유롭게 작성한 방문·사진·권리 설명과 이전 내용");
  await expect(main).toContainText("실패하면 삭제 대기 기록을 남겨 재시도");
  await expect(main).toContainText("운영자가 공개만 회수한 경우에는 검수를 위해 사진을 보존");
  const dimensions = await page.evaluate(() => ({ viewport: document.documentElement.clientWidth, content: document.documentElement.scrollWidth }));
  expect(dimensions.content).toBeLessThanOrEqual(dimensions.viewport + 1);
  await page.screenshot({ path: `docs/evidence/cst-reviewer-privacy-20261113/privacy-${testInfo.project.name}.png`, fullPage: true });
  expect((await page.goto("/terms"))?.status()).toBe(200);
  await expect(main.getByRole("heading", { name: "Re:Taste 이용약관", exact: true })).toBeVisible();
  await expect(main.locator(".legal-notice")).toContainText("출시 전 검토본");
  await expect(main).toContainText("기록을 계정에 연결하는 정보");
  await expect(main).toContainText("방문·권리 설명과 검수·변경 이력은 남을 수 있습니다");
  await expect(main).toContainText("실패하면 재시도합니다");
  const termsDimensions = await page.evaluate(() => ({ viewport: document.documentElement.clientWidth, content: document.documentElement.scrollWidth }));
  expect(termsDimensions.content).toBeLessThanOrEqual(termsDimensions.viewport + 1);
  await page.screenshot({ path: `docs/evidence/cst-reviewer-privacy-20261113/terms-${testInfo.project.name}.png`, fullPage: true });

});
