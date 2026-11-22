import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { isControlledLocalBaseUrl } from "./local-test-target";

function localD1(sql: string) {
  const output = execFileSync(process.execPath, ["node_modules/wrangler/bin/wrangler.js", "d1", "execute", "DB",
    "--local", "--config", "wrangler.e2e.jsonc", "--persist-to", ".wrangler/e2e-state", "--command", sql, "--json"], {
    cwd: process.cwd(),
    encoding: "utf8",
  });
  return JSON.parse(output) as Array<{ results: Array<Record<string, unknown>> }>;
}

function createEventTestMember(prefix: string) {
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const userId = `${prefix}-${suffix}`;
  const sessionId = `${userId}-session`;
  localD1(`INSERT INTO users (id,email,display_name,role,email_verified_at,created_at,updated_at) VALUES ('${userId}','${userId}@retaste.local','이벤트 테스트','USER','2026-08-10T00:00:00Z','2026-08-10T00:00:00Z','2026-08-10T00:00:00Z'); INSERT INTO sessions (id,user_id,expires_at,created_at) VALUES ('${sessionId}','${userId}','2027-08-10T00:00:00Z','2026-08-10T00:00:00Z');`);
  return { userId, sessionId };
}

function deleteEventTestMember(userId: string) {
  localD1(`DELETE FROM product_events WHERE user_id='${userId}'; DELETE FROM users WHERE id='${userId}';`);
}

