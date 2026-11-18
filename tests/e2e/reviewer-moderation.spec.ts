import { expect, test, type Browser, type BrowserContext, type Locator, type Page, type TestInfo } from "@playwright/test";
import { isControlledLocalBaseUrl } from "./local-test-target";

test.skip(!isControlledLocalBaseUrl() || Boolean(process.env.BASE_URL) && process.env.CST_REVIEWER_LOCAL_FIXTURE !== "1", "방문 검수 시험은 격리한 로컬 합성 자료에서만 실행합니다.");
const pendingCleanup = new WeakMap<BrowserContext, string>();

test.beforeEach(async ({ page }) => {
  // 방문 검수 시험은 외부 지도 공급자를 호출하지 않는다.
  await page.route("https://oapi.map.naver.com/**", (route) => route.abort());
});

test.afterEach(async ({ context }) => {
  const reviewId = pendingCleanup.get(context);
  if (!reviewId) return;
  const ownerPage = await context.request.get("/reviewer/ratings");
  expect(ownerPage.status()).toBe(200);
  const html = await ownerPage.text();
  const start = html.indexOf(`id="review-${reviewId}"`);
  expect(start).toBeGreaterThanOrEqual(0);
  const row = html.slice(start, html.indexOf("</article>", start));
  const version = row.match(/name="expectedVersion" value="([0-9]+)"/)?.[1];
  expect(version).toBeTruthy();
  const cleanup = await context.request.post("/reviewer/ratings", { maxRedirects: 0, headers: { Origin: new URL(ownerPage.url()).origin }, form: {
    intent: "withdraw-review", reviewId, expectedVersion: version!, reason: "격리한 합성 시험 종료 후 본인 기록과 사진 정리.",
  } });
  expect(cleanup.status()).toBe(303);
  pendingCleanup.delete(context);
});

async function signIn(context: BrowserContext, session: string) {
  await context.addCookies([{ name: "retaste_session", value: session, domain: "127.0.0.1", path: "/" }]);
}
async function visitEvidence(page: Page, scope = page.locator(".reviewer-preview")) {
  await scope.getByLabel("방문일", { exact: true }).fill("2026-11-01");
  await scope.getByRole("textbox", { name: "직접 확인한 방문 근거", exact: true }).fill("합성 시험 자료: 직접 방문해 라멘과 제공 상황을 확인했습니다.");
  await scope.getByRole("combobox", { name: "광고·협찬·이해관계", exact: true }).selectOption("NONE");
}
async function createPendingVisit(page: Page, outputPath?: (name: string) => string, mark: (phase: string) => void = () => {}) {
  mark("owner-workspace:start");
  await page.goto("/reviewer/ratings");
  await page.getByPlaceholder("다녀온 장소 검색").fill("샘플 라멘 동명");
  await page.getByRole("button", { name: /Re:Taste 샘플 라멘 동명/ }).click();
  await page.getByRole("button", { name: "다음: 평가" }).click();
  await page.getByRole("button", { name: "추천", exact: true }).click();
  await page.getByRole("button", { name: "다음: 맛 배지" }).click();
  await page.getByRole("button", { name: "육수 농도 선명" }).click();
  await page.getByRole("button", { name: "다음: 사진·Golden" }).click();
  mark("owner-wizard:photo-step");
  const image = await page.screenshot({ type: "jpeg" });
  await page.locator('input[name="photos"]').setInputFiles({ name: "synthetic-visit.jpg", mimeType: "image/jpeg", buffer: image });
  await expect(page.getByRole("img", { name: "제출 전 사진 1" })).toBeVisible();
  mark("photo-preparation:complete");
  await page.locator(".reviewer-workspace").getByLabel("사진 1 촬영일", { exact: true }).fill("2026-11-01");
  await page.locator(".reviewer-workspace").getByRole("combobox", { name: "사진 1 이용권리", exact: true }).selectOption("OWN_WORK");
  await page.locator(".reviewer-workspace").getByLabel("사진 1 권리 근거", { exact: true }).fill("자동시험을 위해 직접 생성한 합성 이미지입니다.");
  await page.locator(".reviewer-workspace").getByLabel("사진 1 설명", { exact: true }).fill("승인 흐름 검증용 합성 사진");
  await page.locator(".reviewer-workspace").getByLabel("사진 1의 불필요한 인물·차량번호·개인정보 노출을 확인했어요.").check();
  if (outputPath) await page.locator('[aria-labelledby="review-step-photo"]').screenshot({ path: outputPath("photo-declarations.png") });
  mark("photo-declarations:capture-complete");
  await page.getByRole("button", { name: "다음: 확인" }).click();
  await visitEvidence(page);
  if (outputPath) await page.locator(".reviewer-preview").screenshot({ path: outputPath("visit-declarations.png") });
  mark("visit-declarations:capture-complete");
  await page.getByRole("button", { name: "검수 요청", exact: true }).click();
  await expect(page).toHaveURL(/notice=review-with-photos-submitted/);
  await expect(page.getByText("검수 요청 완료", { exact: true })).toBeVisible();
  const id = new URL(page.url()).searchParams.get("submitted");
  expect(id).toBeTruthy();
  pendingCleanup.set(page.context(), id!);
  mark("owner-submission:complete");
  return id!;
}

