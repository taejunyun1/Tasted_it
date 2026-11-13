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

async function fillVisitEvidence(page: import("@playwright/test").Page) {
  const preview = page.locator(".reviewer-preview");
  await preview.getByLabel("방문일", { exact: true }).fill("2026-11-01");
  await preview.getByLabel("직접 확인한 방문 근거", { exact: true }).fill("자동시험 합성 방문 기록입니다.");
  await preview.getByLabel("광고·협찬·이해관계", { exact: true }).selectOption("NONE");
}
async function fillPhotoRights(page: import("@playwright/test").Page) {
  await page.locator(".reviewer-workspace").getByLabel("사진 1 촬영일", { exact: true }).fill("2026-11-01");
  await page.locator(".reviewer-workspace").getByLabel("사진 1 이용권리", { exact: true }).selectOption("OWN_WORK");
  await page.locator(".reviewer-workspace").getByLabel("사진 1 권리 근거", { exact: true }).fill("직접 만든 자동시험 합성 이미지입니다.");
  await page.locator(".reviewer-workspace").getByLabel("사진 1 설명", { exact: true }).fill("합성 사진");
  await page.locator(".reviewer-workspace").getByLabel("사진 1의 불필요한 인물·차량번호·개인정보 노출을 확인했어요.").check();
}
async function withdrawSubmitted(page: import("@playwright/test").Page, row: import("@playwright/test").Locator) {
  const form = row.locator("form").filter({ has: page.locator('input[value="withdraw-review"]') });
  await form.getByLabel("철회 사유").fill("합성 시험 종료");
  await form.getByLabel("공개 중단과 사진 삭제를 확인했어요.").check();
  await form.getByRole("button", { name: "리뷰 철회·사진 삭제" }).click();
  await expect(page).toHaveURL(/notice=review-withdrawn/);
}

