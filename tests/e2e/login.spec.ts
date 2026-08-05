import { expect, test } from "@playwright/test";

test("beta user logs in and external return targets are ignored", async ({
  page,
}, testInfo) => {
  await page.goto("/login?returnTo=https://evil.example/path");
  await page.getByLabel("이메일").fill(`user-${testInfo.project.name}@example.com`);
  await page.getByLabel("표시 이름").fill("베타 사용자");
  await page.getByRole("button", { name: "베타 로그인" }).click();

  await expect(page).toHaveURL("http://127.0.0.1:5173/");
});

test("normal user receives 403 from the admin place route", async ({
  page,
}, testInfo) => {
  await page.goto("/login");
  await page
    .getByLabel("이메일")
    .fill(`forbidden-${testInfo.project.name}@example.com`);
  await page.getByLabel("표시 이름").fill("일반 사용자");
  await page.getByRole("button", { name: "베타 로그인" }).click();
  await expect(page).toHaveURL("http://127.0.0.1:5173/");

  const response = await page.request.get("/admin/places", {
    maxRedirects: 0,
  });
  expect(response.status()).toBe(403);
});