// Each task starts with its own visit through the real submission/moderation gates.
function taskTiming(testInfo: TestInfo, scenario: string) {
  const started = performance.now();
  return (phase: string) => console.info(`REVIEWER_TIMING ${JSON.stringify({ scenario, phase, elapsedMs: Math.round(performance.now() - started), atUtc: new Date().toISOString(), project: testInfo.project.name })}`);
}

async function createActors(browser: Browser, page: Page, testInfo: TestInfo) {
  const options = {
    baseURL: String(testInfo.project.use.baseURL), viewport: page.viewportSize(),
    isMobile: testInfo.project.name.includes("mobile"), hasTouch: testInfo.project.name.includes("mobile"),
    userAgent: await page.evaluate(() => navigator.userAgent),
    deviceScaleFactor: await page.evaluate(() => window.devicePixelRatio),
  };
  const anon = await browser.newContext(options);
  const admin = await browser.newContext(options);
  for (const scopedContext of [anon, admin]) await scopedContext.route("https://oapi.map.naver.com/**", (route) => route.abort());
  await signIn(admin, "qa-admin-session");
  return {
    anon, admin, publicPage: await anon.newPage(), adminPage: await admin.newPage(),
    close: () => Promise.allSettled([admin.close(), anon.close()]),
  };
}

async function preparePhotoVisit(page: Page, context: BrowserContext, origin: string) {
  // A browser-generated blank JPEG is a synthetic fixture, not a real visit photo.
  const image = await page.screenshot({ type: "jpeg" });
  const response = await context.request.post("/reviewer/ratings", { maxRedirects: 0, headers: { Origin: origin }, multipart: {
    intent: "publish-review", placeId: "sample-place-1", categoryId: "cat-ramen", categoryName: "라멘", evaluation: "RECOMMEND", golden: "0",
    badges: "육수 농도 선명", visitedOn: "2026-11-01", visitNote: "합성 시험 자료: 직접 방문해 라멘과 제공 상황을 확인했습니다.", disclosure: "NONE",
    photoMetadata: JSON.stringify([{ position: 0, takenOn: "2026-11-01", rightsBasis: "OWN_WORK", rightsNote: "자동시험을 위해 직접 생성한 합성 이미지입니다.", caption: "승인 흐름 검증용 합성 사진", privacyChecked: true }]),
    photos: { name: "synthetic-visit.jpg", mimeType: "image/jpeg", buffer: image },
  } });
  expect(response.status()).toBe(303);
  const submitted = new URL(response.headers().location, origin);
  const id = submitted.searchParams.get("submitted");
  expect(id).toBeTruthy();
  pendingCleanup.set(context, id!);
  expect(submitted.searchParams.get("notice")).toBe("review-with-photos-submitted");
  return id!;
}

async function photoReferences(page: Page, reviewId: string) {
  const ownRow = page.locator(`#review-${reviewId}`);
  const previewUrl = await ownRow.locator(".reviewer-history-thumb").getAttribute("src");
  expect(previewUrl).toContain("preview=1");
  return { ownRow, previewUrl: previewUrl!, publicUrl: new URL(previewUrl!, page.url()).pathname };
}

