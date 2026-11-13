import { expect, test, type BrowserContext, type Page } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  // 방문 검수 시험은 외부 지도 공급자를 호출하지 않는다.
  await page.route("https://oapi.map.naver.com/**", (route) => route.abort());
});

async function signIn(context: BrowserContext, session: string) {
  await context.addCookies([{ name: "retaste_session", value: session, domain: "127.0.0.1", path: "/" }]);
}
async function visitEvidence(page: Page, scope = page.locator(".reviewer-preview")) {
  await scope.getByLabel("방문일", { exact: true }).fill("2026-11-01");
  await scope.getByLabel("직접 확인한 방문 근거", { exact: true }).fill("합성 시험 자료: 직접 방문해 라멘과 제공 상황을 확인했습니다.");
  await scope.getByLabel("광고·협찬·이해관계", { exact: true }).selectOption("NONE");
}
async function createPendingVisit(page: Page) {
  await page.goto("/reviewer/ratings");
  await page.getByPlaceholder("다녀온 장소 검색").fill("샘플 라멘 동명");
  await page.getByRole("button", { name: /Re:Taste 샘플 라멘 동명/ }).click();
  await page.getByRole("button", { name: "다음: 평가" }).click();
  await page.getByRole("button", { name: "추천", exact: true }).click();
  await page.getByRole("button", { name: "다음: 맛 배지" }).click();
  await page.getByRole("button", { name: "육수 농도 선명" }).click();
  await page.getByRole("button", { name: "다음: 사진·Golden" }).click();
  const image = await page.screenshot({ type: "jpeg" });
  await page.locator('input[name="photos"]').setInputFiles({ name: "synthetic-visit.jpg", mimeType: "image/jpeg", buffer: image });
  await expect(page.getByRole("img", { name: "제출 전 사진 1" })).toBeVisible();
  await page.locator(".reviewer-workspace").getByLabel("사진 1 촬영일", { exact: true }).fill("2026-11-01");
  await page.locator(".reviewer-workspace").getByLabel("사진 1 이용권리", { exact: true }).selectOption("OWN_WORK");
  await page.locator(".reviewer-workspace").getByLabel("사진 1 권리 근거", { exact: true }).fill("자동시험을 위해 직접 생성한 합성 이미지입니다.");
  await page.locator(".reviewer-workspace").getByLabel("사진 1 설명", { exact: true }).fill("승인 흐름 검증용 합성 사진");
  await page.locator(".reviewer-workspace").getByLabel("사진 1의 불필요한 인물·차량번호·개인정보 노출을 확인했어요.").check();
  await page.getByRole("button", { name: "다음: 확인" }).click();
  await visitEvidence(page);
  await page.getByRole("button", { name: "검수 요청", exact: true }).click();
  await expect(page).toHaveURL(/notice=review-with-photos-submitted/);
  await expect(page.getByText("검수 요청 완료", { exact: true })).toBeVisible();
  const id = new URL(page.url()).searchParams.get("submitted");
  expect(id).toBeTruthy();
  return id!;
}

