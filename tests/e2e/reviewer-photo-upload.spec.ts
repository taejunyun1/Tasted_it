import { expect, test } from "@playwright/test";

function withExifApp1(jpeg: Buffer) {
  // Minimal APP1/Exif marker. A browser canvas re-encode must strip it before
  // this becomes a public reviewer photo.
  const app1 = Buffer.from([0xff, 0xe1, 0x00, 0x08, 0x45, 0x78, 0x69, 0x66, 0x00, 0x00]);
  return Buffer.concat([jpeg.subarray(0, 2), app1, jpeg.subarray(2)]);
}

const REVIEWER_SESSION = {
  name: "retaste_session",
  value: "qa-active-reviewer-session",
  domain: "127.0.0.1",
  path: "/",
};

async function completeReviewBeforePhotoStep(page: import("@playwright/test").Page) {
  await page.context().addCookies([REVIEWER_SESSION]);
  await page.goto("/reviewer/ratings");
  await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  await page.getByPlaceholder("다녀온 장소 검색").fill("샘플 라멘 동명");
  await page.getByRole("button", { name: /Re:Taste 샘플 라멘 동명/ }).click();
  await page.getByRole("button", { name: "다음: 평가" }).click();
  await page.getByRole("button", { name: "추천", exact: true }).click();
  await page.getByRole("button", { name: "다음: 맛 배지" }).click();
  await page.getByRole("button", { name: "육수 농도 선명" }).click();
  await page.getByRole("button", { name: "면 익힘 알맞음" }).click();
  await page.getByRole("button", { name: "다음: 사진·Golden" }).click();
}

test("reviewer publishes a prepared EXIF JPEG and everyone can load the metadata-free public image", async ({ page }, testInfo) => {
  await completeReviewBeforePhotoStep(page);
  const exifJpegFixture = withExifApp1(await page.screenshot({ type: "jpeg" }));
  expect(exifJpegFixture.includes(Buffer.from([0xff, 0xe1]))).toBe(true);

  await page.locator('input[name="photos"]').setInputFiles({
    name: "camera-original-1.jpg",
    mimeType: "image/jpeg",
    buffer: exifJpegFixture,
  });
  await expect(page.getByRole("status")).toContainText("1장 사진을 발행 준비했어요.");
  await page.locator('input[name="photos"]').setInputFiles({
    name: "camera-original-2.jpg",
    mimeType: "image/jpeg",
    buffer: exifJpegFixture,
  });
  await expect(page.getByRole("status")).toContainText("1장 사진을 발행 준비했어요.");
  await expect(page.getByRole("img", { name: "발행 전 사진 1" })).toBeVisible();

  // Replacing a choice revokes only discarded previews; the current photo still
  // renders and is the exact file sent during final publication.
  await page.getByRole("button", { name: "제거" }).click();
  await expect(page.getByRole("img", { name: "발행 전 사진 1" })).toBeHidden();

  await page.locator('input[name="photos"]').setInputFiles({
    name: "camera-original-final.jpg",
    mimeType: "image/jpeg",
    buffer: exifJpegFixture,
  });
  await expect(page.getByRole("img", { name: "발행 전 사진 1" })).toBeVisible();
  const removeBox = await page.getByRole("button", { name: "제거" }).boundingBox();
  expect(removeBox?.width).toBeGreaterThanOrEqual(44);
  expect(removeBox?.height).toBeGreaterThanOrEqual(44);

  await page.getByRole("button", { name: "다음: 확인" }).click();
  await page.getByRole("button", { name: "리뷰 발행" }).click();

  await expect(page).toHaveURL(/notice=review-with-photos-published/);
  await expect(page.getByRole("status")).toContainText("사진과 리뷰를 발행했어요.");
  const publicPhoto = page.locator('img[src^="/review-photos/"]').first();
  await expect(publicPhoto).toBeVisible();
  await expect(publicPhoto).toHaveJSProperty("complete", true);
  expect(await publicPhoto.evaluate((image: HTMLImageElement) => image.naturalWidth > 0)).toBe(true);
  const publicBytes = Buffer.from(await (await page.request.get(await publicPhoto.getAttribute("src") ?? "")).body());
  expect(publicBytes.includes(Buffer.from([0xff, 0xe1]))).toBe(false);

  const historyList = page.locator(".reviewer-history-list");
  await expect(historyList).toBeVisible();
  const historyRow = historyList.locator(".reviewer-history-row").first();
  const historyPlaceLink = historyRow.locator(".reviewer-history-place-link");
  await expect(historyPlaceLink).toHaveCount(1);
  await expect(historyPlaceLink).toHaveAttribute("href", /^\/places\/[^/]+$/);
  await expect(historyRow.locator("a")).toHaveCount(1);
  await expect(historyRow.locator("button, [role=button]")).toHaveCount(0);
  await expect(historyRow).toContainText("사진 1장");
  await expect(historyRow.locator(".reviewer-history-badges i")).toHaveCount(2);
  await expect(page.locator(".reviewer-history-rail")).toHaveCount(0);
  await expect(historyPlaceLink).toHaveCSS("cursor", "pointer");
  const historyPlaceLinkBox = await historyPlaceLink.boundingBox();
  expect(historyPlaceLinkBox?.height).toBeGreaterThanOrEqual(44);
  await page.screenshot({
    path: `docs/evidence/2026-08-13-reviewer-photo-upload-${testInfo.project.name}.png`,
    fullPage: true,
  });
  await historyPlaceLink.focus();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/places\//);
});