function moderationDriver(adminPage: Page, reviewId: string, mark: (phase: string) => void, checkApprovalRetry = false) {
  let checkedApprovalRetry = !checkApprovalRetry;
  let round = 0;
  return async (status: "APPROVED" | "CHANGES_REQUESTED" | "WITHDRAWN", reason: string) => {
    const phase = `moderation-${++round}-${status}`;
    mark(`${phase}:start`);
    await adminPage.goto("/admin/reviewer-visits?status=ALL");
    mark(`${phase}:document-ready`);
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
    mark(`${phase}:complete`);
  };
}

async function editVisit(page: Page, ownRow: Locator, reason: string, checkRetry = false) {
  await ownRow.getByText("내용 보완·다시 제출", { exact: true }).click();
  const edit = ownRow.locator('form').filter({ has: page.locator('input[value="edit-review"]') });
  await edit.getByRole("textbox", { name: "직접 확인한 방문 근거", exact: true }).fill(`합성 시험 자료: ${reason}`);
  await edit.getByLabel("수정 사유").fill(reason);
  if (checkRetry) {
    for (const badge of ["육수 농도 선명", "면 익힘 알맞음", "토핑 상태 좋음"]) await edit.getByLabel(badge, { exact: true }).check();
    await edit.getByRole("button", { name: "수정하고 검수 요청" }).click();
    await expect(edit.getByRole("alert")).toContainText("맛 배지는 최대 2개까지 선택해 주세요.");
    await expect(edit.getByLabel("수정 사유")).toHaveValue(reason);
    await expect(edit.getByRole("textbox", { name: "직접 확인한 방문 근거", exact: true })).toHaveValue(`합성 시험 자료: ${reason}`);
    await edit.getByLabel("토핑 상태 좋음", { exact: true }).uncheck();
  }
  await edit.getByRole("button", { name: "수정하고 검수 요청" }).click();
  await expect(page).toHaveURL(/notice=review-updated/);
  await expect(ownRow).toContainText("검수 대기");
}

// Uses only isolated local fixtures. Technical evidence is separate from user studies.
test("reviewer submits photo and rights through the wizard while pending material stays private", async ({ browser, page, context }, testInfo) => {
  const mark = taskTiming(testInfo, "submission-and-private-access");
  mark("task:start");
  await signIn(context, "qa-active-reviewer-session");
  const reviewId = await createPendingVisit(page, (name) => testInfo.outputPath(name), mark);
  const { ownRow, previewUrl, publicUrl } = await photoReferences(page, reviewId);
  await expect(ownRow).toContainText("검수 대기");
  const actors = await createActors(browser, page, testInfo);
  try {
    expect((await actors.anon.request.get(publicUrl)).status()).toBe(404);
    expect((await actors.anon.request.head(publicUrl)).status()).toBe(404);
    expect((await actors.anon.request.get(previewUrl)).status()).toBe(404);
    expect((await actors.anon.request.get("/me", { maxRedirects: 0, headers: { Cookie: "retaste_session=qa-reviewer-member-session" } })).status()).toBe(200);
    for (const request of [actors.anon.request.get(previewUrl, { headers: { Cookie: "retaste_session=qa-reviewer-member-session" } }), actors.anon.request.head(previewUrl, { headers: { Cookie: "retaste_session=qa-reviewer-member-session" } })]) expect((await request).status()).toBe(404);
    expect((await context.request.get(previewUrl)).status()).toBe(200);
    expect((await actors.admin.request.get(previewUrl)).status()).toBe(200);
    await actors.publicPage.goto("/reviewers/qa-gukmul-reviewer");
    await expect(actors.publicPage.getByText("공개 승인된 방문 자료가 아직 없어요.")).toBeVisible();
    const denied = await context.request.post("/admin/reviewer-visits", { form: { reviewId, expectedVersion: "1", status: "APPROVED", reason: "권한 없는 요청" }, headers: { Origin: new URL(page.url()).origin } });
    expect(denied.status()).toBe(403);
    await ownRow.screenshot({ path: testInfo.outputPath("owner-pending.png") });
    mark("pending-access-and-owner-capture:complete");
  } finally { await actors.close(); }
});

