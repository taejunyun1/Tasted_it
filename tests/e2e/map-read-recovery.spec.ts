import { expect, test } from "@playwright/test";
import { execFileSync } from "node:child_process";

const local = !process.env.BASE_URL || ["127.0.0.1", "localhost", "[::1]"].includes(new URL(process.env.BASE_URL).hostname);
test.skip(!local, "Map recovery fixtures run only against the local E2E database.");

function sql(command: string) {
  if (!local) throw new Error("LOCAL_MAP_RECOVERY_FIXTURE_REQUIRED");
  execFileSync("pnpm", ["exec", "wrangler", "d1", "execute", "DB", "--local", "--config", "wrangler.e2e.jsonc", "--persist-to", ".wrangler/e2e-state", "--command", command], { stdio: "pipe" });
}
function setFixtureRole(role: "USER" | "REVIEWER") { sql(`UPDATE users SET role='${role}' WHERE id='qa-active-reviewer'`); }

test.beforeAll(() => {
  sql(["a", "b", "logout-chromium", "logout-mobile-chromium"].map((suffix) =>
    `INSERT OR REPLACE INTO sessions(id,user_id,created_at,expires_at) VALUES('e2e-map-recovery-${suffix}','qa-admin','2026-11-18T00:00:00Z','2099-01-01T00:00:00Z')`
  ).join(";"));
});
test.afterAll(() => sql("DELETE FROM sessions WHERE id LIKE 'e2e-map-recovery-%'"));

test.beforeEach(async ({ page }, testInfo) => {
  await page.setViewportSize(testInfo.project.name === "mobile-chromium" ? { width: 390, height: 844 } : { width: 1440, height: 1000 });
  await page.route(/https:\/\/[^/]*(?:naver\.com|naver\.net|pstatic\.net)\//, (route) => route.abort());
});

test("a failed recommendation transport retains the last successful map and retries explicitly", async ({ page }) => {
  await page.goto("/?qa=1");
  const cards = page.locator(".home-curation-list:visible").first();
  await expect(cards).toBeVisible();
  const before = await cards.textContent();
  await page.route("**/resources/home-recommendations.data?*", (route) => route.abort("failed"));
  await page.getByRole("button", { name: "내 취향", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: "기존 결과" }).first()).toBeVisible();
  await expect(cards).toHaveText(before!);
  await page.unroute("**/resources/home-recommendations.data?*");
  await page.getByRole("button", { name: "다시 시도", exact: true }).click();
  await expect(cards).toHaveAttribute("aria-busy", "false");
  await expect(page.getByRole("status").filter({ hasText: "기존 결과" })).toHaveCount(0);
});

test("a category transport failure retains results and the requested search context", async ({ page }, testInfo) => {
  await page.goto("/maps/ramen-detail?q=라멘&bbox=126.90,35.14,126.93,35.16&selected=sample-place-1&view=list");
  await expect(page.locator(".result-panel .place-card")).toHaveCount(1);
  const attemptedRoutes: string[] = [];
  await page.route("**/maps/ramen-detail.data?*", (route) => { attemptedRoutes.push(new URL(route.request().url()).searchParams.get("_routes") ?? "all"); return route.abort("failed"); });
  await page.getByRole("textbox", { name: "동네 또는 가게" }).fill("동명동");
  await page.getByRole("button", { name: "찾기", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: "마지막으로 확인한 결과" })).toBeVisible();
  await expect(page.locator(".result-panel .place-card")).toHaveCount(1);
  const accessibility = await page.context().newCDPSession(page);
  try {
    const { nodes } = await accessibility.send("Accessibility.getFullAXTree");
    expect(nodes.some(node => !node.ignored && node.role?.value === "heading" && String(node.name?.value).includes("라멘 지도"))).toBe(true);
  } finally { await accessibility.detach(); }
  await expect(page.getByRole("button", { name: "찾기", exact: true })).toBeDisabled();
  const detailLink = page.getByRole("link", { name: "Re:Taste 샘플 라멘 동명 상세 보기", exact: true });
  await detailLink.focus();
  await expect(detailLink).toBeFocused();
  const search = new URL(page.url()).searchParams;
  expect(search.get("q")).toBe("동명동");
  expect(search.get("view")).toBe("list");
  expect(search.get("selected")).toBe("sample-place-1");
  expect(attemptedRoutes).toEqual(["routes/map-category"]);
  await page.screenshot({ path: testInfo.outputPath("category-failed.png"), fullPage: true });
  await page.unroute("**/maps/ramen-detail.data?*");
  await page.getByRole("status").filter({ hasText: "마지막으로 확인한 결과" }).getByRole("button", { name: "지도 다시 불러오기", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: "마지막으로 확인한 결과" })).toHaveCount(0);
  await expect(page.locator(".result-panel .place-card")).toHaveCount(1);
  await page.screenshot({ path: testInfo.outputPath("category-recovered.png"), fullPage: true });
});

