import { execFileSync } from "node:child_process";
import { expect, test } from "@playwright/test";

const state = process.env.CST_PUBLIC_INFO_DB_PATH ?? ".wrangler/e2e-state";
function sql(command: string) {
  execFileSync("pnpm", ["exec", "wrangler", "d1", "execute", "DB", "--local", "--config", "wrangler.e2e.jsonc", "--persist-to", state, "--command", command], { stdio: "pipe" });
}
let prefix: string;

test.beforeAll(({}, info) => {
  const url = new URL(String(info.project.use.baseURL));
  if (!["127.0.0.1", "localhost"].includes(url.hostname)) throw new Error("LOCAL_SYNTHETIC_ONLY");
  prefix = `qa-public-info-${info.project.name}`;
  const now = "2026-11-17T18:30:00.000Z";
  sql(`INSERT INTO places(id,slug,name,status,address,neighborhood,latitude,longitude,search_text,last_verified_at,created_at,updated_at) VALUES
    ('${prefix}-recorded','${prefix}-recorded','QA 확인 정보','PUBLISHED','광주광역시 동구 합성로 1','동구',35.15,126.92,'${prefix}','${now}','${now}','${now}'),
    ('${prefix}-unknown','${prefix}-unknown','QA 미확인 정보','PUBLISHED','광주광역시 동구 합성로 2','동구',35.15,126.92,'${prefix}',NULL,'${now}','${now}');
    INSERT INTO place_categories(place_id,category_id,is_primary) SELECT p.id,c.id,1 FROM places p CROSS JOIN categories c WHERE p.id LIKE '${prefix}%' AND c.slug='cafe' AND c.is_active=1;
    INSERT INTO place_operating_hours(id,place_id,weekday,opens_at,closes_at,is_closed,last_verified_at,created_at,updated_at) VALUES
    ('${prefix}-hours','${prefix}-recorded',1,'18:00','02:00',0,'${now}','${now}','${now}'),
    ('${prefix}-closed','${prefix}-recorded',2,NULL,NULL,1,'${now}','${now}','${now}');`);
});

test.afterAll(() => {
  if (!prefix) return;
  sql(`DELETE FROM place_operating_hours WHERE place_id LIKE '${prefix}%'; DELETE FROM place_categories WHERE place_id LIKE '${prefix}%'; DELETE FROM places WHERE id LIKE '${prefix}%';`);
});

for (const kind of ["recorded", "unknown"] as const) {
  test(`place detail presents ${kind} information consistently`, async ({ page, isMobile }, info) => {
    await page.goto(`/places?q=${prefix}`);
    await page.locator("section.discovery-all").getByRole("link", { name: `${kind === "recorded" ? "QA 확인 정보" : "QA 미확인 정보"} 상세 보기`, exact: true }).click();
    const surface = isMobile ? page.getByRole("dialog") : page.locator("main.detail");
    await expect(surface.getByText("장소 정보 확인일", { exact: true })).toBeVisible();
    if (kind === "recorded") {
      await expect(surface.locator(".place-information time").first()).toHaveText("2026-11-18");
      await expect(surface.getByText("월요일 18:00–다음 날 02:00", { exact: true })).toBeVisible();
      await expect(surface.getByText("화요일 휴무", { exact: true })).toBeVisible();
    } else {
      await expect(surface.getByText("확인 기록 없음", { exact: true })).toBeVisible();
      await expect(surface.getByText("정보 미제공", { exact: true })).toBeVisible();
      await expect(surface.locator(".place-information")).toContainText("정보 미확인");
      await expect(surface.getByText("검수 완료", { exact: true })).toHaveCount(0);
    }
    await expect(surface.locator(".place-information-note")).toContainText("현재 영업 여부는 방문 전에 매장에 확인");
    await expect(surface.locator(".place-information")).not.toContainText("영업중");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await surface.getByText("장소 정보 확인일", { exact: true }).scrollIntoViewIfNeeded();
    await page.screenshot({ path: info.outputPath(`public-information-${kind}-date.png`), animations: "disabled" });
    await surface.getByText("영업시간", { exact: true }).scrollIntoViewIfNeeded();
    await expect(surface.getByText("영업시간", { exact: true })).toBeInViewport();
    await page.screenshot({ path: info.outputPath(`public-information-${kind}.png`), animations: "disabled" });
  });
}

test("a late previous detail response cannot replace the selected place", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/places?q=${prefix}`);
  const cards = page.locator("section.discovery-all");
  let release!: () => void, captured!: () => void, finished!: () => void;
  const hold = new Promise<void>(resolve => { release = resolve; });
  const received = new Promise<void>(resolve => { captured = resolve; });
  const completed = new Promise<void>(resolve => { finished = resolve; });
  await page.route(url => url.pathname === `/places/${prefix}-recorded.data`
    && url.searchParams.getAll("_routes").some(value => value.split(",").includes("routes/place-detail")), async route => {
    const response = await route.fetch();
    expect(response.status()).toBe(200);
    captured();
    await hold;
    try { await route.fulfill({ response }); } finally { finished(); }
  });
  try {
    await cards.getByRole("link", { name: "QA 확인 정보 상세 보기", exact: true }).click();
    await received;
    await expect(page.getByRole("dialog").getByText("장소 정보를 불러오는 중…")).toBeVisible();
    await page.getByRole("button", { name: "상세 정보 닫기" }).click();
    await cards.getByRole("link", { name: "QA 미확인 정보 상세 보기", exact: true }).click();
    await expect(page.getByRole("dialog").getByRole("heading", { name: "QA 미확인 정보", exact: true })).toBeVisible();
    release();
    await completed;
    await expect(page.getByRole("dialog").getByRole("heading", { name: "QA 미확인 정보", exact: true })).toBeVisible();
    await expect(page.getByRole("dialog").getByRole("heading", { name: "QA 확인 정보", exact: true })).toHaveCount(0);
  } finally { release(); }
});