test("administrator requests corrections and approves resubmitted private material without leaking evidence", async ({ browser, page, context }, testInfo) => {
  const mark = taskTiming(testInfo, "correction-and-publication");
  mark("task:start");
  await signIn(context, "qa-active-reviewer-session");
  const origin = String(testInfo.project.use.baseURL);
  const reviewId = await preparePhotoVisit(page, context, origin);
  await page.goto("/reviewer/ratings");
  const { ownRow, publicUrl } = await photoReferences(page, reviewId);
  const actors = await createActors(browser, page, testInfo);
  const moderate = moderationDriver(actors.adminPage, reviewId, mark, true);
  try {
    mark("pending-fixture:ready");
    await actors.publicPage.goto("/reviewers/qa-gukmul-reviewer");
    await expect(actors.publicPage.getByText("공개 승인된 방문 자료가 아직 없어요.")).toBeVisible();
    await moderate("CHANGES_REQUESTED", "합성 검수: 방문 근거를 더 구체적으로 보완해 주세요.");
    await page.reload();
    await expect(ownRow).toContainText("보완 요청");
    await expect(ownRow).toContainText("방문 근거를 더 구체적으로");
    mark("owner-sees-change-request:complete");
    await editVisit(page, ownRow, "직접 확인한 방문 근거를 보완했습니다.", true);
    mark("owner-edit-with-retry:complete");
    await moderate("APPROVED", "합성 검수: 방문·권리·개인정보·장소 확인 완료.");
    const stale = await actors.admin.request.post("/admin/reviewer-visits", { form: { reviewId, expectedVersion: "1", status: "APPROVED", reason: "오래된 버전 재승인" }, headers: { Origin: new URL(page.url()).origin } });
    expect(stale.status()).toBe(409);
    const crossOrigin = await actors.admin.request.post("/admin/reviewer-visits", { form: { reviewId, expectedVersion: "1", status: "WITHDRAWN", reason: "외부 출처 요청" }, headers: { Origin: "https://elsewhere.invalid" } });
    // React Router's document-action CSRF guard rejects this before the route's Origin guard.
    expect(crossOrigin.status()).toBe(400);
    mark("stale-and-origin-negatives:complete");
    const approved = await actors.anon.request.get(publicUrl);
    expect(approved.status()).toBe(200);
    expect(approved.headers()["cache-control"]).toContain("no-store");
    await actors.publicPage.reload();
    const publicHtml = await actors.publicPage.content();
    expect(publicHtml).not.toContain("qa-active-reviewer");
    expect(publicHtml).not.toContain("자동시험을 위해 직접 생성한 합성 이미지입니다.");
    expect(publicHtml).not.toContain("직접 확인한 방문 근거를 보완했습니다.");
    const publicVisit = actors.publicPage.locator(".reviewer-public-visit");
    await expect(publicVisit.getByRole("link", { name: "Re:Taste 샘플 라멘 동명" })).toBeVisible();
    await expect(publicVisit.getByRole("img", { name: "승인 흐름 검증용 합성 사진" })).toBeVisible();
    await actors.publicPage.screenshot({ path: testInfo.outputPath("approved-profile.png"), fullPage: true });
    await actors.adminPage.locator(`#moderation-${reviewId}`).screenshot({ path: testInfo.outputPath("admin-approved.png") });
    await publicVisit.getByRole("link", { name: "Re:Taste 샘플 라멘 동명" }).click();
    await expect(actors.publicPage.locator(`.review-photo-gallery img[src="${publicUrl}"]`)).toBeVisible();
    mark("approved-captures:complete");
  } finally { await actors.close(); }
});

