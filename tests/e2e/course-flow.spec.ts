import { execFileSync } from "node:child_process";
import { existsSync, realpathSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test } from "@playwright/test";
import { isControlledLocalBaseUrl } from "./local-test-target";

test.skip(!isControlledLocalBaseUrl(), "Course flow fixtures are local only");

let prefix = "";
const defaultStatePath = ".wrangler/e2e-state";
const statePath = process.env.CST_COURSE_FLOW_DB_PATH ?? defaultStatePath;
const now = "2026-11-18T00:00:00.000Z";

function hasDedicatedD1State() {
  if (!process.env.BASE_URL || !isControlledLocalBaseUrl() || !process.env.CST_COURSE_FLOW_DB_PATH || !existsSync(statePath)) return false;
  const shared = existsSync(defaultStatePath) ? realpathSync(defaultStatePath) : resolve(defaultStatePath);
  return realpathSync(statePath) !== shared;
}

function sql(command: string) {
  const output = execFileSync(process.execPath, ["node_modules/wrangler/bin/wrangler.js", "d1", "execute", "DB", "--local", "--config", "wrangler.e2e.jsonc", "--persist-to", statePath, "--command", command, "--json"], { encoding: "utf8" });
  return JSON.parse(output)[0].results as Array<Record<string, unknown>>;
}

function courseUrl(ev = "none") {
  return `/courses?${new URLSearchParams({ apply: "1", time: "lunch", mealCategory: "grill", second: "cafe", radiusKm: "3", parkingMode: "shared", ev, weather: "rain", child: "1", lat: "35", lng: "127" })}`;
}

function parking() {
  sql(`INSERT INTO parking_data_snapshots(id,source,status,row_count,source_reference_date_max,activated_at,created_at,updated_at)
    VALUES('${prefix}-parking','PARKING','ACTIVE',2,'2026-11-17','${now}','${now}','${now}');
    INSERT INTO parking_facilities(id,snapshot_id,source_management_no,name,ownership_type,facility_type,region_code,latitude,longitude,capacity,
      weekday_open,weekday_close,saturday_open,saturday_close,holiday_open,holiday_close,fee_status,base_minutes,base_fee,additional_minutes,additional_fee,daily_max_fee,
      public_access_status,reliability_grade,reference_date,raw_payload,created_at,updated_at)
    VALUES('${prefix}-near','${prefix}-parking','${prefix}-near','합성 가까운 주차장','PRIVATE','OFF_STREET','JEONNAM',35.0004,127,20,
      '00:00','23:59','00:00','23:59','00:00','23:59','PAID',30,1000,10,500,3000,'PUBLIC','A','2026-11-17','{}','${now}','${now}'),
      ('${prefix}-far','${prefix}-parking','${prefix}-far','합성 먼 공영 주차장','PUBLIC','OFF_STREET','JEONNAM',35.009,127,300,
      '00:00','23:59','00:00','23:59','00:00','23:59','FREE',NULL,NULL,NULL,NULL,NULL,'PUBLIC','A','2026-11-17','{}','${now}','${now}');`);
}

test.beforeAll(({}, info) => {
  prefix = `u08-flow-${info.project.name}`;
  expect(sql("SELECT slug FROM categories WHERE slug IN ('grill','cafe') ORDER BY slug")).toEqual([{ slug: "cafe" }, { slug: "grill" }]);
  sql(`INSERT INTO places(id,slug,name,status,address,neighborhood,latitude,longitude,search_text,created_at,updated_at)
    VALUES('${prefix}-meal','${prefix}-meal','합성 코스 식당','PUBLISHED','합성 식당 주소','합성',35,127,'합성 코스 식당','${now}','${now}'),
      ('${prefix}-cafe','${prefix}-cafe','합성 코스 카페','PUBLISHED','합성 카페 주소','합성',35.0008,127,'합성 코스 카페','${now}','${now}');
    INSERT INTO place_categories(place_id,category_id,is_primary)
    SELECT '${prefix}-meal',id,1 FROM categories WHERE slug='grill';
    INSERT INTO place_categories(place_id,category_id,is_primary)
    SELECT '${prefix}-cafe',id,1 FROM categories WHERE slug='cafe';
    INSERT INTO place_operating_hours(id,place_id,weekday,opens_at,closes_at,is_closed,last_verified_at,created_at,updated_at)
    VALUES ${[0, 1, 2, 3, 4, 5, 6].flatMap(day => ["meal", "cafe"].map(stop => `('${prefix}-${stop}-hours-${day}','${prefix}-${stop}',${day},'00:00','00:00',0,'${now}','${now}','${now}')`)).join(",")};`);
});

