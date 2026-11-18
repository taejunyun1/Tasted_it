import { execFileSync } from "node:child_process";
import { expect, test } from "@playwright/test";
import { isControlledLocalBaseUrl } from "./local-test-target";

test.skip(!isControlledLocalBaseUrl(), "Uses isolated synthetic local places only");
test("same-route target navigation updates selection and composing Enter remains untouched", async ({ page }) => {
  const next = "/corrections/new?placeId=sample-place-3";
  await page.goto(`/corrections/new?${new URLSearchParams({ placeId: "sample-place-1", returnTo: next })}`);
  await page.getByRole("link", { name: "이전 화면으로 돌아가기" }).click();
  await expect(page).toHaveURL(/placeId=sample-place-3$/);
  await expect.soft(page.locator('input[name="placeId"]')).toHaveValue("sample-place-3");
  const search = page.getByRole("textbox", { name: "장소 검색", exact: true });
  expect.soft(await search.evaluate(element => element.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", isComposing: true, bubbles: true, cancelable: true })))).toBe(true);
  await page.goBack();
  await expect(page.locator('input[name="placeId"]')).toHaveValue("sample-place-1");
});

test("correction search reaches the 1005th place and preserves its target, return link and draft", async ({ page, baseURL }, info) => {
  const prefix = `qa-correction-search-${info.project.name}`;
  const target = `${prefix}-1004`, returnTo = "/places/sample-dongmyeong-ramen?origin=map";
  const sql = (query: string) => execFileSync(process.execPath, ["node_modules/wrangler/bin/wrangler.js", "d1", "execute", "DB", "--local", "--config", "wrangler.e2e.jsonc", "--persist-to", ".wrangler/e2e-state", "--command", query], { stdio: "pipe" });
  const cleanup = () => sql(`DELETE FROM place_categories WHERE place_id LIKE '${prefix}-%'; DELETE FROM places WHERE id LIKE '${prefix}-%';`);
  cleanup();
  sql(`WITH RECURSIVE seq(n) AS (SELECT 0 UNION ALL SELECT n+1 FROM seq WHERE n<1004)
    INSERT INTO places(id,slug,name,status,address,neighborhood,latitude,longitude,search_text,created_at,updated_at)
    SELECT '${prefix}-'||n,'${prefix}-'||n,'${prefix} 식당 '||printf('%04d',n),'PUBLISHED','광주광역시 합성로 '||n,'합성동',35.14,126.92,'합성 검색','2026-11-18T00:00:00Z','2026-11-18T00:00:00Z' FROM seq;
    INSERT INTO place_categories(place_id,category_id,is_primary) SELECT id,'cat-ramen',1 FROM places WHERE id LIKE '${prefix}-%';`);
  let postCount = 0;
  let releaseSearch = () => {};
  page.on("request", request => { if (request.method() === "POST") postCount += 1; });
  await page.route("**/*", route => new URL(route.request().url()).origin === new URL(baseURL!).origin ? route.continue() : route.abort());
  try {
    await page.goto(`/corrections/new?${new URLSearchParams({ placeId: target, returnTo })}`);
    await expect(page.locator('input[name="placeId"]')).toHaveValue(target);
    await expect(page.getByText("선택한 장소:", { exact: false })).toContainText(`${prefix} 식당 1004`);
    await expect(page.getByRole("link", { name: "이전 화면으로 돌아가기" })).toHaveAttribute("href", returnTo);
    await page.getByLabel("요청자 관계", { exact: true }).fill("방문자");
    await page.getByLabel("확인 이메일", { exact: true }).fill("draft-only@example.test");
    await page.getByLabel("변경 상호", { exact: true }).fill("유지할 정정 상호");
    await page.getByLabel("근거 설명", { exact: true }).fill("검색과 페이지 이동에도 보존되어야 하는 합성 초안입니다.");
    const search = page.getByRole("textbox", { name: "장소 검색", exact: true });
    const results = page.getByRole("group", { name: "정정 장소 검색 결과", exact: true });

    const firstSearch = new Promise<void>(resolve => { releaseSearch = resolve; });
    await page.route("**/resources/correction-places.data*", async route => { await firstSearch; await route.continue(); }, { times: 1 });
    await search.fill(prefix);
    await page.getByRole("button", { name: "장소 찾기", exact: true }).click();
    await expect(page.getByRole("button", { name: "장소 검색 중…", exact: true })).toBeDisabled();
    await expect(page.locator('input[name="placeId"]')).toHaveValue(target);
    await expect(page.getByLabel("변경 상호", { exact: true })).toHaveValue("유지할 정정 상호");
    releaseSearch();
    await expect(results.getByRole("button")).toHaveCount(20);
    await expect(results).toContainText(`${prefix} 식당 0000`);
    await page.getByRole("button", { name: "다음 장소", exact: true }).click();
    await expect(results).toContainText(`${prefix} 식당 0020`);
    await expect(page.locator('input[name="placeId"]')).toHaveValue(target);
    await expect(page.getByLabel("변경 상호", { exact: true })).toHaveValue("유지할 정정 상호");

    await page.route("**/resources/correction-places.data*", route => route.abort());
    await search.fill(`${prefix} 식당 1004`);
    await page.getByRole("button", { name: "장소 찾기", exact: true }).click();
    await expect(page.getByRole("alert")).toContainText("입력 내용은 유지됩니다");
    await expect(results).toContainText(`${prefix} 식당 0020`);
    await expect(page.locator('input[name="placeId"]')).toHaveValue(target);
    await expect(page.getByLabel("확인 이메일", { exact: true })).toHaveValue("draft-only@example.test");
    await expect(page.getByLabel("근거 설명", { exact: true })).toHaveValue("검색과 페이지 이동에도 보존되어야 하는 합성 초안입니다.");
    await page.screenshot({ path: info.outputPath("correction-search-failure.png") });

    await page.unroute("**/resources/correction-places.data*");
    await page.getByRole("button", { name: "검색 다시 시도", exact: true }).click();
    await expect(results.getByRole("button")).toHaveCount(1);
    await expect(results).toContainText(`${prefix} 식당 1004`);
    await results.getByRole("button").click();
    await expect(results.getByRole("button")).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator('input[name="returnTo"]')).toHaveValue(returnTo);
    await expect(page.getByLabel("요청자 관계", { exact: true })).toHaveValue("방문자");
    await expect(page.getByLabel("변경 상호", { exact: true })).toHaveValue("유지할 정정 상호");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect(postCount).toBe(0);
    await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
    await page.screenshot({ path: info.outputPath("correction-search-restored.png"), fullPage: true });

    await page.reload();
    await expect(page.locator('input[name="placeId"]')).toHaveValue(target);
    await expect(page.getByRole("link", { name: "이전 화면으로 돌아가기" })).toHaveAttribute("href", returnTo);
    await page.getByLabel("요청자 관계", { exact: true }).fill("방문자");
    await page.getByLabel("확인 이메일", { exact: true }).fill("stale-only@example.test");
    await page.getByLabel("근거 설명", { exact: true }).fill("대상이 회수되어도 보존할 합성 근거입니다.");
    sql(`UPDATE places SET closed_at='2026-11-18T01:00:00Z' WHERE id='${target}';`);
    await page.getByRole("button", { name: "확인 이메일 보내기", exact: true }).click();
    await expect(page.getByRole("alert")).toContainText("장소를 다시 선택해 주세요");
    await expect(page.getByRole("textbox", { name: "근거 설명", exact: true })).toHaveValue("대상이 회수되어도 보존할 합성 근거입니다.");
    await expect(page.getByRole("button", { name: "확인 이메일 보내기", exact: true })).toBeDisabled();
    await search.fill(`${prefix} 식당 1003`);
    await page.getByRole("button", { name: "장소 찾기", exact: true }).click();
    await expect(results.getByRole("button")).toHaveCount(1);
    await results.getByRole("button").click();
    await expect(page.locator('input[name="placeId"]')).toHaveValue(`${prefix}-1003`);
    await expect(page.getByRole("button", { name: "확인 이메일 보내기", exact: true })).toBeEnabled();
    expect(postCount).toBe(1);
  } finally { releaseSearch(); cleanup(); }
});
