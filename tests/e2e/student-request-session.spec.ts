import { execFileSync } from "node:child_process";
import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { hashPassword } from "../../app/features/auth/password.server";

const password = "synthetic-student-session-test";

for (const blockedStorage of [false, true]) {
  test(`restores a missing invitation from the original link with storage blocked=${blockedStorage}`, async ({ page: admin, context, browser, baseURL }, info) => {
    const invite = await invitation(admin, context, baseURL!);
    const studentContext = await browser.newContext({ baseURL, viewport: info.project.name === "webkit" ? { width: 390, height: 844 } : { width: 1280, height: 800 } });
    try {
      if (blockedStorage) await studentContext.addInitScript(() => { Object.defineProperty(window, "sessionStorage", { get() { throw new Error("storage blocked"); } }); });
      await studentContext.addCookies([{ name: "retaste_session", value: "qa-student-a-session", url: baseURL! }]);
      const page = await studentContext.newPage();
      await page.goto("/student/join");
      await expect(page.getByRole("heading", { name: "로그인 완료 · 학생 초대 연결이 필요합니다", exact: true })).toBeVisible();
      await page.screenshot({ path: info.outputPath("missing-invitation.png"), fullPage: true });
      await expect(page.getByLabel("받은 개인별 초대 링크", { exact: true })).toBeVisible({ timeout: 2000 });
      await page.getByLabel("받은 개인별 초대 링크", { exact: true }).fill(invite);
      await page.getByRole("button", { name: "초대 링크 확인", exact: true }).click();
      await expect(page.getByRole("heading", { name: "시험 학생 A 계정으로 참여", exact: true })).toBeVisible();
      expect(new URL(page.url()).hash).toBe("");
      expect(new URL(page.url()).search).toBe("");
      await expect(page.getByLabel("받은 개인별 초대 링크", { exact: true })).toHaveCount(0);
      await page.screenshot({ path: info.outputPath("invitation-restored.png"), fullPage: true });
      await page.getByRole("button", { name: "초대 수락하고 내 작업 열기", exact: true }).click();
      await expect(page.getByRole("heading", { name: "학생 A의 작업", exact: true })).toBeVisible();
    } finally { await studentContext.close(); }
  });
}

test.skip(Boolean(process.env.BASE_URL), "Only isolated local D1 is allowed.");
test.beforeEach(async () => {
  execFileSync("pnpm", ["exec", "wrangler", "d1", "execute", "DB", "--local", "--config", "wrangler.e2e.jsonc", "--persist-to", ".wrangler/e2e-state", "--file", "scripts/seed-student-qa.sql"], { stdio: "pipe" });
  const hashed = await hashPassword(password);
  // Derived base64 strings contain no SQL quotes; these rows are local fixtures.
  execFileSync("pnpm", ["exec", "wrangler", "d1", "execute", "DB", "--local", "--config", "wrangler.e2e.jsonc", "--persist-to", ".wrangler/e2e-state", "--command", `UPDATE users SET password_hash='${hashed.hash}', password_salt='${hashed.salt}' WHERE id='qa-student-a'`], { stdio: "pipe" });
});
async function invitation(admin: Page, context: BrowserContext, baseURL: string) {
  await context.addCookies([{ name: "retaste_session", value: "qa-admin-session", url: baseURL }]);
  await admin.goto("/admin/students");
  await admin.getByRole("button", { name: "학생 A 초대 발급", exact: true }).click();
  return admin.getByLabel("학생에게 전달할 초대 링크").inputValue();
}

test("records the real acceptance POST, redirect and following workspace session", async ({ page: admin, context, browser, baseURL }, info) => {
  const invite = await invitation(admin, context, baseURL!);
  const studentContext = await browser.newContext({ baseURL });
  try {
    await studentContext.addCookies([{ name: "retaste_session", value: "qa-student-a-session", url: baseURL! }]);
    const page = await studentContext.newPage();
    const requests: Array<{ path: string; method: string; origin?: string; hasSession: boolean }> = [];
    const pendingHeaders: Array<Promise<void>> = [];
    page.on("request", request => {
      const url = new URL(request.url());
      if (!url.pathname.startsWith("/student")) return;
      pendingHeaders.push(request.allHeaders().then(headers => {
        requests.push({ path: url.pathname, method: request.method(), origin: headers.origin, hasSession: (headers.cookie ?? "").includes("retaste_session=qa-student-a-session") });
      }));
    });
    await page.goto(invite);
    await expect(page.getByRole("heading", { name: "시험 학생 A 계정으로 참여", exact: true })).toBeVisible();
    const post = page.waitForResponse(response => response.request().method() === "POST" && new URL(response.url()).pathname.startsWith("/student/join"));
    await page.getByRole("button", { name: "초대 수락하고 내 작업 열기", exact: true }).click();
    const response = await post;
    expect([200, 202, 302]).toContain(response.status());
    await expect(page.getByRole("heading", { name: "학생 A의 작업", exact: true })).toBeVisible();
    const sentHeaders = await response.request().allHeaders();
    expect(sentHeaders.origin).toBe(baseURL);
    expect(sentHeaders.cookie).toContain("retaste_session=qa-student-a-session");
    await Promise.all(pendingHeaders);
    expect(requests.filter(r => r.method === "POST" || r.path.startsWith("/student")).every(r => r.hasSession)).toBe(true);
    expect((await studentContext.cookies()).find(c => c.name === "retaste_session")?.value).toBe("qa-student-a-session");
    await info.attach("sanitized-request-trace", { body: JSON.stringify({ status: response.status(), requests }, null, 2), contentType: "application/json" });
  } finally { await studentContext.close(); }
});

test("recovers the same invitation when the session disappears before the accept click", async ({ page: admin, context, browser, baseURL }, info) => {
  const invite = await invitation(admin, context, baseURL!);
  const studentContext = await browser.newContext({ baseURL });
  try {
    await studentContext.addCookies([{ name: "retaste_session", value: "qa-student-a-session", url: baseURL! }]);
    const page = await studentContext.newPage(); await page.goto(invite);
    await expect(page.getByRole("heading", { name: "시험 학생 A 계정으로 참여", exact: true })).toBeVisible();
    await studentContext.clearCookies();
    await page.getByRole("button", { name: "초대 수락하고 내 작업 열기", exact: true }).click();
    await expect(page).toHaveURL(`${baseURL}/login?returnTo=%2Fstudent%2Fjoin`);
    await page.getByLabel("이메일", { exact: true }).fill("qa-student-a@retaste.local");
    await page.getByLabel("비밀번호", { exact: true }).fill(password);
    await page.getByRole("button", { name: "로그인", exact: true }).click();
    await expect(page.getByRole("heading", { name: "시험 학생 A 계정으로 참여", exact: true })).toBeVisible();
    const signedIn = (await studentContext.cookies()).find(c => c.name === "retaste_session")!;
    expect(signedIn.value).not.toBe("qa-student-a-session");
    expect(signedIn.httpOnly).toBe(true);
    expect(signedIn.sameSite).toBe("Lax");
    await page.getByRole("button", { name: "초대 수락하고 내 작업 열기", exact: true }).click();
    await expect(page.getByRole("heading", { name: "학생 A의 작업", exact: true })).toBeVisible();
    expect((await studentContext.cookies()).find(c => c.name === "retaste_session")?.value).toBe(signedIn.value);
    await page.screenshot({ path: info.outputPath("session-recovered.png"), fullPage: true });
  } finally { await studentContext.close(); }
});
