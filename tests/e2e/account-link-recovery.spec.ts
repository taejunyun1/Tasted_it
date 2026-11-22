import { expect, test } from "@playwright/test";

test("missing and malformed verification links finish with a recovery action", async ({ page }, testInfo) => {
  for (const path of ["/verify-email", "/corrections/verify"]) {
    for (const fragment of ["", "#%E0%A4%A"]) {
      await page.goto(`${path}${fragment}`);
      await expect(page.getByRole("heading", { level: 1 })).toContainText("링크를 사용할 수 없습니다");
      await expect(page.getByText("링크를 확인하고 있습니다.", { exact: true })).toHaveCount(0);
    }
  }
  await page.screenshot({ path: `output/playwright/account-link-recovery-${testInfo.project.name}.png`, fullPage: true });
});

test("email verification keeps the requested place on the login recovery link", async ({ page }) => {
  const returnTo = "/places/sample-dongmyeong-ramen?from=map";
  await page.goto(`/verify-email?returnTo=${encodeURIComponent(returnTo)}`);
  await expect(page.getByRole("link", { name: "로그인으로", exact: true })).toHaveAttribute("href", `/login?returnTo=${encodeURIComponent(returnTo)}`);
  await page.goto("/verify-email?returnTo=https%3A%2F%2Fevil.test%2F");
  await expect(page.getByRole("link", { name: "로그인으로", exact: true })).toHaveAttribute("href", "/login");
});