function createCompletedGuest() {
  const guestId = `e2e-guest-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  localD1(`INSERT INTO guest_taste_sessions (id,location_mode,completed_steps_json,completed_at,expires_at,created_at,updated_at) VALUES ('${guestId}','DEFAULT','["LOCATION","FOOD","STYLE","PREVIEW"]','2026-08-10T00:00:00Z','2027-08-10T00:00:00Z','2026-08-10T00:00:00Z','2026-08-10T00:00:00Z');`);
  return guestId;
}

function deleteCompletedGuest(guestId: string) {
  localD1(`DELETE FROM product_events WHERE guest_session_id='${guestId}'; DELETE FROM guest_taste_sessions WHERE id='${guestId}';`);
}

async function openPlaceList(page: Page) {
  await page.goto("/places?bbox=126.80,35.10,127.00,35.25");
  if (new URL(page.url()).pathname === "/onboarding/taste") {
    await page.getByRole("button", { name: "나중에 할게요" }).click();
    await expect(page).toHaveURL(/\/places\?bbox=/);
  }
}

test("place list starts with the taste mixer and three distinct recommendation rails", async ({ page }) => {
  const hydrationErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error" && message.text().includes("hydrated")) hydrationErrors.push(message.text());
  });
  await openPlaceList(page);

  await expect(page.getByRole("heading", { name: "오늘 뭐 먹지?" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "취향과 새로운 발견" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Re:Taste 추천" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Golden Pick 취향 릴레이" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "전체 장소" })).toBeVisible();

  const headings = await page.locator("main h2").allTextContents();
  expect(headings).toEqual([
    "오늘 뭐 먹지?",
    "취향과 새로운 맛 사이",
    "취향과 새로운 발견",
    "Re:Taste 추천",
    "Golden Pick 취향 릴레이",
    "전체 장소",
  ]);

  const searchTop = await page.getByPlaceholder("장소 이름이나 주소 검색").boundingBox();
  const fullListTop = await page.getByRole("heading", { name: "전체 장소" }).boundingBox();
  expect(searchTop?.y).toBeGreaterThan(fullListTop?.y ?? 0);
  expect(hydrationErrors).toEqual([]);
});

test("taste badges rerank in place and stop at two selections", async ({ page }) => {
  await openPlaceList(page);

  await page.getByRole("button", { name: "냉면" }).click();
  await expect(page.getByRole("heading", { name: "오늘은 시원하게" })).toBeVisible();
  await expect(page).toHaveURL(/\/places\?bbox=/);

  await page.getByRole("button", { name: "노포" }).click();
  await expect(page.getByRole("heading", { name: "오래된 여름의 맛" })).toBeVisible();
  await expect(page.getByRole("button", { name: "냉면" })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("button", { name: "노포" })).toHaveAttribute("aria-pressed", "true");

  await page.getByRole("button", { name: "새로운 맛", exact: true }).click();
  await expect(page.getByText("최대 2개까지 선택할 수 있어요")).toBeVisible();
  await expect(page.getByRole("button", { name: "새로운 맛", exact: true })).toHaveAttribute("aria-pressed", "false");
});

test("a card without enough votes shows the public sample status", async ({ page }) => {
  await openPlaceList(page);
  const card = page.locator(".discovery-grid").getByRole("link", { name: "Re:Taste 샘플 라멘 동명 상세 보기", exact: true });
  await expect(card.getByText("표본 수집 중", { exact: true })).toBeVisible();
  await expect(card.getByText(/추천 \d+%/)).toHaveCount(0);
});

test("mobile recommendation card preserves provenance through sheet detail and save events", async ({ context, page, baseURL }, testInfo) => {
  test.skip(testInfo.project.name !== "mobile-chromium");
  test.skip(!isControlledLocalBaseUrl(), "Persisted event assertions require the isolated local D1 test database.");
  const member = createEventTestMember("e2e-recommendation");
  try {
    await context.addCookies([{ name: "retaste_session", value: member.sessionId, url: baseURL! }]);
    await page.goto("/places?bbox=126.80,35.10,127.00,35.25");

    const rail = page.locator("section[data-kind=personal]");
    await rail.getByRole("link", { name: /상세 보기$/ }).first().click();
    const sheet = page.getByRole("dialog", { name: /상세 정보$/ });
    await expect(sheet).toBeVisible();

    const detailPath = new URL(page.url()).searchParams.get("place");
    expect(detailPath).toMatch(/^\/places\/[^?]+\?sourceRail=PERSONAL&discoveryMode=(?:FAMILIAR|ADJACENT|EXPLORATION|ONBOARDING)&recommendationRequestId=[0-9a-f-]{36}$/i);
    const provenance = new URL(detailPath!, baseURL).searchParams;
    const metadataJson = JSON.stringify({ sourceRail: provenance.get("sourceRail"), discoveryMode: provenance.get("discoveryMode") });
    await expect(sheet.locator("form")).toHaveAttribute("action", detailPath!);
    const postPromise = page.waitForRequest((request) => request.method() === "POST" && new URL(request.url()).pathname.startsWith("/places/"));
    await sheet.getByRole("button", { name: "맛집지도에 추가" }).click();
    const postUrl = new URL((await postPromise).url());
    expect(`${postUrl.pathname.replace(/\.data$/, "")}${postUrl.search}`).toBe(detailPath);

    await expect.poll(() => localD1(`SELECT event_name, metadata_json, id FROM product_events WHERE user_id='${member.userId}' ORDER BY occurred_at, event_name;`)[0]?.results)
      .toEqual([
        { event_name: "RECOMMENDATION_DETAIL_OPENED", metadata_json: metadataJson, id: provenance.get("recommendationRequestId") },
        { event_name: "RECOMMENDATION_SAVED", metadata_json: metadataJson, id: expect.any(String) },
      ]);
  } finally {
    deleteEventTestMember(member.userId);
  }
});

test("mobile direct list and map details stay queryless and emit no recommendation events", async ({ context, page, baseURL }, testInfo) => {
  test.skip(testInfo.project.name !== "mobile-chromium");
  test.skip(!isControlledLocalBaseUrl(), "Persisted event assertions require the isolated local D1 test database.");
  const member = createEventTestMember("e2e-direct");
  try {
    await context.addCookies([{ name: "retaste_session", value: member.sessionId, url: baseURL! }]);

    await page.goto("/places?bbox=126.80,35.10,127.00,35.25");
    await page.locator("section.discovery-all").getByRole("link", { name: /상세 보기$/ }).first().click();
    let sheet = page.getByRole("dialog", { name: /상세 정보$/ });
    await expect(sheet).toBeVisible();
    expect(new URL(page.url()).searchParams.get("place")).toMatch(/^\/places\/[^?]+$/);
    const directPost = page.waitForResponse((response) => response.request().method() === "POST" && new URL(response.url()).pathname.startsWith("/places/"));
    await sheet.getByRole("button", { name: "맛집지도에 추가" }).click();
    expect((await directPost).ok()).toBe(true);

    await page.goto("/places/sample-dongmyeong-ramen");
    await expect(page).toHaveURL(/\/places\/sample-dongmyeong-ramen$/);

    await page.goto(`/?view=browse&qa=${Date.now()}`);
    const map = page.getByLabel("장소 지도");
    await map.getByRole("button", { name: /음식점 \d+곳, 확대해서 보기$/ }).first().click();
    await map.getByRole("button", { name: /음식점 \d+곳, 확대해서 보기$/ }).first().click();
    await page.getByRole("button", { name: /지도 핀$/ }).first().click();
    await page.getByRole("link", { name: "상세 보기" }).click();
    sheet = page.getByRole("dialog", { name: /상세 정보$/ });
    await expect(sheet).toBeVisible();
    expect(new URL(page.url()).searchParams.get("place")).toMatch(/^[a-z0-9-]+$/);

    expect(localD1(`SELECT event_name FROM product_events WHERE user_id='${member.userId}' AND event_name LIKE 'RECOMMENDATION_%';`)[0]?.results).toEqual([]);
  } finally {
    deleteEventTestMember(member.userId);
  }
});

test("mobile guest login keeps the exact list and nested recommendation return path", async ({ context, page, baseURL }, testInfo) => {
  test.skip(testInfo.project.name !== "mobile-chromium");
  test.skip(!isControlledLocalBaseUrl(), "The isolated completed-guest fixture requires the local D1 test database.");
  const guestId = createCompletedGuest();
  try {
    await context.addCookies([{ name: "retaste_guest", value: guestId, url: baseURL! }]);
    await page.goto("/places?bbox=126.80,35.10,127.00,35.25");
    await page.locator("section[data-kind=personal]").getByRole("link", { name: /상세 보기$/ }).first().click();
    await expect(page.getByRole("dialog", { name: /상세 정보$/ })).toBeVisible();

    const browsing = new URL(page.url());
    const detailPath = browsing.searchParams.get("place");
    expect(detailPath).toMatch(/recommendationRequestId=/);
    await expect(page.getByRole("link", { name: "로그인하고 맛집지도에 추가" }))
      .toHaveAttribute("href", `/login?returnTo=${encodeURIComponent(`${browsing.pathname}${browsing.search}`)}`);
  } finally {
    deleteCompletedGuest(guestId);
  }
});