test("administrator rejection preserves the owner preview while public profile and detail exclude the photo", async ({ browser, page, context }, testInfo) => {
  await signIn(context, "qa-active-reviewer-session");
  const reviewId = await preparePhotoVisit(page, context, String(testInfo.project.use.baseURL));
  await page.goto("/reviewer/ratings");
  const { ownRow, previewUrl, publicUrl } = await photoReferences(page, reviewId);
  const actors = await createActors(browser, page, testInfo);
  try {
    await actors.adminPage.goto("/admin/reviewer-visits?status=ALL");
    const card = actors.adminPage.locator(`#moderation-${reviewId}`);
    await card.getByLabel("검수 사유").fill("합성 시험: 방문 근거 부족으로 반려합니다.");
    await card.getByRole("button", { name: "반려", exact: true }).click();
    await expect(card.locator(".reviewer-moderation-status")).toHaveText("반려");
    for (const response of [await actors.anon.request.get(publicUrl), await actors.anon.request.head(publicUrl)]) {
      expect(response.status()).toBe(404);
      expect(response.headers()["cache-control"]).toContain("no-store");
    }
    expect((await context.request.get(previewUrl)).status()).toBe(200);
    await actors.publicPage.goto("/reviewers/qa-gukmul-reviewer");
    await expect(actors.publicPage.locator(".reviewer-public-visit")).toHaveCount(0);
    await actors.publicPage.goto("/places/sample-dongmyeong-ramen");
    await expect(actors.publicPage.getByRole("heading", { name: "Re:Taste 샘플 라멘 동명", exact: true })).toBeVisible();
    await expect(actors.publicPage.locator(`img[src="${publicUrl}"]`)).toHaveCount(0);
    await page.reload();
    await expect(ownRow).toContainText("반려");
    await ownRow.screenshot({ path: testInfo.outputPath("rejected-owner-preview.png") });
    await actors.publicPage.screenshot({ path: testInfo.outputPath("rejected-public-detail.png"), fullPage: true });
  } finally { await actors.close(); }
});

test("correcting and withdrawing the same approved visit removes its public photo and finally deletes the owner preview", async ({ browser, page, context }, testInfo) => {
  const mark = taskTiming(testInfo, "approved-correction-and-withdrawal");
  mark("task:start");
  await signIn(context, "qa-active-reviewer-session");
  const origin = String(testInfo.project.use.baseURL);
  const reviewId = await preparePhotoVisit(page, context, origin);
  const actors = await createActors(browser, page, testInfo);
  try {
    const approval = await actors.admin.request.post("/admin/reviewer-visits", { headers: { Origin: origin }, form: {
      reviewId, expectedVersion: "1", status: "APPROVED", reason: "합성 fixture: 실제 관리자 확인 gate로 승인 준비.",
      visitVerified: "on", rightsVerified: "on", privacyVerified: "on", placeVerified: "on",
    } });
    expect(approval.status()).toBe(200);
    await page.goto("/reviewer/ratings");
    const { ownRow, previewUrl, publicUrl } = await photoReferences(page, reviewId);
    await expect(ownRow).toContainText("승인됨");
    expect((await actors.anon.request.get(publicUrl)).status()).toBe(200);
    await actors.publicPage.goto("/reviewers/qa-gukmul-reviewer");
    await expect(actors.publicPage.locator(".reviewer-public-visit")).toHaveCount(1);
    mark("approved-fixture:ready");
    const moderate = moderationDriver(actors.adminPage, reviewId, mark);
    await editVisit(page, ownRow, "공개 이후 내용을 고쳐 다시 검수 요청합니다.");
    expect((await actors.anon.request.get(publicUrl)).status()).toBe(404);
    await actors.publicPage.reload();
    await expect(actors.publicPage.locator(".reviewer-public-visit")).toHaveCount(0);
    mark("owner-edit-public-removal:complete");
    await moderate("APPROVED", "합성 재검수: 수정한 내용 확인 완료.");
    expect((await actors.anon.request.get(publicUrl)).status()).toBe(200);
    await moderate("WITHDRAWN", "합성 검수: 공개 회수 경계 시험.");
    expect((await actors.anon.request.get(publicUrl)).status()).toBe(404);
    await actors.publicPage.reload();
    await expect(actors.publicPage.locator(".reviewer-public-visit")).toHaveCount(0);
    mark("admin-withdrawal-public-removal:complete");
    await page.reload();
    const withdrawal = ownRow.locator('form').filter({ has: page.locator('input[value="withdraw-review"]') });
    await withdrawal.getByLabel("철회 사유").fill("합성 시험 종료 후 사진 삭제 요청.");
    await withdrawal.getByLabel("공개 중단과 사진 삭제를 확인했어요.").check();
    await withdrawal.getByRole("button", { name: /사진 삭제/ }).click();
    await expect(page).toHaveURL(/notice=review-withdrawn/);
    expect((await context.request.get(previewUrl)).status()).toBe(404);
    pendingCleanup.delete(context);
    mark("owner-withdrawal-photo-removal:complete");
  } finally { await actors.close(); }
});

