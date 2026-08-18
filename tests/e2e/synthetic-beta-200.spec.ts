import { expect, test } from "@playwright/test";

const enabled = process.env.SYNTHETIC_BETA === "1";
test.skip(!enabled, "Set SYNTHETIC_BETA=1 with the isolated synthetic persist-to. Default e2e uses week1 seeds.");

const SLUG_A = "synth-beta-gukbap-a";
const SLUG_B = "synth-beta-ramen-b";

function sessionCookie(n: number) {
  return {
    name: "retaste_session",
    value: `synth-session-${String(n).padStart(3, "0")}`,
    domain: "127.0.0.1",
    path: "/",
  };
}

test("tester 1 guest reads home and both synthetic details", async ({ page }) => {
  await page.goto("/");
  await page.goto("/places");
  await page.goto(`/places/${SLUG_A}`);
  await expect(page.getByRole("heading", { name: "Flavor Print" })).toBeVisible();
  await page.goto(`/places/${SLUG_B}`);
  await expect(page.getByRole("heading", { name: "Flavor Print" })).toBeVisible();
});

test("tester 2 member votes on place A", async ({ context, page }) => {
  await context.addCookies([sessionCookie(1)]);
  await page.goto(`/places/${SLUG_A}`);
  await page.getByRole("button", { name: "추천" }).click();
  await expect(page.getByText("이곳을 추천했어요.")).toBeVisible();
});

test("tester 3 member opens the suggestion form", async ({ context, page }) => {
  await context.addCookies([sessionCookie(51)]);
  await page.goto("/suggestions/new");
  await expect(page.getByRole("heading", { name: "새 장소 제안" })).toBeVisible();
});

test("tester 4 under-14 signup is 400 on the form", async ({ page }) => {
  await page.goto("/signup");
  await page.getByLabel("이름").fill("미성년");
  await page.getByLabel("이메일").fill("synth-under14@example.test");
  await page.getByLabel(/비밀번호/).fill("synthetic-pass-1");
  await page.getByRole("button", { name: "인증 메일 받고 가입하기" }).click();
  await expect(page.getByRole("alert")).toContainText("만 14세 이상만 가입할 수 있습니다.");
});

test("tester 5 member save toggles without opening admin", async ({ context, page }) => {
  await context.addCookies([sessionCookie(2)]);
  await page.goto(`/places/${SLUG_B}`);
  await page.getByRole("button", { name: "저장" }).click();
  await expect(page.getByRole("button", { name: "저장됨" })).toBeVisible();
});

test("viewer 1 GET-only sees Flavor Print and does not post", async ({ page }) => {
  await page.goto(`/places/${SLUG_A}`);
  await expect(page.getByRole("heading", { name: "Flavor Print" })).toBeVisible();
  await expect(page.getByRole("link", { name: "로그인하고 취향 남기기" })).toBeVisible();
});

test("viewer 2 GET places and map without session", async ({ page }) => {
  await page.goto("/places");
  await page.goto("/maps/gukbap-detail");
  await expect(page.getByText(/PLACES/)).toBeVisible();
});

test("viewer 3 GET legal pages and reviewer profile", async ({ page }) => {
  await page.goto("/privacy");
  await expect(page.getByRole("heading", { name: /개인정보 처리방침/ })).toBeVisible();
  await page.goto("/terms");
  await expect(page.getByRole("heading", { name: /이용약관/ })).toBeVisible();
  await page.goto("/reviewers/synth-reviewer-gukmul");
  await expect(page.getByRole("heading", { name: "합성 리뷰어 1" })).toBeVisible();
});
