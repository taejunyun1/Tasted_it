import { expect, test } from "@playwright/test";
import { isControlledLocalBaseUrl } from "./local-test-target";

test.skip(!isControlledLocalBaseUrl(), "Uses the isolated local place fixture only");
test("detail correction link retains its exact target without submitting mail", async ({ page }, testInfo) => {
  await page.goto("/places/sample-dongmyeong-ramen");
  const link = page.getByRole("link", { name: "이 장소 정보 정정 요청", exact: true });
  const target = new URL((await link.getAttribute("href"))!, page.url()).searchParams.get("placeId");
  expect(target).toBeTruthy();
  await link.click();
  await expect(page.getByRole("heading", { name: "장소 정보 정정·이의 제기" })).toBeVisible();
  await expect(page.locator('input[name="placeId"]')).toHaveValue(target!);
  await expect(page.getByText("선택한 장소:", { exact: false })).toContainText("Re:Taste 샘플 라멘 동명");
  await expect(page.getByText("이메일 링크 확인 후 접수되며 공개 정보는 관리자 검토 전 바뀌지 않습니다.", { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.locator('input[name="placeId"]')).toHaveValue(target!);
  await page.screenshot({ path: testInfo.outputPath("correction-target.png"), fullPage: true });
});
