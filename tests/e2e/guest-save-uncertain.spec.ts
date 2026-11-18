import { expect, test } from "@playwright/test";
import { isControlledLocalBaseUrl } from "./local-test-target";

test.skip(!isControlledLocalBaseUrl(), "Uses only an isolated local guest session");

test("a confirmed pre-write rejection retains the known choice without pretending a save succeeded", async ({ page }) => {
  await page.goto("/places/sample-dongmyeong-ramen");
  const control = page.locator(".guest-save-control");
  const toggle = control.locator('button[type="submit"]');
  await expect(toggle).toBeEnabled();
  await control.locator('input[name="intent"]').evaluate((node: HTMLInputElement) => { node.value = "invalid"; });
  await toggle.click();
  await expect(control.getByRole("alert")).toContainText("요청 내용을 확인");
  await expect(toggle).toBeEnabled();
  await expect(toggle).toHaveAttribute("aria-pressed", "false");
  await expect(control.getByRole("button", { name: "저장 상태 다시 확인", exact: true })).toHaveCount(0);
  await control.locator('input[name="intent"]').evaluate((node: HTMLInputElement) => { node.value = "save"; });
  await toggle.click();
  await expect(toggle).toHaveText("임시 저장 해제");
  await expect(toggle).toBeEnabled();
});

for (const fault of ["before-commit", "after-commit"] as const) {
  test(`guest save requires a successful current read after ${fault} response loss`, async ({ page, context }, testInfo) => {
    await page.goto("/places/sample-dongmyeong-ramen");
    const control = page.locator(".guest-save-control");
    const toggle = control.locator('button[type="submit"]');
    await expect(toggle).toBeEnabled();
    await toggle.click();
    await expect(toggle).toHaveText("임시 저장 해제");
    await expect(toggle).toBeEnabled();

    let loseWrite = true;
    let failRead = true;
    let writes = 0;
    await page.route("**/resources/guest-saves*", async route => {
      if (route.request().method() === "POST") {
        writes++;
        if (loseWrite) {
          loseWrite = false;
          if (fault === "after-commit") expect((await route.fetch()).ok()).toBe(true);
          return route.abort("failed");
        }
      } else if (failRead) {
        return route.abort("failed");
      }
      return route.continue();
    });

    await toggle.click();
    await expect(control.getByRole("alert")).toContainText("결과");
    await expect(toggle).toBeDisabled();
    expect(writes).toBe(1);
    const retry = control.getByRole("button", { name: "저장 상태 다시 확인", exact: true });
    await expect(retry).toBeEnabled();
    await retry.click();
    await expect(control.getByRole("alert")).toContainText("저장 상태");
    await expect(toggle).toBeDisabled();
    expect(writes).toBe(1);
    await control.screenshot({ path: `docs/evidence/cst-guest-uncertain-20261118/${testInfo.project.name}-${fault}-read-failed.png` });

    failRead = false;
    await retry.click();
    await expect(toggle).toBeEnabled();
    const expectedSaved = fault === "before-commit";
    await expect(toggle).toHaveAttribute("aria-pressed", String(expectedSaved));
    await expect(control.locator('input[name="saved"]')).toHaveValue(String(!expectedSaved));
    await expect(control.getByRole("alert")).toHaveCount(0);
    const serverChoice = await context.request.get("/resources/guest-saves?placeId=sample-place-1");
    expect(await serverChoice.json()).toMatchObject({ ok: true, saved: expectedSaved, signedIn: false });
    await control.screenshot({ path: `docs/evidence/cst-guest-uncertain-20261118/${testInfo.project.name}-${fault}-reconciled.png` });

    const nextWrite = page.waitForRequest(request => request.method() === "POST" && request.url().includes("/resources/guest-saves"));
    await toggle.click();
    expect(new URLSearchParams((await nextWrite).postData()!).get("saved")).toBe(String(!expectedSaved));
    await expect(toggle).toBeEnabled();
    expect(writes).toBe(2);
  });
}