// Uses only isolated local fixtures. Technical evidence is separate from user studies.
test("submission approval, owner correction and admin withdrawal govern the same public visit and photo", async ({ browser, page, context }, testInfo) => {
  await signIn(context, "qa-active-reviewer-session");
  const reviewId = await createPendingVisit(page);
  const ownRow = page.locator(`#review-${reviewId}`);
  await expect(ownRow).toContainText("검수 대기");
  const previewUrl = await ownRow.locator(".reviewer-history-thumb").getAttribute("src");
  expect(previewUrl).toContain("preview=1");
  const publicUrl = new URL(previewUrl!, page.url()).pathname;
  const contextOptions = {
    baseURL: String(testInfo.project.use.baseURL), viewport: page.viewportSize(),
    isMobile: testInfo.project.name.includes("mobile"), hasTouch: testInfo.project.name.includes("mobile"),
    userAgent: await page.evaluate(() => navigator.userAgent),
    deviceScaleFactor: await page.evaluate(() => window.devicePixelRatio),
  };
  const anon = await browser.newContext(contextOptions);
  const admin = await browser.newContext(contextOptions);
  await signIn(admin, "qa-admin-session");
  const publicPage = await anon.newPage();
  const adminPage = await admin.newPage();
  try {
    expect((await anon.request.get(publicUrl)).status()).toBe(404);
    expect((await anon.request.head(publicUrl)).status()).toBe(404);
    expect((await anon.request.get(previewUrl!)).status()).toBe(404);
    await publicPage.goto("/reviewers/qa-gukmul-reviewer");
    await expect(publicPage.getByText("공개 승인된 방문 자료가 아직 없어요.")).toBeVisible();
    const denied = await context.request.post("/admin/reviewer-visits", { form: { reviewId, expectedVersion: "1", status: "APPROVED", reason: "권한 없는 요청" }, headers: { Origin: new URL(page.url()).origin } });
    expect(denied.status()).toBe(403);

    await page.screenshot({ path: testInfo.outputPath("owner-pending.png"), fullPage: true });
    let checkedApprovalRetry = false;
    async function moderate(status: "APPROVED" | "CHANGES_REQUESTED" | "WITHDRAWN", reason: string) {
      await adminPage.goto("/admin/reviewer-visits?status=ALL");
      const card = adminPage.locator(`#moderation-${reviewId}`);
      await card.getByLabel("검수 사유").fill(reason);
      if (status === "APPROVED" && !checkedApprovalRetry) {
        await card.getByRole("button", { name: "승인·공개", exact: true }).click();
        await expect(card.getByRole("alert")).toContainText("방문·권리·개인정보·장소 확인을 모두 마쳐 주세요.");
        await expect(card.getByLabel("검수 사유")).toHaveValue(reason);
        await expect(card.locator(".reviewer-moderation-status")).toHaveText("검수 대기");
        checkedApprovalRetry = true;
      }
      if (status === "APPROVED") for (const name of ["visitVerified", "rightsVerified", "privacyVerified", "placeVerified"]) await card.locator(`input[name="${name}"]`).check();
      await card.getByRole("button", { name: status === "APPROVED" ? "승인·공개" : status === "CHANGES_REQUESTED" ? "보완 요청" : "공개 회수", exact: true }).click();
      await expect(card.locator(".reviewer-moderation-status")).toHaveText(status === "APPROVED" ? "승인됨" : status === "CHANGES_REQUESTED" ? "보완 요청" : "공개 회수·철회");
    }
    await moderate("CHANGES_REQUESTED", "합성 검수: 방문 근거를 더 구체적으로 보완해 주세요.");
    await page.reload();
    await expect(ownRow).toContainText("보완 요청");
    await expect(ownRow).toContainText("방문 근거를 더 구체적으로");
    async function editVisit(reason: string, checkRetry = false) {
      await ownRow.getByText("내용 보완·다시 제출", { exact: true }).click();
      const edit = ownRow.locator('form').filter({ has: page.locator('input[value="edit-review"]') });
      await edit.getByLabel("직접 확인한 방문 근거", { exact: true }).fill(`합성 시험 자료: ${reason}`);
      await edit.getByLabel("수정 사유").fill(reason);
      if (checkRetry) {
        for (const badge of ["육수 농도 선명", "면 익힘 알맞음", "토핑 상태 좋음"]) await edit.getByLabel(badge, { exact: true }).check();
        await edit.getByRole("button", { name: "수정하고 검수 요청" }).click();
        await expect(edit.getByRole("alert")).toContainText("맛 배지는 최대 2개까지 선택해 주세요.");
        await expect(edit.getByLabel("수정 사유")).toHaveValue(reason);
        await expect(edit.getByLabel("직접 확인한 방문 근거", { exact: true })).toHaveValue(`합성 시험 자료: ${reason}`);
        await edit.getByLabel("토핑 상태 좋음", { exact: true }).uncheck();
      }
      await edit.getByRole("button", { name: "수정하고 검수 요청" }).click();
      await expect(page).toHaveURL(/notice=review-updated/);
      await expect(ownRow).toContainText("검수 대기");
    }
    await editVisit("직접 확인한 방문 근거를 보완했습니다.", true);
    await moderate("APPROVED", "합성 검수: 방문·권리·개인정보·장소 확인 완료.");
    const stale = await admin.request.post("/admin/reviewer-visits", { form: { reviewId, expectedVersion: "1", status: "APPROVED", reason: "오래된 버전 재승인" }, headers: { Origin: new URL(page.url()).origin } });
    expect(stale.status()).toBe(409);
    const crossOrigin = await admin.request.post("/admin/reviewer-visits", { form: { reviewId, expectedVersion: "1", status: "WITHDRAWN", reason: "외부 출처 요청" }, headers: { Origin: "https://elsewhere.invalid" } });
    expect(crossOrigin.status()).toBe(403);
    const approved = await anon.request.get(publicUrl);
    expect(approved.status()).toBe(200);
    expect(approved.headers()["cache-control"]).toContain("no-store");
    await publicPage.reload();
    const publicHtml = await publicPage.content();
    expect(publicHtml).not.toContain("qa-active-reviewer");
    expect(publicHtml).not.toContain("자동시험을 위해 직접 생성한 합성 이미지입니다.");
    expect(publicHtml).not.toContain("직접 확인한 방문 근거를 보완했습니다.");
    const publicVisit = publicPage.locator(".reviewer-public-visit");
    await expect(publicVisit.getByRole("link", { name: "Re:Taste 샘플 라멘 동명" })).toBeVisible();
    await expect(publicVisit.getByRole("img", { name: "승인 흐름 검증용 합성 사진" })).toBeVisible();
    await publicPage.screenshot({ path: testInfo.outputPath("approved-profile.png"), fullPage: true });
    await adminPage.screenshot({ path: testInfo.outputPath("admin-approved.png"), fullPage: true });
    await page.reload();
    await editVisit("공개 이후 내용을 고쳐 다시 검수 요청합니다.");
    expect((await anon.request.get(publicUrl)).status()).toBe(404);
    await publicPage.reload();
    await expect(publicPage.locator(".reviewer-public-visit")).toHaveCount(0);
    await moderate("APPROVED", "합성 재검수: 수정한 내용 확인 완료.");
    expect((await anon.request.get(publicUrl)).status()).toBe(200);
    await moderate("WITHDRAWN", "합성 검수: 공개 회수 경계 시험.");
    expect((await anon.request.get(publicUrl)).status()).toBe(404);
    await publicPage.reload();
    await expect(publicPage.locator(".reviewer-public-visit")).toHaveCount(0);
    await page.reload();
    const withdrawal = ownRow.locator('form').filter({ has: page.locator('input[value="withdraw-review"]') });
    await withdrawal.getByLabel("철회 사유").fill("합성 시험 종료 후 사진 삭제 요청.");
    await withdrawal.getByLabel("공개 중단과 사진 삭제를 확인했어요.").check();
    await withdrawal.getByRole("button", { name: /사진 삭제/ }).click();
    await expect(page).toHaveURL(/notice=review-withdrawn/);
    expect((await context.request.get(previewUrl!)).status()).toBe(404);
  } finally { await admin.close(); await anon.close(); }
});
