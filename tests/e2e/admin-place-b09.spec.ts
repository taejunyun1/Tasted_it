import { execFileSync } from "node:child_process";
import { expect, test, type Locator } from "@playwright/test";

test.use({ javaScriptEnabled: false });
test.skip(Boolean(process.env.BASE_URL), "Only isolated local synthetic places are allowed.");

function sql(command: string) {
  return execFileSync("pnpm", ["exec", "wrangler", "d1", "execute", "DB", "--local", "--config", "wrangler.e2e.jsonc", "--persist-to", ".wrangler/e2e-state", "--command", command], { stdio: "pipe" });
}

async function clickVisibleButton(button: Locator) {
  let previousBox: string | null = null;
  let stableSamples = 0;
  await expect.poll(async () => {
    const box = await button.boundingBox();
    const currentBox = box ? JSON.stringify([box.x, box.y, box.width, box.height]) : null;
    stableSamples = currentBox && currentBox === previousBox ? stableSamples + 1 : currentBox ? 1 : 0;
    previousBox = currentBox;
    return stableSamples >= 2;
  }, { intervals: [100], timeout: 3_000 }).toBe(true);
  await button.scrollIntoViewIfNeeded();
  await expect(button).toBeInViewport();
  await button.click();
}

function ids(project: string) {
  const suffix = project === "chromium" ? "desktop" : "mobile";
  return { target: `qa-b09-${suffix}-target`, source: `qa-b09-${suffix}-source`, suffix };
}

test.beforeEach(({}, info) => {
  const { target, source } = ids(info.project.name);
  const statements = ["DELETE FROM admin_session_assurances WHERE session_id='qa-admin-session';"];
  for (const [id, address] of [[target, "광주광역시 동구 합성로 10"], [source, "광주광역시 동구 합성로 12"]]) {
    statements.push(`INSERT OR IGNORE INTO places(id,slug,name,status,address,neighborhood,latitude,longitude,search_text,created_at,updated_at) VALUES('${id}','${id}','B09 합성 식당','PUBLISHED','${address}','합성동',35.15,126.92,'B09 합성 식당','2026-11-14T00:00:00.000Z','2026-11-14T00:00:00.000Z'); UPDATE places SET status='PUBLISHED' WHERE id='${id}'; INSERT OR IGNORE INTO place_categories(place_id,category_id,is_primary) VALUES('${id}','cat-ramen',1); INSERT OR IGNORE INTO place_review_work_items(id,place_id,source_kind,stage,status,selected_category_id,stage_version,created_at,updated_at) VALUES('${id}-work','${id}','PLACE_SUGGESTION','FINAL_APPROVAL','ACTIVE','cat-ramen',0,'2026-11-14T00:00:00.000Z','2026-11-14T00:00:00.000Z');`);
  }
  sql(statements.join("\n"));
});

test("final approval allows exactly one native selection without JavaScript", async ({ context, page, baseURL }, info) => {
  expect(new URL(baseURL!).hostname).toBe("127.0.0.1");
  const { target, source } = ids(info.project.name);
  await context.addCookies([{ name: "retaste_session", value: "qa-admin-session", url: baseURL! }]);

  await page.goto("/admin/place-operations?step=5&q=B09");
  const radios = page.getByRole("radio");
  const first = page.getByRole("radio", { name: new RegExp(`${target}-work 선택$`) });
  const second = page.getByRole("radio", { name: new RegExp(`${source}-work 선택$`) });
  await first.check();
  await second.check();
  await expect(first).not.toBeChecked();
  await expect(second).toBeChecked();
  await expect(radios.first()).toHaveAttribute("name", "workItem");
  await expect(page.getByText("공개는 한 번에 1곳", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: /현재 페이지 .*곳 선택/ })).toHaveCount(0);
});