test("a browse transport failure keeps the last map without automatically retrying", async ({ page }, testInfo) => {
  await page.goto("/?qa=1&view=browse&q=라멘&bbox=126.90,35.14,126.93,35.16");
  if (testInfo.project.name === "mobile-chromium") await page.getByRole("button", { name: "목록", exact: true }).click();
  const map = page.getByRole("region", { name: "지도 영역" });
  await expect(page.getByRole("textbox", { name: "장소 검색" })).toBeVisible();
  let requests = 0;
  await page.route("**/_.data?*", (route) => { requests += 1; return route.abort("failed"); });
  await page.getByRole("textbox", { name: "장소 검색" }).fill("동명동");
  await page.getByRole("button", { name: "검색", exact: true }).click();
  const error = page.getByRole("status").filter({ hasText: "마지막으로 확인한 결과" });
  await expect(error).toBeVisible();
  await expect(map).toHaveCount(1);
  expect(new URL(page.url()).searchParams.get("q")).toBe("동명동");
  expect(requests).toBe(1);
  await page.unroute("**/_.data?*");
  await error.getByRole("button").click();
  await expect(error).toHaveCount(0);
});

for (const change of ["session", "logout", "role"] as const) {
  test(`a ${change} change discards personal results before accepting another response`, async ({ context, page, baseURL }) => {
    await context.addCookies([{ name: "retaste_session", value: change === "role" ? "qa-active-reviewer-session" : "e2e-map-recovery-a", url: baseURL! }]);
    await page.goto("/?qa=1");
    await expect(page.locator(".home-curation-list:visible").first()).toBeVisible();
    if (change === "session") {
      await page.getByRole("link", { name: /^Re:Taste/ }).click();
      await expect(page).toHaveURL(new RegExp(`${new URL(baseURL!).host}/$`));
    }
    const history = await page.evaluate(() => sessionStorage.getItem("retaste:home-curation-v2"));
    try {
      if (change === "session") await context.addCookies([{ name: "retaste_session", value: "e2e-map-recovery-b", url: baseURL! }]);
      else if (change === "logout") await context.clearCookies();
      else setFixtureRole("USER");
      await page.getByRole("button", { name: "내 취향", exact: true }).click();
      await expect(page.getByRole("heading", { name: "로그인 상태가 변경되었습니다." })).toBeVisible();
      await expect(page.locator(".home-curation-list")).toHaveCount(0);
      expect(await page.evaluate(() => sessionStorage.getItem("retaste:home-curation-v2"))).toBe(history);
      if (change === "session") {
        let reads = 0;
        page.on("request", (request) => { if (request.url().includes(".data")) reads += 1; });
        await page.goBack();
        await expect(page).toHaveURL(/\?qa=1$/);
        await expect(page.getByRole("heading", { name: "로그인 상태가 변경되었습니다." })).toBeVisible();
        await expect(page.locator(".home-curation-list")).toHaveCount(0);
        expect(reads).toBe(0);
      }
      await page.getByRole("button", { name: "지도 다시 불러오기", exact: true }).click();
      await expect(page.locator(".home-curation-list:visible").first()).toBeVisible();
    } finally { if (change === "role") setFixtureRole("REVIEWER"); }
  });
}

test("a logout action revalidates identity and removes the previous personal view", async ({ context, page, baseURL }, testInfo) => {
  await context.addCookies([{ name: "retaste_session", value: `e2e-map-recovery-logout-${testInfo.project.name}`, url: baseURL! }]);
  await page.goto("/?qa=1");
  await expect(page.locator(".home-curation-list:visible").first()).toBeVisible();
  await page.getByRole("button", { name: "메뉴", exact: true }).click();
  await page.getByRole("button", { name: "로그아웃", exact: true }).click();
  await expect(page.getByLabel("로그인됨 · QA 관리자")).toHaveCount(0);
  await expect(page.locator(".home-curation-list:visible").first()).toBeVisible();
  await expect(page.getByRole("heading", { name: "로그인 상태가 변경되었습니다." })).toHaveCount(0);
});

test("a delayed category response cannot replace a newer completed search", async ({ page }) => {
  await page.goto("/maps/ramen-detail?q=라멘&bbox=126.90,35.14,126.93,35.16&view=list");
  await expect(page.locator(".result-panel .place-card")).toHaveCount(1);
  let release!: () => void;
  let entered!: () => void;
  const delayed = new Promise<void>((resolve) => { entered = resolve; });
  const gate = new Promise<void>((resolve) => { release = resolve; });
  await page.route("**/maps/ramen-detail.data?*", async (route) => {
    if (new URL(route.request().url()).searchParams.get("q") === "동명동") {
      entered();
      await gate;
    }
    await route.continue().catch(() => undefined);
  });
  await page.getByRole("textbox", { name: "동네 또는 가게" }).fill("동명동");
  await page.getByRole("button", { name: "찾기", exact: true }).click();
  await delayed;
  await page.getByRole("textbox", { name: "동네 또는 가게" }).fill("없는장소");
  await page.getByRole("button", { name: "찾기", exact: true }).click();
  await expect(page.getByText("이 범위에서 조건에 맞는 장소를 찾지 못했어요.")).toBeVisible();
  release();
  await expect(page.getByRole("textbox", { name: "동네 또는 가게" })).toHaveValue("없는장소");
  await expect(page.locator(".result-panel .place-card")).toHaveCount(0);
  await expect(page.getByRole("status").filter({ hasText: "마지막으로 확인한 결과" })).toHaveCount(0);
});
