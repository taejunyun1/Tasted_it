import { expect, test } from "@playwright/test";
import { isControlledLocalBaseUrl } from "./local-test-target";

test.skip(!isControlledLocalBaseUrl(), "Only the isolated local reviewer fixture is used");
const reason = "합성 검증용 사유: 육수와 면의 균형이 좋아 다시 권하고 싶습니다.";

for (const requested of [true, false]) {
  test(`final preview matches the submitted Golden Pick ${requested ? "request" : "non-request"}`, async ({ page, context, baseURL }, info) => {
    await context.addCookies([{ name: "retaste_session", value: "qa-active-reviewer-session", url: baseURL! }]);
    await page.route(url => url.origin !== new URL(baseURL!).origin, route => route.abort());
    await page.goto("/reviewer/ratings");
    await page.getByPlaceholder("다녀온 장소 검색").fill("샘플 라멘 동명");
    await page.getByRole("button", { name: /Re:Taste 샘플 라멘 동명/ }).click();
    await page.getByRole("button", { name: "다음: 평가", exact: true }).click();
    await page.getByRole("button", { name: "추천", exact: true }).click();
    await page.getByRole("button", { name: "다음: 맛 배지", exact: true }).click();
    await page.getByRole("button", { name: "육수 농도 선명", exact: true }).click();
    await page.getByRole("button", { name: "면 익힘 알맞음", exact: true }).click();
    await page.getByRole("button", { name: "다음: 사진·Golden", exact: true }).click();
    const image = await page.evaluate(() => {
      const canvas = document.createElement("canvas"); canvas.width = 128; canvas.height = 128;
      const ctx = canvas.getContext("2d")!; ctx.fillStyle = "#2d674d"; ctx.fillRect(0, 0, 128, 128);
      return canvas.toDataURL("image/png").split(",")[1];
    });
    await page.locator('input[name="photos"]').setInputFiles({ name: "synthetic.png", mimeType: "image/png", buffer: Buffer.from(image, "base64") });
    await expect(page.getByRole("img", { name: "제출 전 사진 1", exact: true })).toBeVisible();
    await page.getByLabel("사진 1 촬영일", { exact: true }).fill("2026-11-01");
    await page.getByRole("combobox", { name: "사진 1 이용권리", exact: true }).selectOption("OWN_WORK");
    await page.getByLabel("사진 1 권리 근거", { exact: true }).fill("테스트 코드가 직접 만든 합성 이미지입니다.");
    await page.getByLabel("사진 1 설명", { exact: true }).fill("실제 방문과 무관한 합성 검증용 이미지");
    await page.getByLabel("사진 1의 불필요한 인물·차량번호·개인정보 노출을 확인했어요.").check();
    const choice = page.getByRole("button", { name: "Golden Pick 선택", exact: true });
    await choice.click();
    await page.getByRole("textbox", { name: "Golden Pick 이유", exact: true }).fill(reason);
    await page.getByRole("button", { name: "다음: 확인", exact: true }).click();
    const preview = page.locator(".reviewer-preview");
    await expect(preview).toContainText("검수 요청함");
    await expect(preview).toContainText(reason);

    // Revisiting the previous step retains the reason and can explicitly clear
    // the active request without sending its now-inapplicable reason.
    await page.getByRole("button", { name: "이전", exact: true }).click();
    await choice.click();
    await page.getByRole("button", { name: "다음: 확인", exact: true }).click();
    await expect(preview).toContainText("요청하지 않음");
    await expect(preview).not.toContainText(reason);
    await expect(page.locator('input[name="goldenReason"]')).toHaveValue("");
    if (requested) {
      await page.getByRole("button", { name: "이전", exact: true }).click();
      await choice.click();
      await expect(page.getByRole("textbox", { name: "Golden Pick 이유", exact: true })).toHaveValue(reason);
      await page.getByRole("button", { name: "다음: 확인", exact: true }).click();
      await expect(preview).toContainText(reason);
    }
    await preview.getByLabel("방문일", { exact: true }).fill("2026-11-01");
    await preview.getByRole("textbox", { name: "직접 확인한 방문 근거", exact: true }).fill("실제 방문이 아닌 격리된 자동 검증용 합성 입력입니다.");
    await preview.getByRole("combobox", { name: "광고·협찬·이해관계", exact: true }).selectOption("NONE");
    await expect(preview).toContainText("제출만으로 평가·배지·사진·Golden Pick이 공개되거나 추천에 반영되지 않아요.");
    expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
    await page.getByRole("button", { name: "알림 닫기", exact: true }).click();
    await page.evaluate(() => {
      if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
      window.scrollTo({ top: 0, behavior: "instant" });
    });
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
    const mobile = info.project.name === "mobile-chromium";
    if (mobile) await preview.locator("dl").evaluate(node => window.scrollTo({ top: window.scrollY + node.getBoundingClientRect().top - 76, behavior: "instant" }));
    await page.screenshot({ path: `docs/evidence/2026-11-18-golden-preview-${requested ? "yes" : "no"}-${info.project.name}.png`, fullPage: !mobile });

    // Inspect the real multipart request while preventing all database/photo writes.
    await page.route(url => url.pathname === "/reviewer/ratings.data", route => route.abort());
    const sent = page.waitForRequest(request => new URL(request.url()).pathname === "/reviewer/ratings.data" && request.method() === "POST");
    await page.getByRole("button", { name: "검수 요청", exact: true }).click();
    const request = await sent;
    const form = await new Request(request.url(), { method: "POST", headers: request.headers(), body: new Uint8Array(request.postDataBuffer()!) }).formData();
    expect(form.get("golden")).toBe(requested ? "1" : "0");
    expect(form.get("goldenReason")).toBe(requested ? reason : "");
    expect(form.get("intent")).toBe("publish-review");
  });
}
