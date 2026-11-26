import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";

test.skip(Boolean(process.env.BASE_URL), "신청·반려 시험은 격리한 로컬 합성 자료에서만 검증합니다.");
test.use({ javaScriptEnabled: false, serviceWorkers: "block" });

const rejectionHeading = "이전 신청은 승인되지 않았습니다.";

async function fillApplication(page: Page) {
  await page.getByLabel("맛집 선정 기준 의견서").fill(
    "광주 골목 식당을 직접 방문해 재료와 가격 대비 만족도를 기록합니다. 음식마다 같은 기준으로 맛과 재방문 의사를 함께 평가하겠습니다. ".repeat(2),
  );
  await page.getByLabel("직업 또는 활동 소개").fill("합성 시험용 지역 기록자");
  await page.getByLabel("취향 방향").fill("담백한 국물 요리");
  const specialty = page.locator('input[name="specialtySlugs"]').first();
  await specialty.press("Space");
  await expect(specialty).toBeChecked();
}

test("a rejected applicant sees the outcome and can reapply without receiving the internal note", async ({
  context, page, browser, baseURL,
}, testInfo) => {
  const applicantId = randomUUID();
  const applicantName = `합성 신청자 ${applicantId.slice(0, 8)}`;
  const applicantSession = randomUUID();
  const adminSession = randomUUID();
  const now = new Date().toISOString();
  const expiresAt = new Date(Date.now() + 10 * 60_000).toISOString();
  const adminNote = `관리자만 보는 반려 메모 ${applicantId.slice(0, 8)}`;
  const origin = new URL(baseURL!).origin;

  // Use separate synthetic sessions so another test's admin assurance cannot affect this run.
  execFileSync("pnpm", [
    "exec", "wrangler", "d1", "execute", "DB", "--local", "--config", "wrangler.e2e.jsonc",
    "--persist-to", ".wrangler/e2e-state", "--command", `
      INSERT INTO users (id,email,display_name,role,email_verified_at,created_at,updated_at)
      VALUES ('${applicantId}','${applicantId}@example.test','${applicantName}','USER','${now}','${now}','${now}');
      INSERT INTO sessions (id,user_id,expires_at,created_at)
      VALUES ('${applicantSession}','${applicantId}','${expiresAt}','${now}'),
             ('${adminSession}','qa-admin','${expiresAt}','${now}');
      INSERT INTO admin_session_assurances (session_id,actor_user_id,method,verified_at,expires_at)
      VALUES ('${adminSession}','qa-admin','PASSWORD','${now}','${expiresAt}');
    `,
  ], { stdio: "pipe" });
  if (testInfo.project.name === "mobile-chromium") await page.setViewportSize({ width: 320, height: 844 });
  await context.route("**/*", (route) =>
    new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
  await context.addCookies([{ name: "retaste_session", value: applicantSession, url: origin }]);
  await page.goto("/reviewer/apply");
  const rejection = page.getByRole("heading", { name: rejectionHeading, exact: true });
  const receipt = page.getByRole("heading", { name: "신청이 접수됐습니다.", exact: true });
  await expect(rejection).toHaveCount(0);
  await fillApplication(page);
  await page.getByRole("button", { name: "리뷰어 신청 제출", exact: true }).press("Enter");
  await expect(receipt).toBeVisible();

  const admin = await browser.newContext({ baseURL, javaScriptEnabled: false, serviceWorkers: "block" });
  try {
    await admin.route("**/*", (route) =>
      new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
    await admin.addCookies([{ name: "retaste_session", value: adminSession, url: origin }]);
    const adminPage = await admin.newPage();
    await adminPage.goto("/admin/reviewers?status=APPLIED");
    const form = adminPage.locator("form").filter({
      has: adminPage.getByRole("button", { name: "선택 신청 미리보기", exact: true }),
    });
    const applicant = form.getByRole("checkbox", { name: `${applicantName} 신청 선택`, exact: true });
    await applicant.press("Space");
    await expect(applicant).toBeChecked();
    await form.getByRole("combobox").selectOption("REJECT");
    await form.getByLabel("사유", { exact: true }).fill(adminNote);
    await form.getByRole("button", { name: "선택 신청 미리보기", exact: true }).press("Enter");
    await expect(adminPage.getByRole("heading", { name: "변경 미리보기", exact: true })).toBeVisible();
    await adminPage.getByRole("button", { name: "선택한 변경 확정", exact: true }).press("Enter");
    const adminReceipt = adminPage.getByRole("region", { name: "작업 영수증", exact: true });
    await expect(adminReceipt.getByText("요청 1명 · 반영 1명 · 제외 0명", { exact: true })).toBeVisible();
  } finally {
    await admin.close();
  }

  const result = await page.goto("/reviewer/apply");
  expect(result?.status()).toBe(200);
  expect(result?.headers()["cache-control"]).toContain("no-store");
  expect(await result?.text()).not.toContain(adminNote);
  await expect(rejection).toBeVisible();
  await expect(page.getByText("신청 내용을 보완해 다시 제출할 수 있습니다.", { exact: true })).toBeVisible();
  await expect(receipt).toHaveCount(0);
  await expect(page.getByLabel("맛집 선정 기준 의견서")).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("reviewer-application-rejected.png") });

  await fillApplication(page);
  await page.getByRole("button", { name: "리뷰어 재신청 제출", exact: true }).press("Enter");
  await expect(receipt).toBeVisible();
  await expect(rejection).toHaveCount(0);
  await expect(page.getByRole("button", { name: "리뷰어 재신청 제출", exact: true })).toHaveCount(0);
  await page.goto("/reviewer/apply");
  await expect(receipt).toBeVisible();
  await expect(rejection).toHaveCount(0);
  await expect(page.getByLabel("맛집 선정 기준 의견서")).toHaveCount(0);
});
