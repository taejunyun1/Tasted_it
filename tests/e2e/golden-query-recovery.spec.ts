import { execFileSync } from "node:child_process";
import { expect, test } from "@playwright/test";
import { isControlledLocalBaseUrl } from "./local-test-target";

// Opt-in fault injection for a disposable local D1 copy. Never run against a
// developer's shared state or a remote DB. The table name is restored in finally.
test.skip(!isControlledLocalBaseUrl() || process.env.CST_GOLDEN_FAULT_INJECTION !== "1", "Requires an isolated local D1 copy");

function sql(command: string) {
  return JSON.parse(execFileSync(process.execPath, [
    "node_modules/wrangler/bin/wrangler.js", "d1", "execute", "DB", "--local",
    "--config", "wrangler.e2e.jsonc", "--persist-to", ".wrangler/e2e-state", "--json", "--command", command,
  ], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }));
}

test("Golden query failure is retryable and preserves the last successful recommendation", async ({ page, request, baseURL }, info) => {
  test.setTimeout(60_000);
  const mobile = info.project.name === "mobile-chromium";
  const panel = page.locator(mobile ? ".home-curation-sheet" : ".home-curation-panel");
  const path = "/?qa=1&mode=golden";
  const fixture = `qa-golden-recovery-${info.project.name}`, now = new Date().toISOString();
  const before = sql("SELECT COUNT(*) AS n FROM golden_pick_events")[0].results[0].n;
  let unavailable = false;
  const fail = () => { sql("ALTER TABLE golden_pick_events RENAME TO qa_unavailable_golden_pick_events"); unavailable = true; };
  const restore = () => { if (unavailable) { sql("ALTER TABLE qa_unavailable_golden_pick_events RENAME TO golden_pick_events"); unavailable = false; } };
  await page.route(url => url.origin !== new URL(baseURL!).origin, route => route.abort());
  try {
    sql(`INSERT INTO places(id,slug,name,status,address,neighborhood,latitude,longitude,search_text,created_at,updated_at) VALUES('${fixture}','${fixture}','합성 Golden 복구 장소','PUBLISHED','광주광역시 합성 주소','합성동',35.145,126.875,'${fixture}','${now}','${now}');
      INSERT INTO place_categories(place_id,category_id,is_primary) VALUES('${fixture}','cat-ramen',1);`);
    const votes: string[] = [];
    for (let index = 0; index < 20; index++) {
      const user = `${fixture}-${index}`;
      votes.push(`INSERT INTO users(id,email,display_name,role,created_at,updated_at) VALUES('${user}','${user}@example.test','합성 회원','USER','${now}','${now}');
        INSERT INTO vote_events(id,place_id,user_id,value,event_type,source,created_at) VALUES('${user}','${fixture}','${user}',1,'CREATE','GENERAL','${now}');
        INSERT INTO current_votes(place_id,user_id,event_id,value,updated_at) VALUES('${fixture}','${user}','${user}',1,'${now}');`);
    }
    sql(votes.join("\n"));
    sql(`INSERT INTO rating_snapshots(id,place_id,config_id,input_hash,moderation_epoch,vote_revision,overall_score,user_score,reviewer_score,overall_sample_count,user_sample_count,reviewer_sample_count,reviewer_raw_weight,reviewer_combined_weight,reviewer_weight_share,reasons_json,is_stale,computed_at,created_at,updated_at)
      SELECT '${fixture}','${fixture}','rating-config-v2','${fixture}',(SELECT epoch FROM reviewer_publication_state WHERE id='global'),vote_revision,90,90,NULL,20,20,0,0,0,0,'{}',0,'${now}','${now}','${now}' FROM places WHERE id='${fixture}';`);
    const healthy = await request.get("/resources/home-recommendations?mode=golden&requestToken=healthy-fixture");
    expect(healthy.status()).toBe(200);
    expect((await healthy.json()).recommendations.places.map((item: { id: string }) => item.id)).toContain(fixture);
    fail();
    await page.goto(path);
    await expect(panel.locator(".home-curation-error")).toContainText("Golden Pick 정보를 불러오지 못했어요");
    await expect(panel.getByRole("button", { name: "다시 시도", exact: true })).toBeEnabled();
    await expect(panel).not.toContainText("추천할 장소를 찾지 못했어요");
    await expect(panel).not.toContainText("과거 선정 이력과 평가 기록");
    const failed = await request.get("/resources/home-recommendations?mode=golden&requestToken=golden-fault");
    expect(failed.status()).toBe(503);
    expect(await failed.json()).toMatchObject({ ok: false, requestToken: "golden-fault" });
    await page.screenshot({ path: info.outputPath("golden-unavailable.png") });

    restore();
    await panel.getByRole("button", { name: "다시 시도", exact: true }).click();
    await expect(panel.locator(".home-curation-card").first()).toBeVisible();
    await expect(panel.locator(".home-curation-error")).toHaveCount(0);
    const ids = await panel.locator(".home-curation-card").evaluateAll(nodes => nodes.map(node => node.getAttribute("data-place-id")));
    const history = await page.evaluate(() => sessionStorage.getItem("retaste:home-curation-v2"));

    fail();
    await panel.getByRole("button", { name: "Golden Pick", exact: true }).click();
    await expect(panel.locator(".home-curation-error")).toContainText("Golden Pick 정보를 불러오지 못했어요");
    expect(await panel.locator(".home-curation-card").evaluateAll(nodes => nodes.map(node => node.getAttribute("data-place-id")))).toEqual(ids);
    expect(await page.evaluate(() => sessionStorage.getItem("retaste:home-curation-v2"))).toBe(history);
    await page.screenshot({ path: info.outputPath("golden-previous-results.png") });
    restore();
    await panel.getByRole("button", { name: "다시 시도", exact: true }).click();
    await expect(panel.locator(".home-curation-error")).toHaveCount(0);
    expect(sql("SELECT COUNT(*) AS n FROM golden_pick_events")[0].results[0].n).toBe(before);
  } finally {
    restore();
    sql(`DELETE FROM current_votes WHERE place_id='${fixture}'; DELETE FROM vote_events WHERE place_id='${fixture}'; DELETE FROM places WHERE id='${fixture}'; DELETE FROM users WHERE id LIKE '${fixture}-%';`);
  }
});