test("email signup returns to the selected place after verification and login", async ({ context, page, baseURL }) => {
  const email = `link-ux-${crypto.randomUUID()}@example.test`;
  const password = `synthetic-${crypto.randomUUID()}`;
  const returnTo = "/places/sample-dongmyeong-ramen?from=map";
  await page.goto(`/signup?returnTo=${encodeURIComponent(returnTo)}`);
  await page.getByLabel("이름", { exact: true }).fill("링크 흐름 시험");
  await page.getByLabel("이메일", { exact: true }).fill(email);
  await page.getByLabel("비밀번호 · 10자 이상", { exact: true }).fill(password);
  await page.getByRole("checkbox", { name: /만 14세 이상/ }).check();
  await page.getByRole("button", { name: "인증 메일 받고 가입하기", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("인증 안내가 등록된 이메일로 전송됩니다.");
  const delivery = await context.request.get(`/__e2e/email?email=${encodeURIComponent(email)}`);
  expect(delivery.status()).toBe(200);
  const { html } = await delivery.json() as { html: string };
  const verification = html.match(/href="([^"]+)"/)![1]!;
  const url = new URL(verification);
  expect(url.origin).toBe(new URL(baseURL!).origin);
  expect(url.searchParams.get("returnTo")).toBe(returnTo);
  expect(url.searchParams.has("token")).toBe(false);
  expect(url.hash.length).toBeGreaterThan(1);
  await page.goto(verification);
  await expect(page.getByRole("heading", { name: "이메일 인증 완료", exact: true })).toBeVisible();
  await page.getByRole("link", { name: "로그인으로", exact: true }).click();
  await page.getByLabel("이메일", { exact: true }).fill(email);
  await page.getByLabel("비밀번호", { exact: true }).fill(password);
  await page.getByRole("button", { name: "로그인", exact: true }).click();
  await expect(page).toHaveURL(new URL(returnTo, baseURL).href);
});

test("password reset returns to the original place after a rejected submission", async ({ context, page, baseURL }, testInfo) => {
  test.skip(!baseURL || !["127.0.0.1", "localhost", "[::1]"].includes(new URL(baseURL).hostname), "Requires the local synthetic mailbox");
  const email = `reset-ux-${crypto.randomUUID()}@example.test`;
  const password = `synthetic-${crypto.randomUUID()}`;
  const mobile = testInfo.project.name === "mobile-chromium";
  const placePath = "/places/sample-dongmyeong-ramen";
  const returnTo = mobile ? `/places?${new URLSearchParams({ q: "라멘", bbox: "126.8,35.1,127,35.2", selected: "sample-place-1", place: placePath })}`
    : `${placePath}?from=map&selected=sample-place-1`;
  const destination = encodeURIComponent(returnTo);
  const capturedLink = async () => {
    const delivery = await context.request.get(`/__e2e/email?email=${encodeURIComponent(email)}`);
    expect(delivery.status()).toBe(200);
    const { html } = await delivery.json() as { html: string };
    return new URL(html.match(/href="([^"]+)"/)![1]!);
  };

  await page.goto("/signup");
  await page.getByLabel("이름", { exact: true }).fill("비밀번호 재설정 시험");
  await page.getByLabel("이메일", { exact: true }).fill(email);
  await page.getByLabel("비밀번호 · 10자 이상", { exact: true }).fill(password);
  await page.getByRole("checkbox", { name: /만 14세 이상/ }).check();
  await page.getByRole("button", { name: "인증 메일 받고 가입하기", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("인증 안내가 등록된 이메일로 전송됩니다.");
  await page.goto((await capturedLink()).href);
  await expect(page.getByRole("heading", { name: "이메일 인증 완료", exact: true })).toBeVisible();

  await page.goto("/login?returnTo=https%3A%2F%2Fevil.test%2F");
  await expect(page.getByRole("link", { name: "비밀번호 재설정", exact: true })).toHaveAttribute("href", "/forgot-password");
  await page.goto(`/login?returnTo=${destination}`);
  await page.getByRole("link", { name: "비밀번호 재설정", exact: true }).click();
  await expect(page).toHaveURL(`/forgot-password?returnTo=${destination}`);
  await page.getByLabel("이메일", { exact: true }).fill(email);
  await page.getByRole("button", { name: "재설정 메일 보내기", exact: true }).click();
  await expect(page.getByRole("status")).toHaveText("가입된 이메일이라면 비밀번호 재설정 안내를 전송했습니다.");

  const resetLink = await capturedLink();
  expect(resetLink.origin).toBe(new URL(baseURL!).origin);
  expect(resetLink.pathname).toBe("/reset-password");
  expect(resetLink.searchParams.get("returnTo")).toBe(returnTo);
  expect(resetLink.searchParams.has("token")).toBe(false);
  expect(resetLink.hash.length).toBeGreaterThan(1);
  await page.goto(resetLink.href);

  const newPassword = page.getByLabel("새 비밀번호 · 10자 이상", { exact: true });
  const save = page.getByRole("button", { name: "비밀번호 저장", exact: true });
  await newPassword.evaluate((field: HTMLInputElement) => { field.form!.noValidate = true; });
  await newPassword.fill("short");
  await save.click();
  await expect(page.getByRole("alert")).toHaveText("링크가 만료되었거나 비밀번호가 10자 미만입니다.");
  expect(new URL(page.url()).searchParams.get("returnTo")).toBe(returnTo);

  const changedPassword = `new-${password}`;
  await newPassword.fill(changedPassword);
  await save.click();
  await expect(page.getByRole("status")).toHaveText("새 비밀번호가 저장되었습니다.");
  await page.screenshot({ path: testInfo.outputPath("password-reset-continuation.png"), fullPage: true });
  await page.getByRole("link", { name: "로그인하기", exact: true }).click();
  await expect(page).toHaveURL(`/login?returnTo=${destination}`);
  await page.getByLabel("이메일", { exact: true }).fill(email);
  await page.getByLabel("비밀번호", { exact: true }).fill(changedPassword);
  await page.getByRole("button", { name: "로그인", exact: true }).click();
  await expect(page).toHaveURL(new URL(returnTo, baseURL).href);
  if (mobile) {
    const sheet = page.locator("dialog.place-detail-sheet:modal");
    await expect(sheet.getByRole("heading", { level: 2, name: "Re:Taste 샘플 라멘 동명" })).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath("after-reset-mobile-sheet.png"), fullPage: true });
  }

  await page.goto(resetLink.href);
  await newPassword.fill(password);
  await save.click();
  await expect(page.getByRole("alert")).toHaveText("링크가 만료되었거나 비밀번호가 10자 미만입니다.");
});