test("rejects a source that is too large before it tries to prepare or publish it", async ({ page }) => {
  await completeReviewBeforePhotoStep(page);
  await page.locator('input[name="photos"]').setInputFiles({
    name: "large-camera.jpg",
    mimeType: "image/jpeg",
    buffer: Buffer.alloc(12 * 1024 * 1024 + 1, 0),
  });

  await expect(page.locator(".reviewer-form-error")).toContainText("원본 사진 용량이 너무 커요.");
  await expect(page.getByRole("img", { name: "발행 전 사진 1" })).toBeHidden();
});

test("unsupported photo keeps the review in place and exposes an accessible retry message", async ({ page }) => {
  await completeReviewBeforePhotoStep(page);

  await page.locator('input[name="photos"]').setInputFiles({
    name: "not-an-image.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("not an image"),
  });

  await expect(page.locator(".reviewer-form-error")).toContainText("이 사진 형식은 지원하지 않아요.");
  await expect(page.locator(".app-toast--error")).toContainText("이 사진 형식은 지원하지 않아요.");
  await expect(page.locator('input[name="placeId"]')).toHaveValue("sample-place-1");
  await expect(page.getByRole("button", { name: "다음: 확인" })).toHaveCSS("cursor", "pointer");
  await expect(page.getByRole("button", { name: "Golden Pick 선택" })).toHaveCSS("cursor", "not-allowed");
});

test("double-clicking publish creates one review only", async ({ page }, testInfo) => {
  await completeReviewBeforePhotoStep(page);
  await page.getByRole("button", { name: "다음: 확인" }).click();
  const before = await page.locator(".reviewer-history article").count();

  await page.getByRole("button", { name: "리뷰 발행" }).dblclick();
  await expect(page).toHaveURL(/notice=review-published/);
  await expect(page.locator(".reviewer-history article")).toHaveCount(before + 1);

  // The newly published review is sorted first. A no-photo publication must
  // not reserve the thumbnail column or turn the row into a general action.
  const historyRow = page.locator(".reviewer-history-list .reviewer-history-row").first();
  await expect(historyRow).not.toHaveAttribute("data-has-photo");
  await expect(historyRow.locator(".reviewer-history-thumb")).toHaveCount(0);
  await expect(historyRow).toContainText("사진 없음");
  const historyPlaceLink = historyRow.locator(".reviewer-history-place-link");
  await expect(historyPlaceLink).toHaveCount(1);
  await expect(historyPlaceLink).toHaveAttribute("href", /^\/places\/[^/]+$/);
  await expect(historyRow.locator("a")).toHaveCount(1);
  await expect(historyRow.locator("button, [role=button]")).toHaveCount(0);

  const gridTemplateColumns = await historyRow.evaluate((row) => getComputedStyle(row).gridTemplateColumns);
  if (testInfo.project.name.includes("mobile")) {
    expect(gridTemplateColumns.trim().split(/\s+/)).toHaveLength(1);
  } else {
    expect(gridTemplateColumns).not.toMatch(/^44px\b/);
  }
});

test("reviewer can move through the review flow by keyboard", async ({ page }) => {
  await page.context().addCookies([REVIEWER_SESSION]);
  await page.goto("/reviewer/ratings");
  await page.getByPlaceholder("다녀온 장소 검색").fill("샘플 라멘 동명");
  await page.getByRole("button", { name: /Re:Taste 샘플 라멘 동명/ }).focus();
  await page.keyboard.press("Enter");
  const next = page.getByRole("button", { name: "다음: 평가" });
  await next.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { name: "이번 방문을 어떻게 판단했나요?" })).toBeVisible();
});
