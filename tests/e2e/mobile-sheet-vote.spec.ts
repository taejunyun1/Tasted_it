import { expect, test, type Locator, type Page } from "@playwright/test";
import { isControlledLocalBaseUrl } from "./local-test-target";
import { mobileSheetVoteFixture } from "./mobile-sheet-vote-fixture";

test.skip(!isControlledLocalBaseUrl(), "T02 uses only the isolated local Worker and D1");
const bbox = "126.918,35.1495,126.922,35.1505";
type Fixture = ReturnType<typeof mobileSheetVoteFixture>;

async function syntheticContext(page: Page, origin: string, fixture: Fixture) {
  await page.context().addCookies([{ name: "retaste_session", value: fixture.session, url: origin }]);
  await page.route("**/*", route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
  // Exercise the gallery's real D1 visibility rules and provide only the synthetic image bytes.
  await page.route(url => url.pathname === fixture.photoPath, route => route.fulfill({
    status: 200, contentType: "image/svg+xml",
    body: '<svg xmlns="http://www.w3.org/2000/svg" width="120" height="80"><rect width="120" height="80" fill="#dce9d7"/><circle cx="60" cy="40" r="23" fill="#689155"/></svg>',
  }));
}

async function expectPublicEvidence(container: Locator, fixture: Fixture) {
  await expect(container.getByText("GOLDEN PICK · 90일", { exact: true })).toBeVisible();
  await expect(container.getByRole("link", { name: "이 장소 정보 정정 요청", exact: true }))
    .toHaveAttribute("href", `/corrections/new?placeId=${fixture.id}`);
  const gallery = container.getByRole("region", { name: "리뷰어가 남긴 사진", exact: true });
  const photo = gallery.getByRole("img", { name: `${fixture.name} 리뷰 사진`, exact: true });
  await expect(photo).toHaveCount(1);
  await expect(photo).toHaveAttribute("src", fixture.photoPath);
  await photo.scrollIntoViewIfNeeded();
  await expect.poll(() => photo.evaluate((image: HTMLImageElement) => image.naturalWidth)).toBeGreaterThan(0);
  await expect(container.locator(`img[src="${fixture.pendingPhotoPath}"]`)).toHaveCount(0);
}

function detailSheet(page: Page) {
  return page.locator("dialog.place-detail-sheet:modal");
}

async function openListSheet(page: Page, fixture: Fixture, scope = ".discovery-grid") {
  const query = new URLSearchParams({ q: fixture.name, bbox, selected: fixture.id });
  await page.goto(`/places?${query}`);
  await page.locator(scope).getByRole("link", { name: `${fixture.name} 상세 보기`, exact: true }).click();
  const sheet = detailSheet(page);
  await expect(sheet.getByRole("heading", { name: fixture.name, exact: true })).toBeVisible();
  return sheet;
}

async function tabTo(page: Page, target: Locator) {
  await expect(target).toBeVisible();
  for (let stops = 0; stops < 25; stops++) {
    if (await target.evaluate(element => element === document.activeElement)) return;
    await page.keyboard.press("Tab");
  }
  await expect(target).toBeFocused();
}

async function expectExposedKeyboardTarget(target: Locator) {
  await expect(target).toBeFocused();
  await expect.poll(() => target.evaluate(element => {
    const rect = element.getBoundingClientRect();
    const x = rect.left + rect.width / 2;
    const y = rect.top + rect.height / 2;
    return element.contains(document.elementFromPoint(x, y));
  })).toBe(true);
}

test("T07 keyboard reads and saves from a failed category map at 320px", async ({ page, context, baseURL }, info) => {
  test.skip(info.project.name !== "mobile-chromium");
  const fixture = mobileSheetVoteFixture(baseURL!, "keyboard");
  const origin = new URL(baseURL!).origin;
  const browse = `/maps/ramen-detail?${new URLSearchParams({ view: "map", q: fixture.name, bbox, selected: fixture.id })}`;
  let guestId: string | undefined;

  async function openFromFailedMap() {
    await page.goto(browse, { waitUntil: "domcontentloaded" });
    await expect(page.locator(".map-canvas")).toHaveAttribute("data-map-unavailable", "true");
    const list = page.getByRole("navigation", { name: "보기 방식" }).getByRole("link", { name: "목록", exact: true });
    await tabTo(page, list);
    await page.keyboard.press("Enter");
    await expect(page.locator(".explore-split")).toHaveAttribute("data-view", "list");

    const opener = page.getByRole("region", { name: "장소 목록" }).getByRole("link", {
      name: `${fixture.name} 상세 보기`, exact: true,
    });
    await tabTo(page, opener);
    await expectExposedKeyboardTarget(opener);
    await page.keyboard.press("Enter");
    const sheet = detailSheet(page);
    await expect(sheet.getByRole("heading", { name: fixture.name, exact: true })).toBeVisible();
    await expect(sheet.getByRole("button", { name: "상세 정보 닫기", exact: true })).toBeFocused();

    return { sheet, opener };
  }

  async function closeToList(opener: Locator) {
    await page.keyboard.press("Escape");
    await expect(detailSheet(page)).toHaveCount(0);
    await expectExposedKeyboardTarget(opener);
    await expect(page).toHaveURL(url => url.pathname === "/maps/ramen-detail" && !url.searchParams.has("place")
      && url.searchParams.get("view") === "list" && url.searchParams.get("q") === fixture.name
      && url.searchParams.get("bbox") === bbox && url.searchParams.get("selected") === fixture.id);
  }

  try {
    fixture.create();
    await page.setViewportSize({ width: 320, height: 700 });
    await context.route(url => url.origin !== origin && url.protocol.startsWith("http"), route => route.abort());

    const guest = await openFromFailedMap();
    const saveTemporary = guest.sheet.getByRole("button", { name: "임시 저장", exact: true });
    await expect(saveTemporary).toBeEnabled();
    await tabTo(page, saveTemporary);
    await expectExposedKeyboardTarget(saveTemporary);
    await page.keyboard.press("Enter");
    await expect(guest.sheet.getByRole("button", { name: "임시 저장 해제", exact: true })).toHaveAttribute("aria-pressed", "true");
    guestId = (await context.cookies()).find(cookie => cookie.name === "retaste_guest")?.value;
    expect(guestId).toBeTruthy();
    expect(fixture.guestSaveCount(guestId!)).toBe(1);
    await page.screenshot({ path: info.outputPath("t07-320-guest-keyboard.png"), animations: "disabled" });
    await closeToList(guest.opener);
    await context.clearCookies({ name: "retaste_guest" });

    await context.addCookies([{ name: "retaste_session", value: fixture.session, url: origin }]);
    const member = await openFromFailedMap();
    const dislike = member.sheet.getByRole("button", { name: "비추천", exact: true });
    await tabTo(page, dislike);
    await expectExposedKeyboardTarget(dislike);
    await page.keyboard.press("Enter");

    const menu = member.sheet.getByRole("radio", { name: "메뉴", exact: true });
    const distance = member.sheet.getByRole("radio", { name: "거리", exact: true });
    await tabTo(page, menu);
    await page.keyboard.press("Space");
    await page.keyboard.press("ArrowRight");
    await expect(distance).toBeFocused();
    await expect(distance).toBeChecked();

    const submit = member.sheet.getByRole("button", { name: "비추천 반영", exact: true });
    await tabTo(page, submit);
    await expectExposedKeyboardTarget(submit);
    await page.keyboard.press("Enter");
    await expect(dislike).toHaveAttribute("aria-pressed", "true");

    const save = member.sheet.getByRole("button", { name: "맛집지도에 추가", exact: true });
    await expect(save).toBeEnabled();
    await tabTo(page, save);
    await expectExposedKeyboardTarget(save);
    await page.screenshot({ path: info.outputPath("t07-320-member-keyboard.png"), animations: "disabled" });
    await page.keyboard.press("Enter");
    await expect(member.sheet.getByRole("button", { name: "맛집지도에서 빼기", exact: true })).toHaveAttribute("aria-pressed", "true");
    expect(fixture.projection()).toEqual({ vote: -1, reason: "DISTANCE", saved: 1 });
    await closeToList(member.opener);
  } finally {
    try {
      guestId ??= (await context.cookies()).find(cookie => cookie.name === "retaste_guest")?.value;
      if (guestId) fixture.cleanupGuest(guestId);
    } finally {
      fixture.cleanup();
    }
  }
});

test("T02 mobile recommendation vote and save changes persist across detail and the member list", async ({ browser, page, baseURL }, info) => {
  test.skip(info.project.name !== "mobile-chromium");
  test.setTimeout(90_000);
  const fixture = mobileSheetVoteFixture(baseURL!, "recommendation");
  const peer = mobileSheetVoteFixture(baseURL!, "recommendation-peer");
  const origin = new URL(baseURL!).origin;
  const peerContext = await browser.newContext({ baseURL });
  try {
    fixture.create({ publicEvidence: true });
    await syntheticContext(page, origin, fixture);
    const sheet = await openListSheet(page, fixture, "section[data-kind=personal]");
    const originalDialog = (await sheet.elementHandle())!;
    const sheetUrl = new URL(page.url());
    const detailPath = sheetUrl.searchParams.get("place")!;
    const detail = new URL(detailPath, origin);
    expect(detail.pathname).toBe(`/places/${fixture.id}`);
    expect(detail.searchParams.get("sourceRail")).toBe("PERSONAL");
    const source = { sourceRail: "PERSONAL", discoveryMode: detail.searchParams.get("discoveryMode") };
    expect(source.discoveryMode).toMatch(/^(FAMILIAR|ADJACENT|EXPLORATION|ONBOARDING)$/);
    const detailEvent = detail.searchParams.get("recommendationRequestId");
    expect(detailEvent).toMatch(/^[0-9a-f-]{36}$/);

    await expectPublicEvidence(sheet, fixture);
    // Give a second member a choice on the same place before changing the first member's rows.
    peer.create();
    const peerPage = await peerContext.newPage();
    await syntheticContext(peerPage, origin, { ...fixture, session: peer.session });
    await peerPage.goto(detail.pathname);
    const peerVote = peerPage.getByRole("button", { name: "추천", exact: true });
    const peerSaved = peerPage.getByRole("button", { name: "저장됨", exact: true });
    await peerVote.click();
    await expect(peerVote).toHaveAttribute("aria-pressed", "true");
    await peerPage.getByRole("button", { name: "저장", exact: true }).click();
    await expect(peerSaved).toHaveAttribute("aria-pressed", "true");

    const postedPaths: string[] = [];
    page.on("request", request => {
      const url = new URL(request.url());
      if (request.method() === "POST" && url.origin === origin && url.pathname.startsWith("/places/")) {
        postedPaths.push(`${url.pathname.replace(/\.data$/, "")}${url.search}`);
      }
    });
    const saved = sheet.getByRole("button", { name: "맛집지도에서 빼기", exact: true });
    const thumbsUp = sheet.getByRole("button", { name: "추천", exact: true });
    const thumbsDown = sheet.getByRole("button", { name: "비추천", exact: true });
    const withdraw = sheet.getByRole("button", { name: "평가 취소", exact: true });
    const rating = sheet.locator(".place-detail-sheet__breakdown");

    await sheet.getByRole("button", { name: "맛집지도에 추가", exact: true }).click();
    await expect(saved).toHaveAttribute("aria-pressed", "true");
    await expect.poll(fixture.projection).toEqual({ vote: null, reason: null, saved: 1 });
    await thumbsUp.click();
    await expect(thumbsUp).toHaveAttribute("aria-pressed", "true");
    await expect(saved).toHaveAttribute("aria-pressed", "true");
    await expect(rating).toContainText(/일반 회원\s+2\/\d+/);
    await expect(page).toHaveURL(sheetUrl.href);
    expect(fixture.projection()).toEqual({ vote: 1, reason: null, saved: 1 });

    const repeatedVote = page.waitForResponse(response => {
      const url = new URL(response.url());
      return url.origin === origin && url.pathname.replace(/\.data$/, "") === detail.pathname
        && response.request().method() === "POST";
    });
    await thumbsUp.click();
    expect((await repeatedVote).ok()).toBe(true);
    await expect(thumbsUp).toBeEnabled();
    await expect(thumbsUp).toHaveAttribute("aria-pressed", "true");
    await expect(rating).toContainText(/일반 회원\s+2\/\d+/);
    expect(fixture.projection()).toEqual({ vote: 1, reason: null, saved: 1 });
    const initialVote = { event_type: "CREATE", value: 1 };
    expect(fixture.events()).toEqual([initialVote]);

    await thumbsDown.click();
    await sheet.getByRole("radio", { name: "메뉴", exact: true }).check();
    await sheet.getByRole("button", { name: "비추천 반영", exact: true }).click();
    await expect(thumbsDown).toHaveAttribute("aria-pressed", "true");
    await expect(saved).toHaveAttribute("aria-pressed", "true");
    await expect(page).toHaveURL(sheetUrl.href);
    expect(fixture.projection()).toEqual({ vote: -1, reason: "MENU", saved: 1 });
    await thumbsDown.scrollIntoViewIfNeeded();
    await page.screenshot({ path: info.outputPath("t02-mobile-recommendation-vote.png"), animations: "disabled" });

    await withdraw.click();
    await expect(withdraw).toHaveCount(0);
    await expect(thumbsUp).toHaveAttribute("aria-pressed", "false");
    await expect(thumbsDown).toHaveAttribute("aria-pressed", "false");
    await expect(saved).toHaveAttribute("aria-pressed", "true");
    await expect(page).toHaveURL(sheetUrl.href);
    expect(await originalDialog.evaluate(dialog => dialog.matches("dialog:modal"))).toBe(true);
    expect(fixture.projection()).toEqual({ vote: null, reason: null, saved: 1 });
    const voteHistory = [initialVote, { event_type: "CHANGE", value: -1 }, { event_type: "WITHDRAW", value: -1 }];
    expect(fixture.events()).toEqual(voteHistory);
    expect(postedPaths).toEqual(Array(5).fill(detailPath));
    // Recommendation interaction telemetry records both clicks. The D1 vote history records only the first choice.
    expect(fixture.recommendationEvents().map(row => [row.event_name, JSON.parse(row.metadata_json), row.id])).toEqual([
      ["RECOMMENDATION_DETAIL_OPENED", source, detailEvent],
      ["RECOMMENDATION_DISLIKED", { ...source, reason: "MENU" }, expect.any(String)],
      ["RECOMMENDATION_LIKED", source, expect.any(String)],
      ["RECOMMENDATION_LIKED", source, expect.any(String)],
      ["RECOMMENDATION_SAVED", source, expect.any(String)],
    ]);

    await page.reload();
    await expect(page).toHaveURL(sheetUrl.href);
    await expect(sheet.getByRole("heading", { name: fixture.name, exact: true })).toBeVisible();
    await expect(thumbsUp).toHaveAttribute("aria-pressed", "false");
    await expect(thumbsDown).toHaveAttribute("aria-pressed", "false");
    await expect(withdraw).toHaveCount(0);
    await expect(saved).toHaveAttribute("aria-pressed", "true");
    await sheet.getByRole("button", { name: "상세 정보 닫기", exact: true }).click();
    await expect(sheet).toHaveCount(0);
    await expect(page).toHaveURL(url => url.pathname === "/places" && !url.searchParams.has("place")
      && url.searchParams.get("q") === fixture.name && url.searchParams.get("bbox") === bbox && url.searchParams.get("selected") === fixture.id);
    await page.goto("/me");
    const savedPlaces = page.getByRole("region", { name: "저장한 장소", exact: true });
    const savedRow = savedPlaces.locator("article").filter({ has: page.locator(`a[href="${detail.pathname}"]`) });
    await expect(savedRow.getByRole("link", { name: fixture.name, exact: true })).toBeVisible();
    await savedRow.getByRole("button", { name: "저장 해제", exact: true }).click();
    await expect(savedPlaces.getByRole("status")).toHaveText("저장을 해제했습니다.");
    await expect(savedRow).toHaveCount(0);
    expect(fixture.projection()).toEqual({ vote: null, reason: null, saved: 0 });
    await savedPlaces.scrollIntoViewIfNeeded();
    await page.screenshot({ path: info.outputPath("t02-mobile-member-unsaved.png"), animations: "disabled" });

    await page.goto(sheetUrl.href);
    await expect(sheet.getByRole("heading", { name: fixture.name, exact: true })).toBeVisible();
    await expect(thumbsUp).toHaveAttribute("aria-pressed", "false");
    await expect(thumbsDown).toHaveAttribute("aria-pressed", "false");
    await expect(withdraw).toHaveCount(0);
    const unsaved = sheet.getByRole("button", { name: "맛집지도에 추가", exact: true });
    await expect(unsaved).toHaveAttribute("aria-pressed", "false");
    await expect(rating).toContainText(/일반 회원\s+1\/\d+/);
    await sheet.getByText("아직 평가하지 않았어요.", { exact: true }).scrollIntoViewIfNeeded();
    await page.screenshot({ path: info.outputPath("t02-mobile-detail-after-unsave.png"), animations: "disabled" });
    expect(fixture.events()).toEqual(voteHistory);
    expect(postedPaths).toEqual(Array(5).fill(detailPath));

    await peerPage.reload();
    await expect(peerVote).toHaveAttribute("aria-pressed", "true");
    await expect(peerSaved).toHaveAttribute("aria-pressed", "true");
  } finally {
    await peerContext.close();
    try { peer.cleanup(); } finally { fixture.cleanup(); }
  }
});

test("T02 mobile map sheet reconciles missing write responses with GET and no replay", async ({ page, baseURL }, info) => {
  test.skip(info.project.name !== "mobile-chromium");
  test.setTimeout(90_000);
  const fixture = mobileSheetVoteFixture(baseURL!, "map-recovery");
  const origin = new URL(baseURL!).origin;
  let reads = 0, posts = 0, commit = false;
  try {
    fixture.create();
    await syntheticContext(page, origin, fixture);
    await page.route(url => url.origin === origin && url.pathname === `/places/${fixture.id}.data`, async route => {
      if (route.request().method() === "GET") {
        reads++;
        return route.continue();
      }
      if (route.request().method() !== "POST") return route.continue();
      posts++;
      if (commit) expect((await route.fetch()).ok()).toBe(true);
      await route.abort("connectionfailed");
    });
    await page.goto(`/?${new URLSearchParams({ view: "browse", qa: "1", q: fixture.name, bbox })}`);
    await page.getByRole("button", { name: "목록", exact: true }).click();
    await page.getByRole("button", { name: `${fixture.name} 선택`, exact: true }).click();
    const quick = page.getByRole("dialog", { name: `${fixture.name} 빠른 정보`, exact: true });
    const opener = quick.getByRole("link", { name: "상세 보기", exact: true });
    await opener.click();

    const sheet = detailSheet(page);
    await expect(sheet.getByRole("heading", { name: fixture.name, exact: true })).toBeVisible();
    const originalDialog = (await sheet.elementHandle())!;
    const sheetUrl = new URL(page.url());
    const thumbsUp = sheet.getByRole("button", { name: "추천", exact: true });
    const alert = sheet.getByRole("alert");
    for (const delivered of [false, true]) {
      commit = delivered;
      const previousPosts = posts;
      await thumbsUp.click();
      await expect(alert).toContainText("처리 결과를 확인하지 못했어요.");
      await expect(thumbsUp).toBeDisabled();
      expect(posts).toBe(previousPosts + 1);
      expect(fixture.projection()).toEqual({ vote: delivered ? 1 : null, reason: null, saved: 0 });
      await expect(page).toHaveURL(sheetUrl.href);
      if (delivered) await page.screenshot({ path: info.outputPath("t02-mobile-vote-unknown.png"), animations: "disabled" });

      const previousReads = reads;
      await sheet.getByRole("button", { name: "현재 상태 다시 확인", exact: true }).click();
      await expect(alert).toHaveCount(0);
      await expect(thumbsUp).toBeEnabled();
      await expect(thumbsUp).toHaveAttribute("aria-pressed", String(delivered));
      expect(reads).toBeGreaterThan(previousReads);
      expect(posts).toBe(previousPosts + 1);
      await expect(page).toHaveURL(sheetUrl.href);
      expect(await originalDialog.evaluate(dialog => dialog.matches("dialog:modal"))).toBe(true);
    }
    expect(fixture.events()).toEqual([{ event_type: "CREATE", value: 1 }]);
    expect(fixture.recommendationEvents()).toEqual([]);
    await sheet.getByRole("button", { name: "상세 정보 닫기", exact: true }).click();
    await expect(opener).toBeFocused();
    await expect(page).toHaveURL(url => url.pathname === "/" && !url.searchParams.has("place") && url.searchParams.get("view") === "browse"
      && url.searchParams.get("selected") === fixture.id && url.searchParams.get("q") === fixture.name
      && url.searchParams.get("bbox") === bbox);
  } finally {
    fixture.cleanup();
  }
});

test("T02 desktop detail preserves shared public evidence at the canonical route", async ({ page, baseURL }, info) => {
  test.skip(info.project.name !== "chromium");
  const fixture = mobileSheetVoteFixture(baseURL!, "desktop");
  try {
    fixture.create({ publicEvidence: true });
    await syntheticContext(page, new URL(baseURL!).origin, fixture);
    await page.goto(`/places/${fixture.id}`);
    await expect(page.getByRole("heading", { name: fixture.name, exact: true })).toBeVisible();
    await expect(detailSheet(page)).toHaveCount(0);
    await expectPublicEvidence(page.getByRole("main"), fixture);
    await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
    await page.screenshot({ path: info.outputPath("t02-desktop-public-evidence.png"), fullPage: true, animations: "disabled" });
  } finally {
    fixture.cleanup();
  }
});

test("T02 mobile stale cancellation keeps the newer vote and refreshes the rating evidence", async ({ page, baseURL }, info) => {
  test.skip(info.project.name !== "mobile-chromium");
  test.setTimeout(90_000);
  const fixture = mobileSheetVoteFixture(baseURL!, "stale");
  const origin = new URL(baseURL!).origin;
  const path = `/places/${fixture.id}`;
  let reads = 0, posts = 0;
  try {
    fixture.create();
    await syntheticContext(page, origin, fixture);
    const post = (form: Record<string, string>) => page.request.post(path, { headers: { Origin: origin }, form });
    expect((await post({ intent: "save", saved: "true" })).ok()).toBe(true);
    expect((await post({ intent: "vote", value: "1" })).ok()).toBe(true);
    fixture.seedHiddenGem();
    await page.route(url => url.origin === origin && url.pathname === path + ".data", route => {
      if (route.request().method() === "GET") reads++;
      if (route.request().method() === "POST") posts++;
      return route.continue();
    });
    const sheet = await openListSheet(page, fixture);
    const sheetUrl = page.url();
    const originalDialog = (await sheet.elementHandle())!;
    const thumbsUp = sheet.getByRole("button", { name: "추천", exact: true });
    const thumbsDown = sheet.getByRole("button", { name: "비추천", exact: true });
    const withdraw = sheet.getByRole("button", { name: "평가 취소", exact: true });
    const saved = sheet.getByRole("button", { name: "맛집지도에서 빼기", exact: true });
    const hiddenGem = sheet.getByText("HIDDEN GEM · 노출 대비 높은 평가", { exact: true });
    await expect(thumbsUp).toHaveAttribute("aria-pressed", "true");
    await expect(hiddenGem).toBeVisible();
    await page.screenshot({ path: info.outputPath("t02-mobile-hidden-gem.png"), animations: "disabled" });

    // Another window with the same user's session changes the live projection.
    expect((await post({ intent: "vote", value: "-1", reason: "PRICE" })).ok()).toBe(true);
    await expect(thumbsUp).toHaveAttribute("aria-pressed", "true");
    const conflict = page.waitForResponse(response => new URL(response.url()).pathname === path + ".data" && response.request().method() === "POST");
    await withdraw.click();
    expect((await conflict).status()).toBe(409);
    await expect(sheet.getByRole("alert")).toHaveText("다른 요청에서 평가가 변경되었습니다. 현재 상태를 다시 확인해 주세요.");
    await expect(withdraw).toBeDisabled();
    await expect(saved).toHaveCount(0);
    expect(posts).toBe(1);
    expect(fixture.projection()).toEqual({ vote: -1, reason: "PRICE", saved: 1 });
    await page.screenshot({ path: info.outputPath("t02-mobile-vote-conflict.png"), animations: "disabled" });

    const previousReads = reads;
    await sheet.getByRole("button", { name: "현재 상태 다시 확인", exact: true }).click();
    await expect(thumbsDown).toHaveAttribute("aria-pressed", "true");
    await expect(saved).toHaveAttribute("aria-pressed", "true");
    await expect(sheet.getByRole("alert")).toHaveCount(0);
    await expect(hiddenGem).toHaveCount(0);
    expect(reads).toBeGreaterThan(previousReads);
    expect(posts).toBe(1);
    await expect(page).toHaveURL(sheetUrl);
    expect(await originalDialog.evaluate(dialog => dialog.matches("dialog:modal"))).toBe(true);
    expect(fixture.events()).toEqual([{ event_type: "CREATE", value: 1 }, { event_type: "CHANGE", value: -1 }]);
  } finally {
    fixture.cleanup();
  }
});

test("T02 action after session expiry returns through password login to the same recommendation sheet", async ({ page, baseURL }, info) => {
  test.skip(info.project.name !== "mobile-chromium");
  test.setTimeout(90_000);
  const fixture = mobileSheetVoteFixture(baseURL!, "expired");
  const origin = new URL(baseURL!).origin;
  try {
    fixture.create();
    const login = await fixture.loginCredentials();
    await syntheticContext(page, origin, fixture);
    await page.route(url => url.origin === origin && /^\/login(?:\.data)?$/.test(url.pathname), route => {
      const request = route.request();
      return request.method() === "POST"
        ? route.continue({ headers: { ...request.headers(), "cf-connecting-ip": login.clientIp } })
        : route.continue();
    });
    const sheet = await openListSheet(page, fixture, "section[data-kind=personal]");
    const thumbsUp = sheet.getByRole("button", { name: "추천", exact: true });
    await expect(thumbsUp).toBeEnabled();
    const before = new URL(page.url());
    const returnTo = before.pathname + before.search;
    expect(before.searchParams.get("place")).toContain("recommendationRequestId=");
    let posts = 0;
    page.on("request", request => {
      if (request.method() === "POST" && new URL(request.url()).pathname === `/places/${fixture.id}.data`) posts++;
    });
    fixture.expireSession();
    await thumbsUp.click();
    await expect(page.getByRole("heading", { name: "다시 취향을 이어가세요.", exact: true })).toBeVisible();
    await expect(page).toHaveURL(url => url.pathname === "/login" && url.searchParams.get("returnTo") === returnTo);
    await expect(page.locator('input[name="returnTo"]')).toHaveValue(returnTo);
    expect(posts).toBe(1);
    expect(fixture.events()).toEqual([]);

    await page.getByLabel("이메일", { exact: true }).fill(login.email);
    await page.getByLabel("비밀번호", { exact: true }).fill(login.password);
    await page.getByRole("button", { name: "로그인", exact: true }).click();
    await expect(page).toHaveURL(before.href);
    await expect(thumbsUp).toBeEnabled();
    await expect(thumbsUp).toHaveAttribute("aria-pressed", "false");
    expect(posts).toBe(1);
    expect(fixture.events()).toEqual([]);
    await page.screenshot({ path: info.outputPath("t02-mobile-vote-after-login.png"), animations: "disabled" });
  } finally {
    fixture.cleanup();
  }
});
