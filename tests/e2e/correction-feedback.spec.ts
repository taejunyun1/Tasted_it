import { expect, test } from "@playwright/test";

test.skip(Boolean(process.env.BASE_URL) && !/https?:\/\/(127\.0\.0\.1|localhost)(:|\/)/.test(process.env.BASE_URL), "Correction feedback tests use only synthetic local state");

test("a failed correction retains its inputs and announces the retry state", async ({ page, request, context, baseURL }, testInfo) => {
  const email = `correction-ux-${testInfo.project.name}-${Date.now()}@example.test`;
  const ip = `2001:db8:${crypto.randomUUID().slice(0, 4)}:${crypto.randomUUID().slice(0, 4)}::1`;
  await context.setExtraHTTPHeaders({ "CF-Connecting-IP": ip });
  for (let index = 0; index < 3; index++) {
    const response = await request.post("/corrections/new", {
      headers: { Origin: new URL(baseURL!).origin, "CF-Connecting-IP": ip },
      form: { email, relation: "", evidenceNote: "", requestType: "INFORMATION", placeId: "" },
    });
    expect([400, 503]).toContain(response.status());
  }
  await page.goto("/corrections/new");
  await page.getByRole("combobox", { name: "요청 유형", exact: true }).selectOption("MOVED");
  await page.getByLabel("요청자 관계", { exact: true }).fill("방문자");
  await page.getByLabel("확인 이메일", { exact: true }).fill(email);
  await page.getByLabel("변경 상호", { exact: true }).fill("합성 정정 상호");
  await page.getByLabel("변경 주소", { exact: true }).fill("합성 정정 주소");
  await page.getByRole("textbox", { name: "근거 설명", exact: true }).fill("다시 입력하지 않고 재시도할 합성 근거입니다.");
  await page.getByRole("button", { name: "확인 이메일 보내기", exact: true }).click();
  await expect(page.getByRole("alert")).toHaveText("요청이 너무 많습니다. 잠시 후 다시 시도해 주세요.");
  await expect(page.locator("#correction-error")).toBeFocused();
  await expect(page.getByRole("combobox", { name: "요청 유형", exact: true })).toHaveValue("MOVED");
  await expect(page.getByLabel("확인 이메일", { exact: true })).toHaveValue(email);
  await expect(page.getByLabel("변경 상호", { exact: true })).toHaveValue("합성 정정 상호");
  await expect(page.getByRole("textbox", { name: "근거 설명", exact: true })).toHaveValue("다시 입력하지 않고 재시도할 합성 근거입니다.");
  await expect(page.getByRole("button", { name: "확인 이메일 보내기", exact: true })).toBeEnabled();
  await page.screenshot({ path: `docs/evidence/2026-11-18-correction-feedback-${testInfo.project.name}.png`, fullPage: true });
});

test("signed-in correction prefills an editable email and suggestion history explains publication separately", async ({ context, page, baseURL }, testInfo) => {
  await context.addCookies([{ name: "retaste_session", value: "qa-admin-session", url: baseURL! }]);
  await page.goto("/corrections/new");
  await expect(page.getByLabel("확인 이메일", { exact: true })).toHaveValue("qa-admin@retaste.local");
  await expect(page.getByLabel("확인 이메일", { exact: true })).toBeEditable();
  await expect(page.getByText("입력한 이메일로 확인 링크를 보냅니다. 로그인한 경우에도 링크 확인이 필요합니다.")).toBeVisible();
  await page.goto("/me/suggestions");
  await expect(page.getByRole("heading", { name: "내 장소 제안", exact: true })).toBeVisible();
  await expect(page.getByText("최근 제안 최대 100건을 표시합니다. 승인된 제안도 공개 여부는 별도로 검토합니다.")).toBeVisible();
  await page.screenshot({ path: `docs/evidence/2026-11-18-my-suggestions-${testInfo.project.name}.png`, fullPage: true });
});
