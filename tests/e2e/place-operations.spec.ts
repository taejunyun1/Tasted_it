import { expect, test } from "@playwright/test";

async function installFakeNaverMaps(page: import("@playwright/test").Page) {
  await page.addInitScript(() => {
    class LatLng { constructor(public latitude: number, public longitude: number) {} lat() { return this.latitude; } lng() { return this.longitude; } }
    class FakeMap { destroy() {} }
    class Marker { private position: LatLng; constructor(options: { position: LatLng }) { this.position = options.position; } getPosition() { return this.position; } setMap() {} }
    (window as unknown as { naver: unknown }).naver = {
      maps: {
        LatLng, Map: FakeMap, Marker,
        Event: { addListener: () => ({}), removeListener: () => {} },
        Service: {
          Status: { OK: "OK" },
          geocode: (_request: unknown, callback: (status: string, result: { v2: { addresses: unknown[] } }) => void) => callback("OK", {
            v2: { addresses: [{ roadAddress: "광주광역시 동구 서석로 1", jibunAddress: "광주광역시 동구 서석동 1", x: "126.923", y: "35.146" }] },
          }),
        },
      },
    };
  });
}

test("verified member can open the place suggestion and status pages", async ({ page }) => {
  await page.context().addCookies([{ name: "retaste_session", value: "qa-reviewer-member-session", domain: "127.0.0.1", path: "/" }]);
  await page.goto("/suggestions/new");
  await expect(page.getByRole("heading", { name: "새 장소 제안" })).toBeVisible();
  await expect(page.getByLabel("상호명")).toBeVisible();
  await page.goto("/me/suggestions");
  await expect(page.getByRole("heading", { name: "내 장소 제안" })).toBeVisible();
});

test("admin can inspect every place operations queue", async ({ page }) => {
  await page.context().addCookies([{ name: "retaste_session", value: "qa-admin-session", domain: "127.0.0.1", path: "/" }]);
  await page.goto("/admin/place-operations");
  await expect(page.getByRole("heading", { name: "장소 운영" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "회원 장소 제안" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "정보 정정·이의 제기" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "영업 상태 재검증" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "NAVER 근거 일괄 확인" })).toBeVisible();
  await page.getByRole("button", { name: "현재 목록 25곳 선택" }).click();
  await expect(page.locator(".naver-selection-toolbar strong")).toHaveText(/^[1-9]\d* \/ 25 선택$/);
  await expect(page.getByRole("button", { name: "선택 장소 NAVER 근거 확인" })).toBeEnabled();
  await expect(page.getByRole("heading", { name: "중복 장소 병합" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "최근 변경·복원" })).toBeVisible();
});

test("admin confirms a suggested pin on the map before approving exactly one draft", async ({ page }) => {
  const name = `관리자 지도 승인 QA ${Date.now()}`;
  await installFakeNaverMaps(page);
  await page.context().addCookies([{ name: "retaste_session", value: "qa-reviewer-member-session", domain: "127.0.0.1", path: "/" }]);
  await page.goto("/suggestions/new");
  await page.getByLabel("상호명").fill(name);
  await page.getByLabel("주소").fill("광주광역시 동구 서석로 1");
  await page.getByRole("button", { name: "지도에서 위치 찾기" }).click();
  await page.getByRole("radio", { name: /광주광역시 동구 서석로 1/ }).check();
  await page.getByRole("button", { name: "이 위치로 확정" }).click();
  await page.locator('select[name="categoryId"]').selectOption("cat-ramen");
  await page.getByRole("button", { name: "비공개 제안 접수" }).click();
  await expect(page.locator(".operation-success")).toContainText("제안을 접수했습니다.");

  await page.context().clearCookies();
  await page.context().addCookies([{ name: "retaste_session", value: "qa-admin-session", domain: "127.0.0.1", path: "/" }]);
  await page.goto("/admin/place-operations");
  const card = page.locator(".ops-card", { hasText: name });
  await expect(card).toBeVisible();
  await expect(card.getByPlaceholder("위도")).toHaveCount(0);
  await expect(card.getByPlaceholder("경도")).toHaveCount(0);
  await card.getByRole("button", { name: "기존 위치 지도에서 확인" }).click();
  await card.getByRole("button", { name: "이 위치로 확정" }).click();
  await card.locator(".ops-suggestion-approval").evaluate((form) => { form.noValidate = true; });
  await card.getByRole("button", { name: "초안 승인" }).click();
  await expect(card.getByRole("alert")).toContainText("승인 근거");
  await card.getByPlaceholder("승인 근거").fill("NAVER 지도 위치와 주소를 확인했습니다.");
  await card.getByRole("button", { name: "초안 승인" }).click();
  await expect(page.locator(".ops-card", { hasText: name })).toHaveCount(0);
});

test("public correction form is accessible before authentication", async ({ page }) => {
  await page.goto("/corrections/new");
  await expect(page.getByRole("heading", { name: "장소 정보 정정·이의 제기" })).toBeVisible();
  await expect(page.getByLabel("확인 이메일")).toBeVisible();
});
