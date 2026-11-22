import { expect, test } from "@playwright/test";
import { correctionFlowFixture } from "./correction-flow-fixture";
import { isControlledLocalBaseUrl } from "./local-test-target";

test.skip(!isControlledLocalBaseUrl(), "S07 uses isolated local fixtures and a mock mail inbox");
test("S07 follows public correction through mock email, internal review and public application", async ({ page, browser, baseURL }, info) => {
  test.setTimeout(90_000);
  // Verify the test-only worker entrypoint before allowing any email submission.
  const inboxProbe = await page.request.get("/__e2e/email?email=s07-probe@example.test");
  expect(inboxProbe.status()).toBe(404);
  expect(inboxProbe.headers()["content-type"]).toContain("application/json");
  const f = correctionFlowFixture(baseURL!, info.project.name);
  f.create();
  const admin = await browser.newContext({ baseURL, viewport: page.viewportSize(), isMobile: Boolean(info.project.use.isMobile), hasTouch: Boolean(info.project.use.hasTouch) });
  for (const context of [page.context(), admin]) await context.route("**/*", route => new URL(route.request().url()).origin === new URL(baseURL!).origin ? route.continue() : route.abort());
  await admin.addCookies([{ name: "retaste_session", value: "qa-admin-session", url: baseURL! }]);
  const adminPage = await admin.newPage();
  try {
    await page.goto(`/places/${f.id}`);
    await expect(page.getByRole("heading", { name: f.originalName, exact: true })).toBeVisible();
    await page.getByRole("link", { name: "이 장소 정보 정정 요청", exact: true }).click();
    await expect(page.locator('input[name="placeId"]')).toHaveValue(f.id);
    await page.getByLabel("요청자 관계", { exact: true }).fill("방문자");
    await page.getByLabel("확인 이메일", { exact: true }).fill(f.email);
    await page.getByLabel("변경 상호", { exact: true }).fill(f.updatedName);
    await page.getByRole("textbox", { name: "근거 설명", exact: true }).fill("현장 간판과 안내문을 확인한 합성 정정 근거입니다.");
    await page.getByRole("button", { name: "확인 이메일 보내기", exact: true }).click();
    await expect(page.getByRole("status").filter({ hasText: "이메일 확인 링크를 보냈습니다." })).toBeVisible();
    expect(f.request()).toMatchObject({ status: "PENDING_VERIFICATION", verified_at: null });
    expect(f.place()).toEqual({ name: f.originalName, status: "PUBLISHED" });

    await adminPage.goto("/admin/place-operations?tab=corrections");
    await expect(adminPage.locator(".ops-card").filter({ hasText: f.originalName })).toHaveCount(0);
    const pending = f.request()!;
    const unverified = await admin.request.post("/admin/place-operations?tab=corrections", {
      headers: { Origin: new URL(baseURL!).origin },
      form: { intent: "transition-correction", requestId: pending.id, expectedUpdatedAt: pending.updated_at, status: "REVIEWING", reason: "확인 전 직접 전이는 거절되어야 합니다." },
    });
    expect(unverified.status()).toBe(400);
    expect(f.request()).toMatchObject({ status: "PENDING_VERIFICATION", verified_at: null });
    const delivery = await page.request.get(`/__e2e/email?email=${encodeURIComponent(f.email)}`);
    expect(delivery.status()).toBe(200);
    const { html } = await delivery.json() as { html: string };
    const link = html.match(/href="([^"]+)"/)?.[1];
    expect(link).toBeTruthy();
    const verification = new URL(link!);
    expect(verification.origin).toBe(new URL(baseURL!).origin);
    expect(verification.pathname).toBe("/corrections/verify");
    expect(verification.searchParams.has("token")).toBe(false);
    expect(verification.hash.length).toBeGreaterThan(1);
    await page.goto(link!);
    await expect(page.getByRole("heading", { name: "정정 요청이 접수됐습니다.", exact: true })).toBeVisible();
    expect(f.request()).toMatchObject({ status: "SUBMITTED", verified_at: expect.any(String) });
    expect(f.place()).toEqual({ name: f.originalName, status: "PUBLISHED" });

    await adminPage.reload();
    const card = adminPage.locator(".ops-card").filter({ has: adminPage.getByRole("heading", { name: f.originalName, exact: true }) });
    await expect(card).toContainText("접수 완료 · 정보 정정");
    await expect(card).toContainText(f.updatedName);
    await card.getByLabel("검토·반려 사유", { exact: true }).fill("현장 자료를 추가 대조하는 내부 검토 메모");
    await card.getByRole("button", { name: "검토 메모 저장", exact: true }).click();
    await expect(card).toContainText("검토 중 · 정보 정정");
    await expect(card).toContainText("현장 자료를 추가 대조하는 내부 검토 메모");
    expect(f.request()).toMatchObject({ status: "REVIEWING", admin_response: "현장 자료를 추가 대조하는 내부 검토 메모" });
    expect(f.place()).toEqual({ name: f.originalName, status: "PUBLISHED" });
    await card.screenshot({ path: info.outputPath("s07-admin-review.png") });
    await card.getByLabel("적용 근거", { exact: true }).fill("현장 자료 확인 후 상호 정정을 적용합니다.");
    await card.getByRole("button", { name: "정정 적용", exact: true }).click();
    await expect(card).toHaveCount(0);
    expect(f.request()).toMatchObject({ status: "APPLIED" });
    expect(f.place()).toEqual({ name: f.updatedName, status: "PUBLISHED" });
    expect(f.revisionCount()).toBe(1);
    await page.goto(`/places/${f.id}`);
    await expect(page.getByRole("heading", { name: f.updatedName, exact: true })).toBeVisible();
    await page.screenshot({ path: info.outputPath("s07-public-applied.png") });
  } finally { await admin.close(); f.cleanup(); }
});