test("native administrator POST reports validation failures and success while cursor navigation preserves the filter", async ({ browser, context, page }, testInfo) => {
  await signIn(context, "qa-active-reviewer-session");
  const origin = new URL(String(testInfo.project.use.baseURL)).origin;
  const submitted = await context.request.post("/reviewer/ratings", { maxRedirects: 0, headers: { Origin: origin }, form: {
    intent: "publish-review", placeId: "sample-place-1", categoryId: "cat-ramen", categoryName: "라멘", evaluation: "HOLD", golden: "0",
    visitedOn: "2026-11-01", visitNote: "합성 시험 자료: JavaScript 비활성 검수 동작 확인.", disclosure: "NONE", photoMetadata: "[]",
  } });
  expect(submitted.status()).toBe(303);
  const reviewId = new URL(submitted.headers().location, origin).searchParams.get("submitted");
  expect(reviewId).toBeTruthy();
  pendingCleanup.set(context, reviewId!);
  const admin = await browser.newContext({
    baseURL: origin, javaScriptEnabled: false, viewport: page.viewportSize(),
    isMobile: testInfo.project.name.includes("mobile"), hasTouch: testInfo.project.name.includes("mobile"),
    userAgent: testInfo.project.use.userAgent, deviceScaleFactor: testInfo.project.use.deviceScaleFactor,
  });
  await signIn(admin, "qa-admin-session");
  await admin.route("https://oapi.map.naver.com/**", (route) => route.abort());
  try {
    expect((await context.request.get("/reviewer/ratings?beforeUpdatedAt=invalid&beforeId=cursor")).status()).toBe(400);
    expect((await admin.request.get("/admin/reviewer-visits?beforeUpdatedAt=invalid&beforeId=cursor")).status()).toBe(400);
    const cursor = new URLSearchParams({ beforeUpdatedAt: "2099-01-01T00:00:00.000Z", beforeId: "cursor-boundary" });
    const ownerCursor = await context.request.get(`/reviewer/ratings?${cursor}`);
    expect(ownerCursor.status()).toBe(200);
    expect(await ownerCursor.text()).toContain("최근 기록으로");
    const nativePage = await admin.newPage();
    await nativePage.goto(`/admin/reviewer-visits?status=ALL&${cursor}`);
    await nativePage.getByRole("link", { name: "최근 기록으로", exact: true }).click();
    await expect(nativePage).toHaveURL(/\/admin\/reviewer-visits\?status=ALL$/);
    const nativeCard = nativePage.locator(`#moderation-${reviewId}`);
    await nativeCard.getByLabel("검수 사유").fill("합성 검수: 확인 누락 오류 안내 시험.");
    const nativeForm = nativeCard.locator("form");
    const approveButton = nativeCard.getByRole("button", { name: "승인·공개", exact: true });
    await expect(approveButton).toBeVisible();
    await expect(approveButton).toBeEnabled();
    const bounds = await approveButton.boundingBox();
    expect(bounds?.width).toBeGreaterThan(0);
    expect(bounds?.height).toBeGreaterThan(0);
    await expect(nativeForm.locator('textarea[name="reason"]')).toHaveAttribute("required", "");
    expect(await nativeForm.locator('input[type="checkbox"][required]').count()).toBe(0);
    expect(await nativeForm.evaluate((form) => form.checkValidity())).toBe(true);
    // Native keyboard activation exercises the submitter without application JavaScript.
    const invalidResponse = nativePage.waitForResponse((response) => new URL(response.url()).pathname === "/admin/reviewer-visits" && response.request().method() === "POST");
    await approveButton.press("Enter");
    expect((await invalidResponse).status()).toBe(400);
    await expect(nativePage.getByRole("alert")).toContainText("방문·권리·개인정보·장소 확인을 모두 마쳐 주세요.");
    await expect(nativeCard.locator(".reviewer-moderation-status")).toHaveText("검수 대기");
    await expect(nativeCard.getByLabel("검수 사유")).toHaveValue("합성 검수: 확인 누락 오류 안내 시험.");
    await expect(nativeForm.locator('input[type="checkbox"]:checked')).toHaveCount(0);
    await nativeCard.getByLabel("검수 사유").fill("합성 검수: JavaScript 없이 방문·권리·개인정보·장소 확인 완료.");
    for (const name of ["visitVerified", "rightsVerified", "privacyVerified", "placeVerified"]) {
      const checkbox = nativeCard.locator(`input[name="${name}"]`);
      await checkbox.press("Space");
      await expect(checkbox).toBeChecked();
    }
    expect(await nativeForm.evaluate((form) => form.checkValidity())).toBe(true);
    const firstAdmin = await admin.request.post("/admin/reviewer-visits", { headers: { Origin: origin }, form: {
      reviewId: reviewId!, expectedVersion: "1", status: "APPROVED", reason: "합성 검수: 다른 관리자가 먼저 승인한 상태.",
      visitVerified: "on", rightsVerified: "on", privacyVerified: "on", placeVerified: "on",
    } });
    expect(firstAdmin.status()).toBe(200);
    const staleResponse = nativePage.waitForResponse((response) => new URL(response.url()).pathname === "/admin/reviewer-visits" && response.request().method() === "POST");
    await approveButton.press("Enter");
    expect((await staleResponse).status()).toBe(409);
    await expect(nativePage.getByRole("alert")).toContainText("다른 변경이 먼저 저장됐어요.");
    await expect(nativeCard.locator(".reviewer-moderation-status")).toHaveText("승인됨");
    await expect(nativeCard.getByLabel("검수 사유")).toHaveValue("");
    await expect(nativeForm.locator('input[type="checkbox"]:checked')).toHaveCount(0);
    await nativeCard.getByLabel("검수 사유").fill("합성 검수: JavaScript 없이 정상 공개 회수.");
    await nativeCard.getByRole("button", { name: "공개 회수", exact: true }).press("Enter");
    await expect(nativePage.getByRole("status")).toHaveText("검수 결과를 저장했어요.");
    await expect(nativeCard.locator(".reviewer-moderation-status")).toHaveText("공개 회수·철회");
  } finally { await Promise.allSettled([admin.close()]); }
});

