import { expect, test } from "@playwright/test";

test("place detail explains the eight-vote threshold and rating groups", async ({ page }) => {
  await page.goto("/places/sample-dongmyeong-ramen");
  await expect(page.getByText(/표본 수집 중 · [0-7]\/8/)).toBeVisible();
  await expect(page.getByRole("heading", { name: "평가 구성" })).toBeVisible();
  await expect(page.getByText("일반 회원")).toBeVisible();
  await expect(page.getByText("리뷰어", { exact: true })).toBeVisible();
});

test("active reviewer can open the rating workspace", async ({ page }) => {
  await page.context().addCookies([{ name: "retaste_session", value: "qa-active-reviewer-session", domain: "127.0.0.1", path: "/" }]);
  await page.goto("/reviewer/ratings");
  await expect(page.getByRole("heading", { name: "방문 리뷰 발행" })).toBeVisible();
  await expect(page.getByText("1. 장소")).toBeVisible();
  await page.getByPlaceholder("다녀온 장소 검색").fill("샘플 라멘 동명");
  await page.getByRole("button", { name: /Re:Taste 샘플 라멘 동명/ }).click();
  await page.getByRole("button", { name: "다음: 평가" }).click();
  await page.getByRole("button", { name: "추천", exact: true }).click();
  await page.getByRole("button", { name: "다음: 맛 배지" }).click();
  await expect(page.getByRole("button", { name: "육수 농도 선명" })).toBeVisible();
  await page.getByRole("button", { name: "육수 농도 선명" }).click();
  await page.getByRole("button", { name: "면 익힘 알맞음" }).click();
  await expect(page.getByText("2/2 선택")).toBeVisible();
  await expect(page.getByRole("button", { name: "토핑 상태 좋음" })).toBeDisabled();
  await expect(page.getByText("2개 선택 완료 · 선택한 배지를 해제하면 바꿀 수 있어요.")).toBeVisible();
  await page.getByRole("button", { name: "다음: 사진·Golden" }).click();
  await expect(page.getByText("사진 저장 기능 준비 중")).toBeVisible();
  await expect(page.getByRole("button", { name: "Golden Pick 선택" })).toBeDisabled();
  await page.getByRole("button", { name: "다음: 확인" }).click();
  await expect(page.getByRole("heading", { name: "발행 전 한 번만 확인해 주세요" })).toBeVisible();
  await page.getByRole("button", { name: "리뷰 발행" }).click();
  await expect(page.getByText("발행 완료", { exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "최근 발행" })).toBeVisible();
  await expect(page.getByRole("article").filter({ hasText: "Re:Taste 샘플 라멘 동명" }).first()).toContainText("추천");
});