test("merge preview identifies both places and requires recent authentication", async ({ context, page, baseURL }, info) => {
  expect(new URL(baseURL!).hostname).toBe("127.0.0.1");
  const { target, source } = ids(info.project.name);
  await context.addCookies([{ name: "retaste_session", value: "qa-admin-session", url: baseURL! }]);
  await page.goto("/admin/place-operations?tab=duplicates");
  await page.getByRole("combobox", { name: "남길 장소", exact: true }).selectOption(target);
  await page.getByRole("combobox", { name: "흡수할 장소", exact: true }).selectOption(source);
  await expect(page.locator('select[name="targetPlaceId"] option:checked')).toContainText("합성로 10");
  await expect(page.locator('select[name="sourcePlaceId"] option:checked')).toContainText("합성로 12");
  await page.getByRole("textbox", { name: "병합 근거", exact: true }).fill("로컬 합성 데이터의 병합 대상 식별과 인증 차단 검증");
  await clickVisibleButton(page.getByRole("button", { name: "병합 미리보기", exact: true }));
  const preview = page.getByRole("region", { name: "장소 변경 미리보기", exact: true });
  await expect(preview.getByText(`남길 장소 · B09 합성 식당`, { exact: true })).toBeVisible();
  await expect(preview.getByText("광주광역시 동구 합성로 10", { exact: true })).toBeVisible();
  await expect(preview.getByText("광주광역시 동구 합성로 12", { exact: true })).toBeVisible();
  await expect(preview.getByText(target, { exact: true })).toBeVisible();
  await expect(preview.getByText(source, { exact: true })).toBeVisible();
  await expect(preview.getByText("아직 변경되지 않았습니다.", { exact: false })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath("place-merge-preview.png"), fullPage: true });
  await clickVisibleButton(preview.getByRole("button", { name: "장소 변경 확정", exact: true }));
  await expect(page).toHaveURL(/\/admin\/reauth\?returnTo=/);
  expect(decodeURIComponent(page.url())).toContain("/admin/place-operations?operation=");
});

test("recall confirmation shows a reloadable receipt without another confirm action", async ({ context, page, baseURL }, info) => {
  expect(new URL(baseURL!).hostname).toBe("127.0.0.1");
  const { target } = ids(info.project.name);
  await context.addCookies([{ name: "retaste_session", value: "qa-admin-session", url: baseURL! }]);
  // Positive confirmation uses only this isolated synthetic admin session.
  const now = new Date().toISOString();
  const expiry = new Date(Date.now() + 10 * 60_000).toISOString();
  sql(`INSERT INTO admin_session_assurances(session_id,actor_user_id,method,verified_at,expires_at) VALUES('qa-admin-session','qa-admin','PASSWORD','${now}','${expiry}') ON CONFLICT(session_id) DO UPDATE SET verified_at=excluded.verified_at,expires_at=excluded.expires_at; UPDATE place_review_work_items SET status='COMPLETED',completed_at='${now}' WHERE id='${target}-work'`);
  await page.goto(`/admin/place-operations?place=${target}`);
  await page.getByRole("textbox", { name: "공개 회수 사유", exact: true }).fill("로컬 합성 장소의 공개 회수 영수증 검증");
  await clickVisibleButton(page.getByRole("button", { name: "공개 회수 미리보기", exact: true }));
  await expect(page.getByRole("region", { name: "장소 변경 미리보기", exact: true })).toBeVisible();
  await clickVisibleButton(page.getByRole("button", { name: "장소 변경 확정", exact: true }));
  const receiptUrl = page.url();
  const receipt = page.getByRole("region", { name: "장소 변경 확정 영수증", exact: true });
  await expect(receipt.getByText("요청 1건 · 적용 1건 · 건너뜀 0건.", { exact: false })).toBeVisible();
  await expect(receipt.getByRole("button", { name: "장소 변경 확정", exact: true })).toHaveCount(0);
  await expect(receipt.getByRole("button", { name: "회수 복원 미리보기", exact: true })).toBeVisible();
  await page.goto(receiptUrl);
  await expect(receipt).toBeVisible();
  await expect(receipt.getByText(target, { exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath("place-recall-receipt.png"), fullPage: true });
});