test.beforeEach(async ({ page, baseURL }) => {
  sql(`DELETE FROM parking_data_snapshots WHERE id LIKE '${prefix}-%';`);
  await page.route(url => url.origin !== new URL(baseURL!).origin, route => route.abort());
});

test.afterAll(() => {
  if (prefix) sql(`DELETE FROM parking_data_snapshots WHERE id LIKE '${prefix}-%'; DELETE FROM places WHERE id LIKE '${prefix}-%';`);
});

test("database-backed courses survive unavailable parking", async ({ page }, info) => {
  await page.goto(courseUrl());
  await expect(page.getByRole("link", { name: "합성 코스 식당", exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "합성 코스 카페", exact: true })).toBeVisible();
  await expect(page.getByText("주차 정보 준비 중", { exact: true })).toBeVisible();
  await expect(page.getByText("조건에 맞는 주차장 없음", { exact: true })).toHaveCount(0);
  await page.screenshot({ path: info.outputPath("course-parking-unavailable.png"), fullPage: true });
});

test("course cards identify TEMP venues and qualify their hours", async ({ page }, info) => {
  const sourceUrl = "https://tour.gwangju.go.kr/example";
  const payload = JSON.stringify({
    sourceId: "temp100-001",
    name: "합성 코스 카페",
    address: "합성 카페 주소",
    region: "광주",
    cuisine: "카페",
    summary: "코스 상태 표시를 확인하기 위한 합성 장소입니다.",
    sourceUrl,
    sourceTitle: "합성 출처",
    checkedAt: now,
    evaluation: { kind: "OFFICIAL_CURATION", provider: "합성", sourceUrl },
    photo: null,
  });
  const batchId = `${prefix}-temp`;
  try {
    sql(`INSERT INTO temp_catalog_batches(id,source_hash,manifest_hash,status,created_at,updated_at)
      VALUES('${batchId}','${batchId}','${batchId}','PUBLISHED','${now}','${now}');
      INSERT INTO temp_catalog_entries(id,batch_id,source_id,place_id,payload_json,created_at,updated_at)
      VALUES('${batchId}-entry','${batchId}','temp100-001','${prefix}-cafe','${payload.replaceAll("'", "''")}','${now}','${now}');`);
    await page.goto(courseUrl());
    const meal = page.locator(".course-stop").filter({ has: page.getByRole("link", { name: "합성 코스 식당", exact: true }) });
    const cafe = page.locator(".course-stop").filter({ has: page.getByRole("link", { name: "합성 코스 카페", exact: true }) });
    await expect(meal.getByText("공개 장소", { exact: true })).toBeVisible();
    await expect(cafe.getByText("TEMP · 영업 미확인", { exact: true })).toBeVisible();
    const contextEnabled = process.env.COURSE_CONTEXT_V2_ENABLED === "true";
    const hoursLabel = contextEnabled ? "기록상 영업시간에 해당" : "영업시간 확인 필요";
    await expect(meal).toContainText(hoursLabel);
    await expect(cafe).toContainText(hoursLabel);
    await expect(page.getByText("기록상 두 곳 모두 영업시간", { exact: true })).toHaveCount(contextEnabled ? 1 : 0);
    await page.screenshot({ path: info.outputPath("course-recorded-hours-and-temp.png"), fullPage: true });
  } finally {
    sql(`DELETE FROM temp_catalog_batches WHERE id='${batchId}';`);
  }
});

