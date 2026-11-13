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
  await expect(page.getByRole("heading", { name: "방문 리뷰 제출" })).toBeVisible();
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
  await expect(page.getByRole("heading", { name: "사진은 선택 사항이에요." })).toBeVisible();
  await expect(page.locator('input[name="photos"]')).toBeVisible();
  await expect(page.getByRole("button", { name: "Golden Pick 선택" })).toBeDisabled();
  await page.getByRole("button", { name: "다음: 확인" }).click();
  await expect(page.getByRole("heading", { name: "제출 전 한 번만 확인해 주세요" })).toBeVisible();
  const preview = page.locator(".reviewer-preview");
  await preview.getByLabel("방문일", { exact: true }).fill("2026-11-01");
  await preview.getByLabel("직접 확인한 방문 근거", { exact: true }).fill("합성 시험용 방문 근거입니다.");
  await preview.getByLabel("광고·협찬·이해관계", { exact: true }).selectOption("NONE");
  await page.getByRole("button", { name: "검수 요청", exact: true }).click();
  await expect(page.getByText("검수 요청 완료", { exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "내 제출 기록" })).toBeVisible();
  const row = page.locator(".reviewer-history-row").first();
  await expect(row).toContainText("추천");
  await expect(row).toContainText("검수 대기");
  const withdrawal = row.locator("form").filter({ has: page.locator('input[value="withdraw-review"]') });
  await withdrawal.getByLabel("철회 사유").fill("합성 시험 종료");
  await withdrawal.getByLabel("공개 중단과 사진 삭제를 확인했어요.").check();
  await withdrawal.getByRole("button", { name: "리뷰 철회·사진 삭제" }).click();
  await expect(page).toHaveURL(/notice=review-withdrawn/);
});
