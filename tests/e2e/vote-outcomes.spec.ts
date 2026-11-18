import { expect, test, type Page } from "@playwright/test";
import { voteOutcomesFixture } from "./vote-outcomes-fixture";
import { isControlledLocalBaseUrl } from "./local-test-target";

test.skip(!isControlledLocalBaseUrl(), "U05 uses isolated local vote fixtures");

async function open(page: Page, baseURL: string, id: string) {
  await page.context().addCookies([{ name: "retaste_session", value: id, url: baseURL }]);
  await page.route("**/*", route => new URL(route.request().url()).origin === new URL(baseURL).origin ? route.continue() : route.abort());
  await page.goto(`/places/${id}`);
  await expect(page.getByRole("button", { name: "추천", exact: true })).toBeVisible();
  await interactive(page);
}

async function interactive(page: Page) {
  // A successful GET renders usable native forms before hydration. Wait for a
  // read-only UI interaction before testing the client response-loss boundary.
  const toggle = page.getByRole("button", { name: "비추천", exact: true });
  const previous = await toggle.getAttribute("aria-expanded");
  await expect(async () => {
    await toggle.click();
    expect(await toggle.getAttribute("aria-expanded")).toBe(previous === "true" ? "false" : "true");
  }).toPass({ timeout: 5000 });
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-expanded", previous!);
}

test("vote pending prevents duplicate submissions and announces add, change and cancel", async ({ page, baseURL }, info) => {
  const f = voteOutcomesFixture(baseURL!, info.project.name); f.create();
  let release = () => {}; const gate = new Promise<void>(resolve => { release = resolve; }); let posts = 0;
  try {
    await open(page, baseURL!, f.id);
    await page.route(`**/places/${f.id}.data*`, async route => {
      if (route.request().method() === "POST") { posts++; await gate; }
      await route.continue();
    });
    await page.getByRole("button", { name: "추천", exact: true }).evaluate((button: HTMLButtonElement) => {
      button.form!.requestSubmit(button); button.form!.requestSubmit(button);
    });
    await expect(page.locator("#vote-feedback")).toContainText("추천 반영 중");
    await expect(page.getByRole("button", { name: "비추천", exact: true })).toBeDisabled();
    expect(posts).toBe(1);
    release();
    await expect(page.locator("#vote-feedback")).toHaveText("추천을 반영했습니다.");
    await expect(page.locator("#vote-feedback")).toBeFocused();
    expect(f.events()).toEqual([{ event_type: "CREATE", value: 1 }]);
    await page.getByRole("button", { name: "비추천", exact: true }).click();
    await page.getByRole("radio", { name: "가격", exact: true }).check();
    await page.getByRole("button", { name: "비추천 반영", exact: true }).click();
    await expect(page.locator("#vote-feedback")).toHaveText("비추천을 반영했습니다.");
    expect(f.state()).toBe(-1);
    await page.getByRole("radio", { name: "메뉴", exact: true }).check();
    await page.getByRole("button", { name: "비추천 반영", exact: true }).click();
    await expect(page.locator("#vote-feedback")).toBeFocused();
    expect(f.events()).toHaveLength(2);
    await page.getByRole("button", { name: "평가 취소", exact: true }).click();
    await expect(page.locator("#vote-feedback")).toHaveText("평가를 취소했습니다.");
    expect(f.state()).toBeNull();
    expect(f.events()).toEqual([{ event_type: "CREATE", value: 1 }, { event_type: "CHANGE", value: -1 }, { event_type: "WITHDRAW", value: -1 }]);
    await page.screenshot({ path: info.outputPath("u05-vote-success.png"), fullPage: true });
  } finally { release(); f.cleanup(); }
});

test("lost add and cancel responses require fresh reads both before delivery and after commit", async ({ page, baseURL }, info) => {
  test.setTimeout(60_000);
  const f = voteOutcomesFixture(baseURL!, info.project.name); f.create();
  let posts = 0, commit = false;
  try {
    await open(page, baseURL!, f.id);
    await page.route(`**/places/${f.id}.data*`, async route => {
      if (route.request().method() !== "POST") return route.continue();
      posts++;
      if (commit) expect((await route.fetch()).ok()).toBe(true);
      await route.abort("connectionfailed");
    });
    for (const [operation, committed, expectedState] of [
      ["추천", false, null], ["추천", true, 1], ["평가 취소", false, 1], ["평가 취소", true, null],
    ] as const) {
      commit = committed;
      const previousPosts = posts;
      await page.getByRole("button", { name: operation, exact: true }).click();
      await expect(page.getByRole("alert")).toContainText("처리 결과를 확인하지 못했어요.");
      await expect(page.locator("#vote-feedback")).toBeFocused();
      await expect(page.getByRole("button", { name: "추천", exact: true })).toBeDisabled();
      await expect(page.getByRole("button", { name: "비추천", exact: true })).toBeDisabled();
      expect(f.state()).toBe(expectedState);
      expect(posts).toBe(previousPosts + 1);
      if (committed && operation === "평가 취소") await page.screenshot({ path: info.outputPath("u05-vote-unknown.png"), fullPage: true });
      await page.getByRole("button", { name: "현재 상태 다시 확인", exact: true }).click();
      await expect(page.getByRole("alert")).toHaveCount(0);
      await expect(page.getByRole("button", { name: "추천", exact: true })).toHaveAttribute("aria-pressed", String(expectedState === 1));
      await interactive(page);
      expect(posts).toBe(previousPosts + 1);
    }
    expect(f.events()).toEqual([{ event_type: "CREATE", value: 1 }, { event_type: "WITHDRAW", value: 1 }]);
  } finally { f.cleanup(); }
});

test("a changed vote blocks stale cancellation until the current choice is read", async ({ page, baseURL }, info) => {
  const f = voteOutcomesFixture(baseURL!, info.project.name); f.create();
  const post = (value: string) => page.request.post(`/places/${f.id}`, { headers: { Origin: new URL(baseURL!).origin }, form: { intent: "vote", value, ...(value === "-1" ? { reason: "MENU" } : {}) } });
  try {
    await open(page, baseURL!, f.id);
    expect((await post("1")).ok()).toBe(true); await page.reload();
    expect((await post("-1")).ok()).toBe(true);
    await page.getByRole("button", { name: "평가 취소", exact: true }).click();
    await expect(page.locator("#vote-feedback")).toContainText("다른 요청에서 평가가 변경되었습니다.");
    await expect(page.getByRole("button", { name: "평가 취소", exact: true })).toBeDisabled();
    await expect(page.locator(".save-control")).toBeDisabled();
    expect(f.state()).toBe(-1); expect(f.events()).toHaveLength(2);
    await page.getByRole("button", { name: "현재 상태 다시 확인", exact: true }).click();
    await expect(page.getByRole("button", { name: "비추천", exact: true })).toHaveAttribute("aria-pressed", "true");
    expect(f.events()).toHaveLength(2);
  } finally { f.cleanup(); }
});