test("database-backed parking renders the near facility, distance and fee", async ({ page }, info) => {
  parking();
  await page.goto(courseUrl());
  const shared = page.locator(".course-parking-options > article").filter({ has: page.getByRole("heading", { name: "합성 가까운 주차장", exact: true }) }).first();
  await expect(shared).toBeVisible();
  await expect(shared).toContainText("120m");
  await expect(shared).toContainText("약 3,000원");
  await expect(shared).toContainText("정보 없음");
  await expect(page.getByText("합성 먼 공영 주차장", { exact: true })).toHaveCount(0);
  await expect(page.getByText("주차장 데이터 기준일 2026-11-17", { exact: true })).toBeVisible();
  await page.screenshot({ path: info.outputPath("course-parking-ready.png"), fullPage: true });
});

test("required EV excludes retired charging evidence and recovers with active evidence", async ({ page }, info) => {
  parking();
  sql(`INSERT INTO parking_data_snapshots(id,source,status,row_count,activated_at,created_at,updated_at)
    VALUES('${prefix}-ev','EV','RETIRED',1,'${now}','${now}','${now}');
    INSERT INTO ev_charging_stations(id,snapshot_id,source_station_id,name,latitude,longitude,is_deleted,reference_date,raw_payload,created_at,updated_at)
    VALUES('${prefix}-charger','${prefix}-ev','${prefix}-charger','합성 충전기',35.0004,127,0,'2026-11-17','{}','${now}','${now}');
    INSERT INTO parking_ev_links(parking_facility_id,ev_station_id,relationship,match_method,confidence,created_at)
    VALUES('${prefix}-near','${prefix}-charger','ONSITE_CONFIRMED','SYNTHETIC',1,'${now}');`);
  await page.goto(courseUrl("required"));
  await expect(page.getByText("조건에 맞는 주차장 없음", { exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "합성 코스 식당", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "합성 가까운 주차장", exact: true })).toHaveCount(0);
  await page.screenshot({ path: info.outputPath("course-required-ev-unavailable.png"), fullPage: true });
  sql(`UPDATE parking_data_snapshots SET status='ACTIVE' WHERE id='${prefix}-ev';`);
  await page.reload();
  await expect(page.getByRole("heading", { name: "합성 가까운 주차장", exact: true }).first()).toBeVisible();
  await expect(page.getByText("설치 확인", { exact: true })).toBeVisible();
  expect(new URL(page.url()).searchParams.get("ev")).toBe("required");
});

test.describe("parking-only D1 read failure", () => {
  test.skip(!hasDedicatedD1State(), "Requires a loopback Worker with explicit disposable CST_COURSE_FLOW_DB_PATH");

  test("keeps the food course and recovers parking through a GET with the same conditions", async ({ page }, info) => {
    parking();
    const expected = new URL(courseUrl(), "https://fixture.invalid");
    expected.searchParams.sort();
    const parkingName = page.getByRole("heading", { name: "합성 가까운 주차장", exact: true }).first();
    await page.goto(courseUrl());
    await expect(parkingName).toBeVisible();

    let renamed = false;
    try {
      sql("ALTER TABLE parking_ev_links RENAME TO parking_ev_links_u08_test_failure;");
      renamed = true;
      await page.goto(`${courseUrl()}&mealCategory=grill&utm_source=fixture`);
      const course = page.locator(".course-result-card").filter({ has: page.getByRole("link", { name: "합성 코스 식당", exact: true }) }).first();
      await expect(course.getByRole("link", { name: "합성 코스 식당", exact: true })).toBeVisible();
      await expect(course.getByRole("link", { name: "합성 코스 카페", exact: true })).toBeVisible();
      await expect(course.getByText("주차·충전 정보를 불러오지 못했어요", { exact: true })).toBeVisible();
      await expect(course.getByText("조건에 맞는 주차장 없음", { exact: true })).toHaveCount(0);
      await expect(parkingName).toHaveCount(0);
      const retry = course.getByRole("link", { name: "같은 조건으로 다시 조회", exact: true });
      await expect(retry).toBeVisible();
      await expect(retry).toHaveCSS("text-decoration-line", "underline");
      const target = new URL((await retry.getAttribute("href"))!, page.url());
      expect(target.origin).toBe(new URL(page.url()).origin);
      target.searchParams.sort();
      expect(target.pathname + target.search).toBe(expected.pathname + expected.search);
      await page.screenshot({ path: info.outputPath("course-parking-read-failed.png"), fullPage: true });
    } finally {
      if (renamed) sql("ALTER TABLE parking_ev_links_u08_test_failure RENAME TO parking_ev_links;");
    }

    const retry = page.getByRole("link", { name: "같은 조건으로 다시 조회", exact: true }).first();
    const request = page.waitForRequest(candidate => candidate.isNavigationRequest() && new URL(candidate.url()).pathname === "/courses");
    await retry.click();
    const retryRequest = await request;
    expect(retryRequest.method()).toBe("GET");
    const retried = new URL(retryRequest.url());
    retried.searchParams.sort();
    expect(retried.pathname + retried.search).toBe(expected.pathname + expected.search);
    await expect(parkingName).toBeVisible();
    await expect(page.getByText("주차·충전 정보를 불러오지 못했어요", { exact: true })).toHaveCount(0);
    await page.screenshot({ path: info.outputPath("course-parking-read-recovered.png"), fullPage: true });
  });
});

