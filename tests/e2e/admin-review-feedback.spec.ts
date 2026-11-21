import { execFileSync } from "node:child_process";
import { expect, test } from "@playwright/test";

test("admin sees every skipped ID, paged suggestions, named table and forbidden message", async ({ page, baseURL }, info) => {
  test.skip(!baseURL?.startsWith("http://127.0.0.1:"), "Synthetic local fixtures only");
  test.setTimeout(90_000);
  const prefix = `qa-admin-feedback-${info.project.name}`;
  const now = "2001-01-01T00:00:00.000Z";
  const sql = (query: string) => {
    const output = execFileSync("pnpm", ["exec", "wrangler", "d1", "execute", "DB", "--local", "--config", "wrangler.e2e.jsonc", "--persist-to", ".wrangler/e2e-state", "--json", "--command", query], { encoding: "utf8" });
    // pnpm can print workspace engine notices before Wrangler's JSON array.
    const start = output.search(/^\s*\[\s*\{/m);
    if (start < 0) throw new Error("Local D1 did not return JSON results");
    return JSON.parse(output.slice(start)) as Array<{ results: Array<Record<string, unknown>> }>;
  };
  const cleanup = () => sql(`DELETE FROM place_suggestions WHERE id LIKE '${prefix}-%'; DELETE FROM place_review_work_items WHERE id LIKE '${prefix}-%'; DELETE FROM business_licenses WHERE id LIKE '${prefix}-%'; DELETE FROM users WHERE id='${prefix}';`);
  cleanup();
  const priorTotal = Number(sql("SELECT COUNT(*) AS total FROM place_suggestions WHERE status IN ('SUBMITTED','NEEDS_INFO','REVIEWING')")[0]!.results[0]!.total);
  const suggestionRows = Array.from({ length: 201 }, (_, index) => {
    const suffix = String(index).padStart(3, "0");
    return `('${prefix}-${suffix}','${prefix}','SUBMITTED','합성 제안 ${suffix}','합성제안${suffix}','광주광역시 동구 합성로 1','광주광역시동구합성로1','합성동','cat-ramen','${now}','${now}')`;
  }).join(",");
  sql(`INSERT INTO users(id,email,display_name,role,created_at,updated_at) VALUES('${prefix}','${prefix}@example.test','합성 제안자','USER','${now}','${now}'); INSERT INTO place_suggestions(id,user_id,status,name,normalized_name,address,normalized_address,neighborhood,category_id,created_at,updated_at) VALUES ${suggestionRows};`);
  for (let index = 0; index < 2; index += 1) sql(`INSERT INTO business_licenses(id,source_type,source_management_no,business_name,normalized_status,road_address,region_code,raw_payload,first_seen_at,last_seen_at,created_at,updated_at) VALUES('${prefix}-license-${index}','GENERAL_RESTAURANT','${prefix}-${index}','${prefix} 검수 ${index}','OPEN','광주광역시 동구 합성로 1','GWANGJU','{}','${now}','${now}','${now}','${now}'); INSERT INTO place_review_work_items(id,business_license_id,source_kind,stage,status,stage_version,created_at,updated_at) VALUES('${prefix}-work-${index}','${prefix}-license-${index}','PUBLIC_DATA','SOURCE_REVIEW','ACTIVE',0,'${now}','${now}');`);
  await page.route("**/*", route => new URL(route.request().url()).origin === new URL(baseURL!).origin ? route.continue() : route.abort());
  try {
    await page.context().addCookies([{ name: "retaste_session", value: "qa-reviewer-member-session", url: baseURL! }]);
    expect((await page.goto("/admin/data-sync"))?.status()).toBe(403);
    await expect(page.getByRole("heading", { name: "관리자만 조회할 수 있습니다." })).toBeVisible();
    await page.screenshot({ path: info.outputPath("admin-sync-forbidden.png") });

    await page.context().addCookies([{ name: "retaste_session", value: "qa-admin-session", url: baseURL! }]);
    await page.goto(`/admin/place-operations?step=1&q=${prefix}&suggestionPage=8`);
    const suggestionNav = page.getByRole("navigation", { name: "회원 장소 제안 페이지" });
    await expect(suggestionNav).toContainText(`총 ${201 + priorTotal}건`);
    await suggestionNav.getByRole("link", { name: "다음", exact: true }).click();
    await expect(page).toHaveURL(/suggestionPage=9/);
    await expect(page.locator(`[data-suggestion-id='${prefix}-200']`)).toBeVisible();
    await expect(page.getByLabel("검색", { exact: true }).first()).toHaveValue(prefix);

    for (let index = 0; index < 2; index += 1) await page.getByRole("checkbox", { name: `${prefix} 검수 ${index} 선택`, exact: true }).check();
    await expect(page.locator(".place-review-selection-bar").getByText("2 / 100 선택", { exact: true })).toBeVisible();
    sql(`UPDATE place_review_work_items SET stage_version=1 WHERE id LIKE '${prefix}-work-%';`);
    await page.getByRole("button", { name: "수동으로 NAVER 검증 대기로 이동", exact: true }).click();
    const skipped = page.getByRole("status", { name: "건너뛴 항목" });
    await expect(skipped).toContainText("건너뛴 항목 2건");
    await expect(skipped).toContainText(`${prefix}-work-0`);
    await expect(skipped).toContainText(`${prefix}-work-1`);
    await expect(skipped).toContainText("다른 작업자가 먼저 처리");
    expect(sql(`SELECT stage,stage_version FROM place_review_work_items WHERE id LIKE '${prefix}-work-%'`)[0]!.results).toEqual([{ stage: "SOURCE_REVIEW", stage_version: 1 }, { stage: "SOURCE_REVIEW", stage_version: 1 }]);
    await skipped.screenshot({ path: info.outputPath("admin-skipped-results.png") });
    await page.locator("section[aria-labelledby='suggestion-review-heading']").screenshot({ path: info.outputPath("admin-suggestion-page-nine.png") });
    await page.getByRole("button", { name: "선택 중 2곳 NAVER 검증", exact: true }).click();
    await expect(page.getByText("NAVER 순차 검증 완료 · 통과 0곳 · 확인 필요 0곳 · 실패 2곳", { exact: true })).toBeVisible();
    const sequentialSkipped = page.getByRole("status", { name: "건너뛴 항목" }).last();
    await expect(sequentialSkipped).toContainText(`${prefix}-work-0`);
    await expect(sequentialSkipped).toContainText(`${prefix}-work-1`);
    const reviewNav = page.locator(".place-review-pagination").nth(1);
    await expect(reviewNav.getByRole("link", { name: "이전", exact: true })).toHaveCount(0);
    await expect(reviewNav.getByRole("link", { name: "다음", exact: true })).toHaveCount(0);
    await expect(reviewNav.locator("span[aria-disabled='true']")).toHaveCount(2);
    expect(await reviewNav.locator("span[aria-disabled='true']").evaluateAll(nodes => nodes.every(node => (node as HTMLElement).tabIndex === -1))).toBe(true);

    await page.goto("/admin/places");
    await expect(page.getByRole("table", { name: /등록된 장소 목록/ })).toBeVisible();
    if ((page.viewportSize()?.width ?? 1280) < 640) {
      expect(await page.getByRole("table", { name: /등록된 장소 목록/ }).evaluate(table => {
        const wrapper = table.parentElement!;
        return table.getBoundingClientRect().width >= 640 && wrapper.scrollWidth > wrapper.clientWidth;
      })).toBe(true);
      const scrollRegion = page.getByRole("region", { name: "장소 목록 가로 스크롤" });
      await scrollRegion.focus();
      await expect(scrollRegion).toBeFocused();
      await page.keyboard.press("ArrowRight");
      await expect.poll(() => scrollRegion.evaluate(element => element.scrollLeft)).toBeGreaterThan(0);
      await scrollRegion.evaluate(element => { element.scrollLeft = 0; });
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({ path: info.outputPath("admin-places-table.png") });
  } finally {
    cleanup();
    expect(Number(sql(`SELECT COUNT(*) AS total FROM place_suggestions WHERE id LIKE '${prefix}-%'`)[0]!.results[0]!.total)).toBe(0);
  }
});
