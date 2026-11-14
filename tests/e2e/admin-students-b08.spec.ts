import { execFileSync } from "node:child_process";
import { expect, test } from "@playwright/test";

test.use({ javaScriptEnabled: false });
test.skip(Boolean(process.env.BASE_URL), "Only isolated local student fixtures are allowed.");
test.beforeEach(() => {
  execFileSync("pnpm", ["exec", "wrangler", "d1", "execute", "DB", "--local", "--config", "wrangler.e2e.jsonc", "--persist-to", ".wrangler/e2e-state", "--file", "scripts/seed-student-qa.sql"], { stdio: "pipe" });
  // This negative test must never inherit positive tests' local assurance.
  execFileSync("pnpm", ["exec", "wrangler", "d1", "execute", "DB", "--local", "--config", "wrangler.e2e.jsonc", "--persist-to", ".wrangler/e2e-state", "--command", "DELETE FROM admin_session_assurances WHERE session_id='qa-admin-session'"], { stdio: "pipe" });
});

test("student invitation preview works without JavaScript and requires recent authentication", async ({ context, page, baseURL }, info) => {
  await context.addCookies([{ name: "retaste_session", value: "qa-admin-session", url: baseURL! }]);
  const response = await page.goto("/admin/students");
  expect(response?.headers()["cache-control"]).toContain("no-store");
  expect(response?.headers()["vary"]).toContain("Cookie");
  await expect(page.getByRole("heading", { name: "학생 계정과 업무 배정", exact: true })).toBeVisible();
  const invalid = await context.request.post("/admin/students", {headers:{Origin:baseURL!,Accept:"text/html"},form:{intent:"invalid"},maxRedirects:0});
  expect(invalid.status()).toBe(400);
  expect(invalid.headers()["content-type"]).toContain("text/html");
  expect(invalid.headers()["cache-control"]).toContain("no-store");
  expect(invalid.headers()["vary"]).toContain("Cookie");

  await expect(page.getByText("좌석을 중지하면 연결된 학생의 작업 접근이 즉시 차단됩니다.", { exact: false })).toBeVisible();
  await expect(page.getByLabel("학생에게 전달할 초대 링크")).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath("student-management.png"), fullPage: true });

  await page.getByRole("button", { name: "학생 A 초대 발급 미리보기", exact: true }).click();
  await expect(page.getByRole("heading", { name: "학생 관리 변경 미리보기", exact: true })).toBeVisible();
  await expect(page.getByText("아직 변경되지 않았습니다.", { exact: false })).toBeVisible();
  await expect(page.getByText("초대 발급 예정", { exact: true })).toBeVisible();
  await expect(page.getByRole("region", {name:"학생 관리 변경 미리보기"}).getByRole("cell", {name:/학생 A/})).toBeVisible();
  await expect(page.getByLabel("학생에게 전달할 초대 링크")).toHaveCount(0);
  await expect(page.getByRole("link", { name: "관리자 재인증 후 돌아오기", exact: true })).toHaveAttribute("href", /returnTo=.*operation/);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath("student-preview.png"), fullPage: true });
  await page.getByRole("button", { name: "변경 확정", exact: true }).click();
  await expect(page).toHaveURL(/\/admin\/reauth\?returnTo=/);
  expect(decodeURIComponent(page.url())).toContain("/admin/students?operation=");
});
