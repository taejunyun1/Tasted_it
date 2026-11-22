import { expect, test } from "@playwright/test";
import { correctionFlowFixture } from "./correction-flow-fixture";
import { isControlledLocalBaseUrl } from "./local-test-target";

test.skip(!isControlledLocalBaseUrl(), "T05 needs the local synthetic D1 and mock mail inbox");

test("T05 applies a verified closure report through the authenticated B09 recall", async ({ page, browser, baseURL }, info) => {
  test.setTimeout(90_000);
  const inboxProbe = await page.request.get("/__e2e/email?email=t05-probe@example.test");
  expect(inboxProbe.status()).toBe(404);
  expect(inboxProbe.headers()["content-type"]).toContain("application/json");

  const fixture = correctionFlowFixture(baseURL!, `recall-${info.project.name}`);
  const publicPath = `/places/${fixture.id}`;
  const origin = new URL(baseURL!).origin;
  const admin = await browser.newContext({ baseURL, viewport: page.viewportSize(), isMobile: Boolean(info.project.use.isMobile), hasTouch: Boolean(info.project.use.hasTouch) });
  let operator: Awaited<ReturnType<typeof fixture.createRecallOperator>> | undefined;
  try {
    fixture.create();
    operator = await fixture.createRecallOperator();
    await page.context().route("**/*", (route) => {
      const request = route.request();
      if (new URL(request.url()).origin !== origin) return route.abort();
      // The local mock-mail Worker shares loopback with other suites.
      return request.method() === "POST"
        ? route.continue({ headers: { ...request.headers(), "cf-connecting-ip": fixture.clientIp } })
        : route.continue();
    });
    await admin.route("**/*", route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
    await admin.addCookies([{ name: "retaste_session", value: operator.sessionId, url: baseURL! }]);
    const adminPage = await admin.newPage();

    expect((await page.goto(publicPath))?.status()).toBe(200);
    await expect(page.getByRole("heading", { name: fixture.originalName, exact: true })).toBeVisible();
    await page.getByRole("link", { name: "이 장소 정보 정정 요청", exact: true }).click();
    await expect(page.locator('input[name="placeId"]')).toHaveValue(fixture.id);
    await page.getByRole("combobox", { name: "요청 유형", exact: true }).selectOption("CLOSED");
    await page.getByLabel("요청자 관계", { exact: true }).fill("방문자");
    await page.getByLabel("확인 이메일", { exact: true }).fill(fixture.email);
    await page.getByLabel("근거 설명", { exact: true }).fill("폐업 안내와 현장 방문을 확인한 합성 신고입니다.");
    await page.getByRole("button", { name: "확인 이메일 보내기", exact: true }).click();
    await expect(page.getByRole("status").filter({ hasText: "이메일 확인 링크를 보냈습니다." })).toBeVisible();
    expect(fixture.request()).toMatchObject({ status: "PENDING_VERIFICATION", verified_at: null });

    await adminPage.goto("/admin/place-operations?tab=corrections");
    const card = adminPage.locator(".ops-card").filter({ has: adminPage.getByRole("heading", { name: fixture.originalName, exact: true }) });
    await expect(card).toHaveCount(0);

    const delivery = await page.request.get(`/__e2e/email?email=${encodeURIComponent(fixture.email)}`);
    expect(delivery.status()).toBe(200);
    const { html } = await delivery.json() as { html: string };
    const link = html.match(/href="([^"]+)"/)?.[1];
    if (!link) throw new Error("T05_MOCK_VERIFICATION_LINK_MISSING");
    const verifyUrl = new URL(link);
    expect(verifyUrl.origin).toBe(origin);
    expect(verifyUrl.pathname).toBe("/corrections/verify");
    await page.goto(verifyUrl.href);
    await expect(page.getByRole("heading", { name: "정정 요청이 접수됐습니다.", exact: true })).toBeVisible();
    const correction = fixture.request()!;
    expect(correction).toMatchObject({ status: "SUBMITTED", verified_at: expect.any(String) });
    const correctionReference = new RegExp(`폐업 신고 번호\\s*[:：]?\\s*${correction.id}`);

    await adminPage.reload();
    await expect(card).toContainText("접수 완료 · 폐업");
    await expect(card.getByRole("button", { name: "정정 적용", exact: true })).toHaveCount(0);
    await card.getByLabel("회수 사유", { exact: true }).fill("폐업 안내를 대조해 확인한 합성 장소를 회수합니다.");
    await card.getByRole("button", { name: "회수 미리보기", exact: true }).click();
    const preview = adminPage.getByRole("region", { name: "장소 변경 미리보기", exact: true });
    await expect(preview).toContainText(fixture.originalName);
    await expect(preview).toContainText("현재 조회: 공개 → 변경 예정: 숨김");
    await expect(preview).toContainText("회수가 확정되면 폐업 신고도 적용 완료로 기록합니다.");
    await expect(preview).toContainText(correctionReference);
    const previewUrl = new URL(adminPage.url());
    const operationId = previewUrl.searchParams.get("operation")!;
    expect(operationId).toMatch(/^[0-9a-f-]{36}$/);
    expect(previewUrl.searchParams.get("tab")).toBe("corrections");
    expect(previewUrl.searchParams.get("correctionsPage")).toBe("1");
    await preview.screenshot({ path: info.outputPath("t05-closure-preview.png") });

    await preview.getByRole("button", { name: "장소 변경 확정", exact: true }).click();
    await expect(adminPage.getByRole("heading", { name: "관리자 재인증", exact: true })).toBeVisible();
    expect(new URL(adminPage.url()).searchParams.get("returnTo")).toBe(`${previewUrl.pathname}${previewUrl.search}`);
    expect(fixture.request()).toMatchObject({ status: "SUBMITTED" });
    expect(fixture.place()).toMatchObject({ status: "PUBLISHED" });
    expect(fixture.recallEvidence(operationId, correction.id)).toEqual({ state: "PENDING", commits: 0, placeAudits: 0, correctionAudits: 0, revisions: 0 });

    await adminPage.getByLabel("현재 비밀번호", { exact: true }).fill(operator.password);
    await adminPage.getByRole("button", { name: "비밀번호로 확인", exact: true }).click();
    await expect(adminPage).toHaveURL(previewUrl.href);
    await preview.getByRole("button", { name: "장소 변경 확정", exact: true }).click();
    const receipt = adminPage.getByRole("region", { name: "장소 변경 확정 영수증", exact: true });
    await expect(receipt).toContainText("요청 1건 · 적용 1건 · 건너뜀 0건.");
    await expect(receipt).toContainText("이 작업에서 폐업 신고를 적용 완료로 기록했습니다.");
    await expect(receipt.getByRole("button", { name: "장소 변경 확정", exact: true })).toHaveCount(0);
    await expect(card).toHaveCount(0);
    expect(fixture.request()).toMatchObject({ status: "APPLIED" });
    expect(fixture.place()).toEqual({ name: fixture.originalName, status: "HIDDEN" });
    expect((await page.goto(publicPath))?.status()).toBe(404);

    await adminPage.reload();
    await expect(receipt).toContainText("이 작업에서 폐업 신고를 적용 완료로 기록했습니다.");
    await expect(receipt).toContainText(correctionReference);
    expect(fixture.recallEvidence(operationId, correction.id)).toEqual({ state: "COMMITTED", commits: 1, placeAudits: 1, correctionAudits: 1, revisions: 1 });
    await receipt.screenshot({ path: info.outputPath("t05-closure-receipt.png") });
  } finally {
    try {
      await admin.close();
    } finally {
      try {
        operator?.cleanup();
      } finally {
        fixture.cleanup();
      }
    }
  }
});
