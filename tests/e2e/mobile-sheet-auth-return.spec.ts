import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { isControlledLocalBaseUrl } from "./local-test-target";

const placeName = "Re:Taste 샘플 라멘 동명";
const placeId = "sample-place-1";
const placeSlug = "sample-dongmyeong-ramen";
const placePath = "/places/" + placeSlug;
const mapFilters = new URLSearchParams({ q: "라멘", bbox: "126.80,35.10,127.00,35.25" });
const sources = [
  { kind: "list", browse: "/places?" + mapFilters, provider: "google", message: "Google 로그인에 실패했습니다." },
  { kind: "home", browse: "/?view=browse&qa=1&" + mapFilters, provider: "naver", message: "네이버 로그인에 실패했습니다." },
  { kind: "category", browse: "/maps/ramen-detail?view=list&" + mapFilters, provider: null, message: null },
] as const;

test.skip(!isControlledLocalBaseUrl(), "Uses a local D1 and the synthetic mail fixture");

function localD1<T>(sql: string): T[] {
  const output = execFileSync(process.execPath, ["node_modules/wrangler/bin/wrangler.js", "d1", "execute", "DB",
    "--local", "--config", "wrangler.e2e.jsonc", "--persist-to", ".wrangler/e2e-state", "--json", "--command", sql],
  { encoding: "utf8" });
  return (JSON.parse(output) as Array<{ results: T[] }>).flatMap(query => query.results);
}

function quote(value: string) { return "'" + value.replaceAll("'", "''") + "'"; }

function assertContinuation(url: string, expected: URL) {
  const target = new URL(url, expected.origin);
  expect(target.pathname).toBe(expected.pathname);
  expect([...target.searchParams]).toEqual([...expected.searchParams]);
  expect(target.hash).toBe(expected.hash);
}

async function chooseGuestTaste(page: Page, context: BrowserContext) {
  await page.goto("/onboarding/taste?returnTo=%2Fplaces");
  await page.getByRole("button", { name: "계속", exact: true }).click();
  await page.getByRole("button", { name: "국밥러", exact: true }).click();
  await page.getByRole("button", { name: "계속", exact: true }).click();
  await expect(page.getByRole("heading", { name: "좋아하는 맛과 식당 분위기는요?" })).toBeVisible();
  return (await context.cookies()).find(cookie => cookie.name === "retaste_guest")?.value;
}

async function openPlace(page: Page, source: typeof sources[number]) {
  await page.goto(source.browse);
  if (source.kind === "home") {
    await page.getByRole("button", { name: "목록", exact: true }).click();
    await page.getByRole("button", { name: placeName + " 선택", exact: true }).click();
    await page.getByRole("dialog", { name: placeName + " 빠른 정보" }).getByRole("link", { name: "상세 보기", exact: true }).click();
  } else {
    const cards = source.kind === "list" ? page.locator(".discovery-grid") : page.getByRole("region", { name: "장소 목록", exact: true });
    await cards.getByRole("link", { name: placeName + " 상세 보기", exact: true }).click();
  }
}

async function signupAndVerify(page: Page, context: BrowserContext, email: string, password: string, expected: URL) {
  await page.getByRole("main").getByRole("link", { name: "회원가입", exact: true }).click();
  assertContinuation(new URL(page.url()).searchParams.get("returnTo")!, expected);
  await page.getByLabel("이름", { exact: true }).fill("상세 복귀 합성 회원");
  await page.getByLabel("이메일", { exact: true }).fill(email);
  await page.getByLabel("비밀번호 · 10자 이상", { exact: true }).fill(password);
  await page.getByRole("checkbox", { name: /만 14세 이상/ }).check();
  await page.getByRole("button", { name: "인증 메일 받고 가입하기", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: "인증 안내가 등록된 이메일로 전송됩니다." })).toBeVisible();

  const delivery = await context.request.get("/__e2e/email?email=" + encodeURIComponent(email));
  expect(delivery.status()).toBe(200);
  const { html } = await delivery.json() as { html: string };
  const verification = new URL(html.match(/href="([^"]+)"/)![1]!);
  expect(verification.origin).toBe(expected.origin);
  assertContinuation(verification.searchParams.get("returnTo")!, expected);
  await page.goto(verification.href);
  await expect(page.getByRole("heading", { name: "이메일 인증 완료", exact: true })).toBeVisible();
  await page.getByRole("link", { name: "로그인으로", exact: true }).click();
  assertContinuation(await page.locator('input[name="returnTo"]').inputValue(), expected);
}