test("server read failure preserves every course condition and offers an explicit retry", async ({ page }, info) => {
  parking();
  await page.goto(courseUrl());
  await page.locator(".course-filter-trigger").click();
  let fail = true;
  await page.route(url => url.pathname === "/courses.data", async route => {
    if (fail) return route.fulfill({ status: 503, contentType: "text/plain", body: "synthetic course read unavailable" });
    return route.continue();
  });
  await page.getByRole("button", { name: "이 조건으로 코스 만들기", exact: true }).click();
  await page.waitForLoadState("networkidle");
  await page.screenshot({ path: info.outputPath("course-read-error.png"), fullPage: true });
  await expect(page.getByRole("heading", { name: "코스를 불러오지 못했어요", exact: true })).toBeVisible();
  await expect(page.getByRole("alert")).toContainText("선택 조건");
  await expect(page.locator('input[name="mealCategory"]')).toHaveValue("grill");
  fail = false;
  await page.getByRole("button", { name: "다시 검색", exact: true }).click();
  await expect(page.getByRole("link", { name: "합성 코스 식당", exact: true })).toBeVisible();
  const params = new URL(page.url()).searchParams;
  for (const [key, value] of new URL(courseUrl(), "https://fixture.invalid").searchParams) expect(params.get(key)).toBe(value);
});

test("a failed first visit retries the setup screen without applying default conditions", async ({ page }, info) => {
  await page.goto("/login");
  let fail = true;
  await page.route(url => url.pathname === "/courses.data", async route => {
    if (fail) return route.fulfill({ status: 503, contentType: "text/plain", body: "synthetic initial course read unavailable" });
    return route.continue();
  });
  if (!(await page.locator(".site-head__primary").isVisible())) await page.locator(".site-menu > summary").click();
  await page.getByRole("link", { name: "코스 추천", exact: true }).click();
  await expect(page.getByRole("heading", { name: "코스를 불러오지 못했어요", exact: true })).toBeVisible();
  await expect(page.locator('input[name="apply"]')).toHaveCount(0);
  await expect(page.locator('input[name="time"]')).toHaveCount(0);
  fail = false;
  await page.getByRole("button", { name: "다시 검색", exact: true }).click();
  await expect(page.getByRole("heading", { name: "먼저 오늘의 조건을 골라주세요.", exact: true })).toBeAttached();
  await expect(page.locator(".course-result-card")).toHaveCount(0);
  expect(new URL(page.url()).search).toBe("");
  await page.screenshot({ path: info.outputPath("course-initial-retry.png"), fullPage: true });
});
