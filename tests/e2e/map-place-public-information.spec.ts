import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { expect, test } from "@playwright/test";
import { isControlledLocalBaseUrl } from "./local-test-target";

test.skip(!isControlledLocalBaseUrl(), "Map information fixtures use the local E2E database.");

const places = [
  { key: "regular", name: "합성 공개 라멘", address: "광주광역시 동구 합성로 1", longitude: 126.90, badge: "공개 장소" },
  { key: "temp", name: "합성 TEMP 라멘", address: "광주광역시 동구 합성로 2", longitude: 126.92, badge: "TEMP · 영업 미확인" },
] as const;
const tempBbox = "126.8,35.1,126.91,35.2";
const state = process.env.CST_PUBLIC_INFO_DB_PATH ?? ".wrangler/e2e-state";
const quote = (value: string) => `'${value.replaceAll("'", "''")}'`;
let prefix = "";

function localSql(sql: string) {
  execFileSync("pnpm", ["exec", "wrangler", "d1", "execute", "DB", "--local", "--config", "wrangler.e2e.jsonc",
    "--persist-to", state, "--command", sql], { stdio: "pipe" });
}

function cleanup() {
  localSql(`DELETE FROM temp_catalog_entries WHERE id=${quote(`${prefix}-entry`)};
    DELETE FROM temp_catalog_batches WHERE id=${quote(`${prefix}-batch`)};
    DELETE FROM places WHERE id IN (${places.map(({ key }) => quote(`${prefix}-${key}`)).join(",")});`);
}

test.beforeAll(({}, info) => {
  prefix = `qa-map-public-info-${info.project.name}`;
  cleanup();
  const now = "2026-11-18T00:00:00.000Z";
  const valueRows = places.map(({ key, name, address, longitude }) => {
    const id = quote(`${prefix}-${key}`);
    return `(${id},${id},${quote(name)},'PUBLISHED',${quote(address)},'동구',35.15,${longitude},${quote(prefix)},${quote(now)},${quote(now)})`;
  });
  const categoryRows = places.map(({ key }) => `(${quote(`${prefix}-${key}`)},'cat-ramen',1)`);
  const tempPlace = places[1];
  const sourceUrl = "https://tour.gwangju.go.kr/example";
  const tempPayload = JSON.stringify({
    sourceId: "temp100-001", name: tempPlace.name, address: tempPlace.address, region: "광주", cuisine: "일식",
    summary: "지도 공개 안내 검증용 합성 장소입니다.", sourceUrl, sourceTitle: "합성 출처", checkedAt: now,
    evaluation: { kind: "OFFICIAL_CURATION", provider: "합성", sourceUrl }, photo: null,
  });
  const sourceHash = createHash("sha256").update(`${prefix}-source`).digest("hex");
  const manifestHash = createHash("sha256").update(tempPayload).digest("hex");
  localSql(`INSERT INTO places(id,slug,name,status,address,neighborhood,latitude,longitude,search_text,created_at,updated_at) VALUES ${valueRows.join(",")};
    INSERT INTO place_categories(place_id,category_id,is_primary) VALUES ${categoryRows.join(",")};
    INSERT INTO temp_catalog_batches(id,source_hash,manifest_hash,status,created_at,updated_at)
      VALUES (${quote(`${prefix}-batch`)},${quote(sourceHash)},${quote(manifestHash)},'PUBLISHED',${quote(now)},${quote(now)});
    INSERT INTO temp_catalog_entries(id,batch_id,source_id,place_id,payload_json,created_at,updated_at)
      VALUES (${quote(`${prefix}-entry`)},${quote(`${prefix}-batch`)},'temp100-001',${quote(`${prefix}-temp`)},${quote(tempPayload)},${quote(now)},${quote(now)});`);
});

test.afterAll(() => { if (prefix) cleanup(); });

test("the map labels regular and TEMP listings consistently in the list and quick information", async ({ page, baseURL, isMobile }, info) => {
  const origin = new URL(baseURL ?? "http://127.0.0.1:5173").origin;
  await page.route(url => url.origin !== origin, route => route.abort());
  const explorer = page.getByRole("complementary", { name: "장소 탐색" });

  for (const fixture of places) {
    if (fixture.key === "temp") {
      await page.goto(`/places?${new URLSearchParams({ temp: "1", q: prefix, bbox: tempBbox })}`);
      const listing = page.locator("section.discovery-all");
      await expect(listing.locator("#place-search-status")).toContainText("전체 1곳");
      await expect(listing.getByRole("link", { name: `${fixture.name} 상세 보기`, exact: true })).toBeVisible();
      await page.getByRole("link", { name: "지도에서 보기", exact: true }).click();
      await expect(page).toHaveURL(url => url.pathname === "/" && url.searchParams.get("temp") === "1");
    } else {
      await page.goto(`/?${new URLSearchParams({ qa: "1", view: "browse", q: prefix })}`);
    }

    if (isMobile) await explorer.getByRole("button", { name: "목록", exact: true }).click();
    const result = explorer.getByRole("button", { name: `${fixture.name} 선택`, exact: true });
    await expect(result.getByText(fixture.badge, { exact: true })).toBeVisible();
    await expect(result).toHaveAccessibleDescription(fixture.badge);
    await expect(result.getByText("검수 완료", { exact: true })).toHaveCount(0);
    if (fixture.key === "temp") {
      await expect(explorer.getByRole("button", { name: `${places[0].name} 선택`, exact: true })).toHaveCount(0);
    }
    await result.click();

    const dialog = page.getByRole("dialog", { name: `${fixture.name} 빠른 정보` });
    await expect(dialog.getByText(fixture.badge, { exact: true })).toBeVisible();
    await expect(dialog.getByText("검수 완료", { exact: true })).toHaveCount(0);
    await expect(dialog.locator("address")).toHaveText(fixture.address);
    if (fixture.key === "temp") {
      const notice = page.locator(".map-canvas .map-error");
      const overview = page.getByRole("img", { name: /위치 미니맵$/ });
      await expect(notice).toBeVisible();
      await expect(overview).toBeVisible();
      const [messageBox, overviewBox] = await Promise.all([notice.boundingBox(), overview.boundingBox()]);
      expect(overviewBox!.y).toBeGreaterThanOrEqual(messageBox!.y + messageBox!.height);
    }
    await page.screenshot({ path: info.outputPath(`map-public-information-${fixture.key}.png`), animations: "disabled" });
    await dialog.getByRole("button", { name: "빠른 정보 닫기" }).click();
    await expect(dialog).toHaveCount(0);
  }
});
