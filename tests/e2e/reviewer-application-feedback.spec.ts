import { expect, test } from "@playwright/test";

test("application keeps input and announces and focuses validation errors without duplicate submission", async ({ context, page }, testInfo) => {
  const url = String(testInfo.project.use.baseURL);
  await context.addCookies([{ name: "retaste_session", value: "qa-reviewer-member-session", url }]);
  await page.goto("/reviewer/apply");
  await page.getByLabel("맛집 선정 기준 의견서").fill(" ".repeat(110));
  await page.getByLabel("직업 또는 활동 소개").fill("지역 기록자");
  await page.getByLabel("취향 방향").fill("담백한 국물 요리");
  const choice = page.locator('input[name="specialtySlugs"]').first();
  await choice.check();

  let release!: () => void;
  let submissions = 0;
  const blocked = new Promise<void>((resolve) => { release = resolve; });
  await page.route("**/reviewer/apply.data*", async (route) => {
    if (route.request().method() === "POST") {
      submissions += 1;
      await blocked;
    }
    await route.continue();
  });
  await page.getByRole("button", { name: "리뷰어 신청 제출", exact: true }).click();
  try {
    const pending = page.getByRole("button", { name: "신청을 제출하고 있어요…", exact: true });
    await expect(pending).toBeDisabled();
    await expect(page.locator('form[aria-busy="true"]')).toBeVisible();
    await expect.poll(() => submissions).toBe(1);
    await page.getByLabel("직업 또는 활동 소개").press("Enter");
    expect(submissions).toBe(1);
  } finally { release(); }

  await expect(page.getByRole("alert")).toHaveText("입력 항목을 확인하세요.");
  const statement = page.getByLabel("맛집 선정 기준 의견서");
  await expect(statement).toBeFocused();
  await expect(statement).toHaveAttribute("aria-invalid", "true");
  await expect(statement).toHaveAttribute("aria-describedby", /reviewer-statement-error/);
  await expect(choice).toBeChecked();
  await expect(page.getByLabel("직업 또는 활동 소개")).toHaveValue("지역 기록자");
  await expect(page.getByRole("button", { name: "리뷰어 신청 제출", exact: true })).toBeEnabled();
  await expect(page.getByText(/리뷰어 심사에 사용되며/)).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  expect(overflow).toBe(false);
  await page.screenshot({ path: `docs/evidence/2026-11-18-reviewer-application-${testInfo.project.name}.png`, fullPage: true });
});

test("footer links stay readable and touchable at desktop and narrow mobile widths", async ({ page }, testInfo) => {
  if (testInfo.project.name === "mobile-chromium") await page.setViewportSize({ width: 320, height: 844 });
  await page.goto("/reviewer/apply");
  const footer = page.locator(".site-footer");
  await footer.scrollIntoViewIfNeeded();
  for (const name of ["정보 정정", "개인정보 처리방침", "이용약관"]) {
    const link = footer.getByRole("link", { name, exact: true });
    const box = await link.boundingBox();
    expect(box?.height).toBeGreaterThanOrEqual(44);
    expect(await link.evaluate((node) => getComputedStyle(node).whiteSpace)).toBe("nowrap");
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)).toBe(false);
  await footer.screenshot({ path: `docs/evidence/2026-11-18-footer-${testInfo.project.name}.png` });
});
