import { execFileSync } from "node:child_process";
import { expect, test } from "@playwright/test";
import { isControlledLocalBaseUrl } from "./local-test-target";

test.skip(!isControlledLocalBaseUrl(), "평점 합성 자료는 격리한 로컬 D1에서만 검증합니다.");
let key = "";
const now = "2026-11-18T02:00:00.000Z";
const states = [
  { suffix: "fresh", count: 8, summary: "추천 83% · 8명 평가", time: "공개 결과 계산", stale: false },
  { suffix: "stale", count: 12, summary: "추천 지표 계산 대기 · 12명 평가", time: "이전 계산", stale: true },
  { suffix: "missing", count: 7, summary: "표본 수집 중 · 7/8", time: "미계산", stale: true },
];
function localSql(sql: string) {
  execFileSync(process.execPath, ["node_modules/wrangler/bin/wrangler.js", "d1", "execute", "DB", "--local", "--config", "wrangler.e2e.jsonc", "--persist-to", ".wrangler/e2e-state", "--command", sql], { stdio: "pipe" });
}

test.beforeAll(() => {
  key = `rating-ui-${crypto.randomUUID().slice(0, 8)}`;
  const statements: string[] = [];
  for (const state of states) {
    const id = `${key}-${state.suffix}`;
    statements.push(`INSERT INTO places(id,slug,name,status,address,neighborhood,latitude,longitude,search_text,created_at,updated_at) VALUES('${id}','${id}','평점 검증 ${state.suffix}','PUBLISHED','광주광역시 합성 주소','합성',35.15,126.9,'${id}','${now}','${now}'); INSERT INTO place_categories(place_id,category_id,is_primary) VALUES('${id}','cat-ramen',1);`);
    for (let index = 0; index <= state.count; index++) {
      const user = `${id}-user-${index}`;
      // One legacy reviewer event is deliberately ineligible in every state.
      const legacy = index === state.count;
      statements.push(`INSERT INTO users(id,email,display_name,role,created_at,updated_at) VALUES('${user}','${user}@example.test','합성 회원','${legacy ? "REVIEWER" : "USER"}','${now}','${now}'); INSERT INTO vote_events(id,place_id,user_id,value,event_type,source,created_at) VALUES('${user}','${id}','${user}',1,'CREATE','${legacy ? "LEGACY_REVIEWER" : "GENERAL"}','${now}'); INSERT INTO current_votes(place_id,user_id,event_id,value,updated_at) VALUES('${id}','${user}','${user}',1,'${now}');`);
    }
  }
  // Stamp after all writes: publication and vote triggers change these versions.
  for (const state of states.filter((entry) => entry.suffix !== "missing")) {
    const id = `${key}-${state.suffix}`;
    statements.push(`INSERT INTO rating_snapshots(id,place_id,config_id,input_hash,moderation_epoch,vote_revision,overall_score,user_score,reviewer_score,overall_sample_count,user_sample_count,reviewer_sample_count,reviewer_raw_weight,reviewer_combined_weight,reviewer_weight_share,reasons_json,is_stale,computed_at,created_at,updated_at) SELECT '${id}','${id}','rating-config-v2','${id}',(SELECT epoch FROM reviewer_publication_state WHERE id='global'),vote_revision,${state.stale ? 99 : 83},${state.stale ? 99 : 83},NULL,${state.stale ? 90 : 8},${state.stale ? 90 : 8},0,0,0,0,'{}',${state.stale ? 1 : 0},'${now}','${now}','${now}' FROM places WHERE id='${id}';`);
  }
  localSql(statements.join("\n"));
});
test.afterAll(() => {
  if (key) localSql(`DELETE FROM current_votes WHERE substr(place_id,1,${key.length})='${key}'; DELETE FROM vote_events WHERE substr(place_id,1,${key.length})='${key}'; DELETE FROM places WHERE substr(id,1,${key.length})='${key}'; DELETE FROM users WHERE substr(id,1,${key.length})='${key}';`);
});

test("card, map, sheet and detail share current, stale and missing rating states", async ({ page }, testInfo) => {
  test.setTimeout(90_000);
  const mobile = testInfo.project.name.includes("mobile");
  if (mobile) await page.setViewportSize({ width: 320, height: 844 });
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.route(/https:\/\/[^/]*(?:naver\.com|naver\.net|pstatic\.net)\//, (route) => route.abort());
  for (const state of states) {
    const id = `${key}-${state.suffix}`;
    await page.goto(`/places?q=${id}`);
    const card = page.locator(".discovery-all").locator(`#place-${id}`);
    await expect(card).toContainText(state.summary);
    await expect(card.locator(".public-rating-meta")).toHaveAttribute("data-rating-stale", String(state.stale));
    await expect(card.locator("time")).toContainText(state.time);
    if (state.suffix === "missing") await expect(card.locator("time")).not.toHaveAttribute("datetime");
    else await expect(card.locator("time")).toHaveAttribute("datetime", now);
    if (mobile) {
      await card.getByRole("link", { name: /상세 보기$/ }).click();
      const sheet = page.locator(".place-detail-sheet");
      await expect(sheet.locator(".public-rating-summary")).toHaveText(state.summary);
      await expect(sheet.locator("time")).toContainText(state.time);
      await expect(sheet.locator(".place-detail-sheet__hero")).toHaveAttribute("data-has-photo", "false");
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await sheet.screenshot({ path: `docs/evidence/2026-11-18-rating-${state.suffix}-sheet-320.png` });
      await page.getByRole("button", { name: "상세 정보 닫기" }).click();
    }

    await page.goto(`/?view=browse&qa=1&q=${id}&selected=${id}&bbox=126.8,35.1,127,35.2`);
    const quick = page.locator(".map-place-sheet");
    await expect(quick).toContainText(state.summary);
    await expect(quick.locator("time")).toContainText(state.time);
    await expect(quick.locator(".public-rating-meta")).toHaveAttribute("data-rating-stale", String(state.stale));
    if (state.stale) await expect(quick).not.toContainText("99%");

    await page.goto(`/places/${id}`);
    await expect(page.locator(".score .public-rating-summary")).toHaveText(state.summary);
    await expect(page.locator(".score time")).toContainText(state.time);
    await expect(page.locator(".detail-hero")).toHaveAttribute("data-has-photo", "false");
    await expect(page.locator(".detail-hero")).toContainText("아직 등록된 사진이 없어요.");
    if (state.stale) await expect(page.locator(".rating-breakdown")).not.toContainText("99%");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: `docs/evidence/2026-11-18-rating-${state.suffix}-${mobile ? "320" : "desktop"}.png`, fullPage: true });
  }
  expect(pageErrors).toEqual([]);
});
