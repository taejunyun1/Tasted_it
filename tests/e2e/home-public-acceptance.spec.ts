import { expect, test } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { isControlledLocalBaseUrl } from "./local-test-target";

test.skip(!isControlledLocalBaseUrl(), "Uses only an isolated local D1 fixture");

function localD1(sql: string) {
  return execFileSync("pnpm", ["exec", "wrangler", "d1", "execute", "DB", "--local", "--config", "wrangler.e2e.jsonc", "--persist-to", ".wrangler/e2e-state", "--command", sql], { encoding: "utf8", stdio: "pipe" });
}

const bounds = "126.405,34.665,126.455,34.705";

test("home candidates, real food selection and empty results agree with public D1 eligibility", async ({ page, request }, testInfo) => {
  const prefix = `u01-acceptance-${testInfo.project.name}`;
  const ids = ["soup", "noodle", "hidden", "recalled", "nonfood", "outside"].map(kind => `${prefix}-${kind}`);
  const categoryIds = ["soup", "noodle", "empty"].map(kind => `${prefix}-cat-${kind}`);
  const cleanup = () => localD1(`DELETE FROM place_categories WHERE place_id LIKE '${prefix}-%'; DELETE FROM places WHERE id LIKE '${prefix}-%'; DELETE FROM categories WHERE parent_id='${prefix}-parent'; DELETE FROM categories WHERE id='${prefix}-parent';`);
  cleanup();
  try {
    localD1(`
    INSERT INTO categories(id,slug,name,emoji,sort_order,is_active,created_at,updated_at)
    VALUES('${prefix}-parent','${prefix}-parent','U01 실증 음식','🍽️',980,1,'2026-11-18','2026-11-18');
    INSERT INTO categories(id,slug,name,emoji,sort_order,is_active,parent_id,created_at,updated_at) VALUES
      ('${categoryIds[0]}','${categoryIds[0]}','U01 국밥','🍲',981,1,'${prefix}-parent','2026-11-18','2026-11-18'),
      ('${categoryIds[1]}','${categoryIds[1]}','U01 면','🍜',982,1,'${prefix}-parent','2026-11-18','2026-11-18'),
      ('${categoryIds[2]}','${categoryIds[2]}','U01 회','🐟',983,1,'${prefix}-parent','2026-11-18','2026-11-18');
    INSERT INTO places(id,slug,name,status,address,neighborhood,latitude,longitude,search_text,created_at,updated_at) VALUES
      ('${ids[0]}','${ids[0]}','U01 검수 국밥','PUBLISHED','전남 실증 지역','실증동',34.685,126.430,'U01 국밥','2026-11-18','2026-11-18'),
      ('${ids[1]}','${ids[1]}','U01 검수 면','PUBLISHED','전남 실증 지역','실증동',34.686,126.431,'U01 면','2026-11-18','2026-11-18'),
      ('${ids[2]}','${ids[2]}','U01 비공개 국밥','HIDDEN','전남 실증 지역','실증동',34.687,126.432,'U01 국밥','2026-11-18','2026-11-18'),
      ('${ids[3]}','${ids[3]}','U01 회수 면','PUBLISHED','전남 실증 지역','실증동',34.688,126.433,'U01 면','2026-11-18','2026-11-18'),
      ('${ids[4]}','${ids[4]}','U01 PC방','PUBLISHED','전남 실증 지역','실증동',34.689,126.434,'U01 국밥','2026-11-18','2026-11-18'),
      ('${ids[5]}','${ids[5]}','U01 다른 지역 회','PUBLISHED','전남 다른 실증 지역','외부동',34.000,127.800,'U01 회','2026-11-18','2026-11-18');
    INSERT INTO place_categories(place_id,category_id,is_primary) VALUES
      ('${ids[0]}','${categoryIds[0]}',1),('${ids[1]}','${categoryIds[1]}',1),
      ('${ids[2]}','${categoryIds[0]}',1),('${ids[3]}','${categoryIds[1]}',1),
      ('${ids[4]}','${categoryIds[0]}',1),('${ids[5]}','${categoryIds[2]}',1);
    UPDATE places SET status='HIDDEN' WHERE id='${ids[3]}';
    `);
    await page.setViewportSize(testInfo.project.name === "mobile-chromium" ? { width: 390, height: 844 } : { width: 1440, height: 1000 });
    await page.route(url => url.origin !== new URL(testInfo.project.use.baseURL!).origin, route => route.abort());
    const contractResponse = await request.get(`/resources/home-recommendations?mode=now&bbox=${bounds}&locationSource=map_center&requestToken=${prefix}`);
    expect(contractResponse.status()).toBe(200);
    const contract = await contractResponse.json();
    expect(contract.recommendations.candidateCount).toBe(2);
    expect(contract.recommendations.places.map((place: { id: string }) => place.id).sort()).toEqual(ids.slice(0, 2).sort());
    await page.goto(`/?qa=1&bbox=${bounds}`);
    const presentation = page.locator(testInfo.project.name === "mobile-chromium" ? ".home-curation-sheet" : ".home-curation-panel");
    await expect(presentation.locator(".home-curation-card")).toHaveCount(2);
    expect(await presentation.locator(".home-curation-card").evaluateAll(nodes => nodes.map(node => node.getAttribute("data-place-id")).sort())).toEqual(ids.slice(0, 2).sort());
    await expect(presentation).not.toContainText("U01 비공개");
    await expect(presentation).not.toContainText("U01 회수");
    await expect(presentation).not.toContainText("PC방");
    await page.screenshot({ path: testInfo.outputPath("home-curated.png") });

    await page.getByRole("button", { name: "전체 지도", exact: true }).click();
    if (testInfo.project.name === "mobile-chromium") await page.getByRole("button", { name: "목록", exact: true }).click();
    const explorer = page.locator(".map-explorer-panel");
    const rows = explorer.locator(".map-place-list > li");
    await expect(rows).toHaveCount(2);
    await explorer.getByRole("group", { name: "대표 카테고리", exact: true }).getByRole("button", { name: /U01 실증 음식/ }).click();
    const children = explorer.getByRole("group", { name: "세부 카테고리", exact: true });
    await children.getByRole("button", { name: /^U01 국밥,/ }).click();
    await expect(rows).toHaveCount(1);
    await expect(rows.first()).toContainText("U01 검수 국밥");
    expect(new URL(page.url()).searchParams.get("category")).toBe(categoryIds[0]);
    await children.getByRole("button", { name: /^U01 면,/ }).click();
    await expect(rows).toHaveCount(1);
    await expect(rows.first()).toContainText("U01 검수 면");
    await page.screenshot({ path: testInfo.outputPath("home-category.png") });
    const beforeEmptyBounds = new URL(page.url()).searchParams.get("bbox");
    await children.getByRole("button", { name: /^U01 회,/ }).click();
    await expect(rows).toHaveCount(0);
    await expect(explorer.getByText("이 범위에는 조건에 맞는 장소가 없어요.", { exact: false })).toBeVisible();
    const expand = explorer.getByRole("button", { name: "전체 결과 1곳 보기", exact: true });
    await expand.scrollIntoViewIfNeeded();
    await expect(expand).toBeInViewport();
    expect(new URL(page.url()).searchParams.get("bbox")).toBe(beforeEmptyBounds);
    await page.screenshot({ path: testInfo.outputPath("home-empty-category.png") });

    await page.goto("/?qa=1&bbox=128.49,37.79,128.51,37.81");
    await expect(presentation.locator(".home-curation-card")).toHaveCount(0);
    await expect(presentation.getByText("이 지도 범위에서는 추천할 장소를 찾지 못했어요.", { exact: true })).toBeVisible();
    await expect(presentation.locator(".home-curation-error")).toHaveCount(0);
    await page.screenshot({ path: testInfo.outputPath("home-empty-region.png") });
  } finally { cleanup(); }
});
