import { expect, test } from "@playwright/test";

test.skip(Boolean(process.env.BASE_URL) && !/https?:\/\/(127\.0\.0\.1|localhost)(:|\/)/.test(process.env.BASE_URL), "Authentication feedback tests only mutate synthetic local state");

test("login blocks repeat submission and announces a failed response without losing the email", async ({ page }, testInfo) => {
  let posts = 0;
  let release = () => {};
  const responseGate = new Promise<void>((resolve) => { release = resolve; });
  await page.route((url) => url.pathname === "/login.data", async (route) => {
    if (route.request().method() === "POST") { posts++; await responseGate; }
    await route.continue();
  });
  await page.goto("/login?returnTo=%2Fme");
  await page.getByLabel("이메일", { exact: true }).fill(`ux-missing-${testInfo.project.name}@example.test`);
  await page.getByLabel("비밀번호", { exact: true }).fill("not-a-real-account-password");
  const clicked = page.getByRole("button", { name: "로그인", exact: true }).click();
  try {
    await expect(page.getByRole("button", { name: "로그인 중…", exact: true })).toBeDisabled();
    await expect.poll(() => posts).toBe(1);
    await page.getByLabel("비밀번호", { exact: true }).press("Enter");
    expect(posts).toBe(1);
  } finally { release(); }
  await clicked;
  await expect(page.getByRole("alert")).toHaveText("이메일 또는 비밀번호가 올바르지 않습니다.");
  await expect(page.locator("#login-error")).toBeFocused();
  await expect(page.getByLabel("이메일", { exact: true })).toHaveValue(`ux-missing-${testInfo.project.name}@example.test`);
  await expect(page.getByRole("button", { name: "로그인", exact: true })).toBeEnabled();
  await page.screenshot({ path: `docs/evidence/2026-11-18-auth-login-${testInfo.project.name}.png`, fullPage: true });
});

test("password mail rate limiting leaves a focused error and an editable retry form", async ({ page, request }, testInfo) => {
  const email = `ux-reset-${testInfo.project.name}-${Date.now()}@example.test`;
  for (let index = 0; index < 3; index++) {
    const response = await request.post("/forgot-password", { form: { email } });
    expect(response.ok()).toBe(true);
  }
  await page.goto("/forgot-password");
  await page.getByLabel("이메일", { exact: true }).fill(email);
  await page.getByRole("button", { name: "재설정 메일 보내기", exact: true }).click();
  await expect(page.getByRole("alert")).toHaveText("요청이 너무 많습니다. 잠시 후 다시 시도해 주세요.");
  await expect(page.locator("#forgot-password-error")).toBeFocused();
  await expect(page.getByLabel("이메일", { exact: true })).toHaveValue(email);
  await expect(page.getByRole("button", { name: "재설정 메일 보내기", exact: true })).toBeEnabled();
  await page.getByLabel("이메일", { exact: true }).fill("another-synthetic@example.test");
  await page.screenshot({ path: `docs/evidence/2026-11-18-auth-reset-${testInfo.project.name}.png`, fullPage: true });
});