for (const source of sources) {
  test("mobile " + source.kind + " detail resumes after email login and transfers both guest choices once", async ({ page, context, baseURL }, info) => {
    test.skip(info.project.name !== "mobile-chromium", "Tests the mobile detail sheet");
    const origin = new URL(baseURL!).origin;
    const email = "sheet-auth-" + crypto.randomUUID() + "@example.test";
    const password = "synthetic-" + crypto.randomUUID();
    const ipSuffix = crypto.randomUUID().slice(0, 8);
    const clientIp = `2001:db8:${ipSuffix.slice(0, 4)}:${ipSuffix.slice(4)}::1`;
    await page.route((url) => ["http:", "https:"].includes(url.protocol), (route) => {
      const request = route.request();
      if (new URL(request.url()).origin !== origin) return route.abort();
      if (request.method() === "POST") return route.continue({ headers: { ...request.headers(), "cf-connecting-ip": clientIp } });
      return route.continue();
    });
    let guestId: string | undefined;
    let recommendationId: string | undefined;
    try {
      guestId = await chooseGuestTaste(page, context);
      expect(guestId).toBeTruthy();
      await openPlace(page, source);
      const sheet = page.getByRole("dialog", { name: placeName + " 상세 정보", exact: true });
      await expect(sheet).toBeVisible();

      if (source.kind === "list") {
        recommendationId = crypto.randomUUID();
        const opening = new URL(page.url());
        opening.searchParams.set("place", placePath + "?sourceRail=TRUSTED&discoveryMode=QUALITY&recommendationRequestId=" + recommendationId);
        await page.goto(opening.href);
        await expect(sheet).toBeVisible();
      }
      const expected = new URL(page.url());
      expect(expected.pathname).toBe(new URL(source.browse, baseURL).pathname);
      expect(expected.searchParams.get("q")).toBe("라멘");
      expect(expected.searchParams.get("bbox")).toBe(mapFilters.get("bbox"));
      expect(expected.searchParams.get("selected")).toBe(placeId);
      if (source.kind === "home") expect(expected.searchParams.get("place")).toBe(placeSlug);
      else expect(expected.searchParams.get("place")).toContain(placePath);

      await sheet.getByRole("button", { name: "임시 저장", exact: true }).click();
      await expect(sheet.getByRole("button", { name: "임시 저장 해제", exact: true })).toBeEnabled();
      await sheet.getByRole("link", { name: "로그인하고 맛집지도에 추가", exact: true }).click();
      await expect(page.getByRole("heading", { name: "다시 취향을 이어가세요.", exact: true })).toBeVisible();
      assertContinuation(await page.locator('input[name="returnTo"]').inputValue(), expected);
      if (source.provider) {
        await page.locator('a[href^="/auth/' + source.provider + '?"]').click();
        await expect(page.getByRole("alert").filter({ hasText: source.message })).toBeVisible();
        assertContinuation(await page.locator('input[name="returnTo"]').inputValue(), expected);
      }
      await signupAndVerify(page, context, email, password, expected);
      await page.getByLabel("이메일", { exact: true }).fill(email);
      await page.getByLabel("비밀번호", { exact: true }).fill(password);
      await page.getByRole("button", { name: "로그인", exact: true }).click();
      await expect(sheet.getByRole("button", { name: "맛집지도에서 빼기", exact: true })).toBeEnabled();
      assertContinuation(page.url(), expected);
      expect((await context.cookies()).some(cookie => cookie.name === "retaste_guest")).toBe(false);
      await page.screenshot({ path: info.outputPath(source.kind + "-detail-after-login.png"), animations: "disabled" });
      await page.reload();
      await expect(sheet.getByRole("button", { name: "맛집지도에서 빼기", exact: true })).toBeEnabled();

      const payload = localD1(`SELECT
        (SELECT COUNT(*) FROM saved_places WHERE place_id=${quote(placeId)} AND user_id=u.id) AS saves,
        (SELECT COUNT(*) FROM user_taste_badges WHERE user_id=u.id AND badge_id='food-gukbap' AND source='USER') AS badges,
        (SELECT COUNT(*) FROM product_events WHERE guest_session_id=${quote(guestId!)} AND user_id=u.id AND event_name='GUEST_CONVERTED') AS converted,
        (SELECT COUNT(*) FROM guest_saved_places WHERE session_id=${quote(guestId!)}) AS remaining_saves,
        (SELECT COUNT(*) FROM guest_taste_badges WHERE session_id=${quote(guestId!)}) AS remaining_badges
        FROM users u WHERE u.email=${quote(email)}`);
      expect(payload).toEqual([{ saves: 1, badges: 1, converted: 1, remaining_saves: 0, remaining_badges: 0 }]);
    } finally {
      const guest = quote(guestId ?? ""), proof = quote(recommendationId ?? ""), address = quote(email);
      const buckets = [`mail-rate-limit:email:SIGNUP:${email}`, `auth-rate-limit:email:LOGIN:${email}`,
        `mail-rate-limit:ip:SIGNUP:${clientIp}`, `auth-rate-limit:ip:LOGIN:${clientIp}`]
        .map((key) => quote(createHash("sha256").update(key).digest("hex")));
      localD1(`DELETE FROM product_events WHERE guest_session_id=${guest} OR id=${proof} OR user_id IN (SELECT id FROM users WHERE email=${address});
        DELETE FROM users WHERE email=${address};
        DELETE FROM guest_taste_sessions WHERE id=${guest};
        DELETE FROM rate_limit_windows WHERE bucket_hash IN (${buckets.join(",")});`);
    }
  });
}