test("reviewer submits a metadata-free JPEG that remains private pending moderation", async ({ page }, testInfo) => {
  await completeReviewBeforePhotoStep(page);
  const exifJpegFixture = withExifApp1(await page.screenshot({ type: "jpeg" }));
  expect(exifJpegFixture.includes(Buffer.from([0xff, 0xe1]))).toBe(true);

  await page.locator('input[name="photos"]').setInputFiles({
    name: "camera-original-1.jpg",
    mimeType: "image/jpeg",
    buffer: exifJpegFixture,
  });
  await expect(page.getByRole("status")).toContainText("1장 사진을 제출 준비했어요.");
  await fillPhotoRights(page);
  await page.locator('input[name="photos"]').setInputFiles({
    name: "camera-original-2.jpg",
    mimeType: "image/jpeg",
    buffer: exifJpegFixture,
  });
  await expect(page.getByRole("status")).toContainText("1장 사진을 제출 준비했어요.");
  await expect(page.getByRole("img", { name: "제출 전 사진 1" })).toBeVisible();

  await expect(page.locator(".reviewer-workspace").getByLabel("사진 1 촬영일", { exact: true })).toHaveValue("");
  await expect(page.locator(".reviewer-workspace").getByLabel("사진 1 이용권리", { exact: true })).toHaveValue("");
  await expect(page.locator(".reviewer-workspace").getByLabel("사진 1의 불필요한 인물·차량번호·개인정보 노출을 확인했어요.")).not.toBeChecked();

  // Replacing a choice revokes only discarded previews; the current photo still
  // renders and is the exact file sent during final publication.
  await page.getByRole("button", { name: "제거" }).click();
  await expect(page.getByRole("img", { name: "제출 전 사진 1" })).toBeHidden();

  await page.locator('input[name="photos"]').setInputFiles({
    name: "camera-original-final.jpg",
    mimeType: "image/jpeg",
    buffer: exifJpegFixture,
  });
  await expect(page.getByRole("img", { name: "제출 전 사진 1" })).toBeVisible();
  const removeBox = await page.getByRole("button", { name: "제거" }).boundingBox();
  expect(removeBox?.width).toBeGreaterThanOrEqual(44);
  expect(removeBox?.height).toBeGreaterThanOrEqual(44);

  await fillPhotoRights(page);
  await page.getByRole("button", { name: "다음: 확인" }).click();
  await fillVisitEvidence(page);
  await page.getByRole("button", { name: "검수 요청", exact: true }).click();

  await expect(page).toHaveURL(/notice=review-with-photos-submitted/);
  await expect(page.getByRole("status")).toContainText("사진과 리뷰를 검수 요청했어요.");
  const publicPhoto = page.locator('img[src^="/review-photos/"]').first();
  await expect(publicPhoto).toBeVisible();
  await expect(publicPhoto).toHaveJSProperty("complete", true);
  expect(await publicPhoto.evaluate((image: HTMLImageElement) => image.naturalWidth > 0)).toBe(true);
  const publicBytes = Buffer.from(await (await page.request.get(await publicPhoto.getAttribute("src") ?? "")).body());
  expect(publicBytes.includes(Buffer.from([0xff, 0xe1]))).toBe(false);
  const anonymous = await page.context().browser()!.newContext();
  const publicPath = new URL(await publicPhoto.getAttribute("src") ?? "", page.url()).pathname;
  expect((await anonymous.request.get(new URL(publicPath, page.url()).href)).status()).toBe(404);
  await anonymous.close();

  const historyList = page.locator(".reviewer-history-list");
  await expect(historyList).toBeVisible();
  const historyRow = historyList.locator(".reviewer-history-row").first();
  const historyPlaceLink = historyRow.locator(".reviewer-history-place-link");
  await expect(historyPlaceLink).toHaveCount(1);
  await expect(historyPlaceLink).toHaveAttribute("href", /^\/places\/[^/]+$/);
  await expect(historyRow.locator("a")).toHaveCount(1);
  await expect(historyRow.getByText("내용 보완·다시 제출", { exact: true })).toBeVisible();
  await expect(historyRow).toContainText("사진 1장");
  await expect(historyRow.locator(".reviewer-history-badges i")).toHaveCount(2);
  await expect(page.locator(".reviewer-history-rail")).toHaveCount(0);
  await expect(historyPlaceLink).toHaveCSS("cursor", "pointer");
  const historyPlaceLinkBox = await historyPlaceLink.boundingBox();
  expect(historyPlaceLinkBox?.height).toBeGreaterThanOrEqual(44);
  await page.screenshot({
    path: testInfo.outputPath("reviewer-private-photo.png"),
    fullPage: true,
  });
  const target = await historyPlaceLink.getAttribute("href");
  await withdrawSubmitted(page, historyRow);
  await page.goto(target!);
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
  await expect(page.getByRole("img", { name: "제출 전 사진 1" })).toBeHidden();
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

test("double-clicking submit creates one pending review only", async ({ page }, testInfo) => {
  await completeReviewBeforePhotoStep(page);
  await page.getByRole("button", { name: "다음: 확인" }).click();
  await fillVisitEvidence(page);
  const beforeIds = await page.locator(".reviewer-history article").evaluateAll((rows) => rows.map((row) => row.id));

  await page.getByRole("button", { name: "검수 요청", exact: true }).dblclick();
  await expect(page).toHaveURL(/notice=review-submitted/);
  const afterIds = await page.locator(".reviewer-history article").evaluateAll((rows) => rows.map((row) => row.id));
  expect(afterIds.filter((id) => !beforeIds.includes(id))).toHaveLength(1);

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
  await expect(historyRow.getByText("내용 보완·다시 제출", { exact: true })).toBeVisible();

  const gridTemplateColumns = await historyRow.evaluate((row) => getComputedStyle(row).gridTemplateColumns);
  if (testInfo.project.name.includes("mobile")) {
    expect(gridTemplateColumns.trim().split(/\s+/)).toHaveLength(1);
  } else {
    expect(gridTemplateColumns).not.toMatch(/^44px\b/);
  }
  await withdrawSubmitted(page, historyRow);
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

test("choosing a different place clears the previous visit and photo declarations", async ({ page }) => {
  await completeReviewBeforePhotoStep(page);
  await page.locator('input[name="photos"]').setInputFiles({ name: "synthetic.jpg", mimeType: "image/jpeg", buffer: await page.screenshot({ type: "jpeg" }) });
  await expect(page.getByRole("img", { name: "제출 전 사진 1" })).toBeVisible();
  await fillPhotoRights(page);
  await page.getByRole("button", { name: "다음: 확인" }).click();
  await fillVisitEvidence(page);
  await page.getByRole("button", { name: "1. 장소", exact: true }).click();
  await page.getByPlaceholder("다녀온 장소 검색").fill("샘플 라멘 전대");
  await page.getByRole("button", { name: /Re:Taste 샘플 라멘 전대/ }).click();
  const workspace = page.locator(".reviewer-workspace");
  await expect(workspace.locator('input[name="placeId"]')).toHaveValue("sample-place-5");
  await expect(workspace.locator('input[name="evaluation"]')).toHaveValue("");
  await expect(workspace.locator(".reviewer-photo-list img")).toHaveCount(0);
  await expect(workspace.locator('input[name="visitedOn"]')).toHaveValue("");
  await expect(workspace.locator('textarea[name="visitNote"]')).toHaveValue("");
  await expect(workspace.locator('select[name="disclosure"]')).toHaveValue("");
});
