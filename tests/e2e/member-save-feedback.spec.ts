import { expect, test, type BrowserContext, type Page } from "@playwright/test";

test.skip(Boolean(process.env.BASE_URL) && !/https?:\/\/(127\.0\.0\.1|localhost)(:|\/)/.test(process.env.BASE_URL), "Save feedback uses the isolated local member fixture");
const detail = "/places/sample-dongmyeong-ramen";

async function capture(page: Page, path: string) {
  // Focus recovery may scroll the page. Anchor the full-page capture so fixed
  // off-screen skip links are not painted into a different scroll tile.
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
  await page.screenshot({ path, fullPage: true });
}

async function setup(context: BrowserContext, page: Page, baseURL: string) {
  await context.addCookies([{ name: "retaste_session", value: "qa-admin-session", url: baseURL }]);
  await page.route((url) => url.origin !== new URL(baseURL).origin && url.protocol.startsWith("http"), route => route.abort());
  await page.goto(detail);
  const original = await page.locator(".save-control").getAttribute("aria-pressed") === "true";
  const save = async (saved: boolean) => {
    const response = await context.request.post(detail, { headers: { Origin: new URL(baseURL).origin }, form: { intent: "save", saved: String(saved) } });
    expect(response.ok()).toBe(true);
  };
  await save(true);
  await page.goto("/me");
  return { original, save };
}

test("pending unsave produces one result and updates the saved list", async ({ context, page, baseURL }, testInfo) => {
  const { original, save } = await setup(context, page, baseURL!);
  let release = () => {};
  const gate = new Promise<void>(resolve => { release = resolve; });
  let posts = 0;
  await page.route((url) => url.pathname === "/me.data", async route => {
    if (route.request().method() === "POST") { posts++; await gate; }
    await route.continue();
  });
  let clicked: Promise<void> | undefined;
  try {
    await page.locator(".member-withdraw summary").click();
    const collection = page.getByRole("region", { name: "저장한 장소", exact: true });
    const row = collection.locator("article").filter({ has: page.locator(`a[href="${detail}"]`) });
    clicked = row.getByRole("button", { name: "저장 해제", exact: true }).click();
    await expect(row.getByRole("button", { name: "저장 해제 중…", exact: true })).toBeDisabled();
    await expect.poll(() => posts).toBe(1);
    await expect(page.getByRole("button", { name: "탈퇴하기", exact: true })).toBeEnabled();
    release(); await clicked;
    await expect(page.locator("#member-save-feedback")).toHaveText("저장을 해제했습니다.");
    await expect(page.locator("#member-save-feedback")).toBeFocused();
    await expect(collection.locator(`a[href="${detail}"]`)).toHaveCount(0);
    expect(posts).toBe(1);
    await capture(page, `docs/evidence/2026-11-18-member-save-success-${testInfo.project.name}.png`);
  } finally {
    release(); await clicked?.catch(() => {});
    await expect(page.getByRole("region", { name: "저장한 장소", exact: true })).toHaveAttribute("aria-busy", "false").catch(() => {});
    await save(original);
    await page.goto(detail);
    await expect(page.locator(".save-control")).toHaveAttribute("aria-pressed", String(original));
  }
});

test("lost responses never replay the write and require a fresh list read", async ({ context, page, baseURL }, testInfo) => {
  const { original, save } = await setup(context, page, baseURL!);
  let posts = 0, commitBeforeLoss = false;
  await page.route((url) => url.pathname === "/me.data", async route => {
    if (route.request().method() !== "POST") return route.continue();
    posts++;
    if (commitBeforeLoss) await route.fetch();
    await route.abort("connectionfailed");
  });
  try {
    const collection = page.getByRole("region", { name: "저장한 장소", exact: true });
    const row = () => collection.locator("article").filter({ has: page.locator(`a[href="${detail}"]`) });
    await row().getByRole("button", { name: "저장 해제", exact: true }).click();
    await expect(page.getByRole("alert")).toContainText("저장 상태를 확인하지 못했습니다.");
    await expect(page.locator("#member-save-feedback")).toBeFocused();
    await expect(row().getByRole("button", { name: "저장 해제", exact: true })).toBeDisabled();
    expect(posts).toBe(1);
    await page.getByRole("link", { name: "현재 목록 다시 확인", exact: true }).click();
    await expect(row().getByRole("button", { name: "저장 해제", exact: true })).toBeEnabled();
    expect(posts).toBe(1);
    commitBeforeLoss = true;
    await row().getByRole("button", { name: "저장 해제", exact: true }).click();
    await expect(page.getByRole("alert")).toContainText("저장 상태를 확인하지 못했습니다.");
    expect(posts).toBe(2);
    await capture(page, `docs/evidence/2026-11-18-member-save-unknown-${testInfo.project.name}.png`);
    await page.getByRole("link", { name: "현재 목록 다시 확인", exact: true }).click();
    await expect(collection.locator(`a[href="${detail}"]`)).toHaveCount(0);
    expect(posts).toBe(2);
  } finally {
    await save(original);
    await page.goto(detail);
    await expect(page.locator(".save-control")).toHaveAttribute("aria-pressed", String(original));
  }
});