test("SSR reviewer controls wait for the client entry before accepting a place selection", async ({ page, context }) => {
  await signIn(context, "qa-active-reviewer-session");
  let releaseEntry!: () => void;
  const entryBarrier = new Promise<void>((resolve) => { releaseEntry = resolve; });
  const isEntry = (url: string) => /\/entry\.client\.tsx(?:\?|$)/.test(url);
  await page.route("**/entry.client.tsx*", async (route) => {
    await entryBarrier;
    await route.continue();
  });
  const entryRequested = page.waitForRequest((request) => isEntry(request.url()));
  try {
    await page.goto("/reviewer/ratings", { waitUntil: "commit" });
    await entryRequested;
    const place = page.getByRole("button", { name: /Re:Taste 샘플 라멘 동명/ });
    await expect(place).toBeVisible();
    await expect(place).toBeDisabled();
    await expect(page.getByPlaceholder("다녀온 장소 검색")).toBeDisabled();
    releaseEntry();
    await expect(place).toBeEnabled();
    await page.getByPlaceholder("다녀온 장소 검색").fill("샘플 라멘 동명");
    await place.click();
    await expect(page.getByRole("button", { name: "다음: 평가" })).toBeEnabled();
    await page.getByRole("button", { name: "다음: 평가" }).click();
    await expect(page.getByRole("heading", { name: "이번 방문을 어떻게 판단했나요?" })).toBeVisible();
  } finally { releaseEntry(); }
});
