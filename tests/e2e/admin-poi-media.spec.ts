import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { expect, test } from "@playwright/test";

const local = (args: string[]) => execFileSync("pnpm", [
  "exec", "wrangler", ...args, "--local", "--config", "wrangler.e2e.jsonc", "--persist-to", ".wrangler/e2e-state",
], { encoding: "utf8" });

test("administrator publishes and withdraws the POI photo, with public fallback when the image request fails", async ({ page, browser }, info) => {
  test.skip(Boolean(process.env.BASE_URL), "Requires isolated local D1 and R2 fixtures");
  const mobile = info.project.name === "mobile-chromium";
  if (mobile) await page.setViewportSize({ width: 320, height: 844 });
  const suffix = mobile ? "02" : "01";
  const photo = `a83f0000-0000-4000-8000-0000000000${suffix}`;
  const now = new Date().toISOString();
  const location = `/admin/poi-media?photo=${photo}`;
  const preview = `/admin/poi-media/${photo}/preview`;
  const site = "http://127.0.0.1:5173";
  const rightsEvidence = "synthetic-rights-reference-".repeat(7);
  await page.setContent('<main style="position:absolute;inset:0 auto auto 0;display:grid;place-items:center;width:320px;height:125px;background:#e8eada;color:#16291a;font:600 20px sans-serif">합성 장소 사진 · 테스트</main>');
  const jpeg = await page.screenshot({ type: "jpeg", scale: "css", clip: { x: 0, y: 0, width: 320, height: 125 } });
  const sha256 = createHash("sha256").update(jpeg).digest("hex");
  const filename = info.outputPath("fixture.jpg");
  mkdirSync(dirname(filename), { recursive: true });
  writeFileSync(filename, jpeg);
  local(["r2", "object", "put", `retaste-review-photos-e2e/poi-media/${photo}-${sha256}.jpg`, "--file", filename, "--content-type", "image/jpeg"]);
  local(["d1", "execute", "DB", "--command", `
    DELETE FROM admin_session_assurances WHERE session_id='qa-admin-session';
    INSERT INTO place_poi_media(id,place_id,state,source_url,attribution,rights_basis,rights_evidence,sha256,byte_size,content_type,reviewed_at)
    VALUES('${photo}','sample-place-1','STAGED','https://example.test/poi-photo','합성 사진 제공','OWN_WORK','${rightsEvidence}','${sha256}',${jpeg.length},'image/jpeg','${now}');
  `]);

  await page.context().addCookies([{ name: "retaste_session", value: "qa-reviewer-member-session", domain: "127.0.0.1", path: "/" }]);
  expect((await page.request.get(site + preview)).status()).toBe(403);
  expect((await page.goto(location))?.status()).toBe(403);
  await page.context().addCookies([{ name: "retaste_session", value: "qa-admin-session", domain: "127.0.0.1", path: "/" }]);

  await page.goto("/admin/places");
  await page.getByRole("link", { name: "장소 사진 관리", exact: true }).click();
  await page.getByLabel("사진 ID").fill(photo);
  await page.getByRole("button", { name: "사진 조회" }).click();
  await expect(page).toHaveURL(location);
  await expect(page.getByText("검수 대기", { exact: true })).toBeVisible();
  await expect(page.getByText(rightsEvidence, { exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "원본 페이지 보기" })).toHaveAttribute("href", "https://example.test/poi-photo");
  await expect.poll(() => page.getByRole("img", { name: "등록 사진 검수 미리보기" }).evaluate((image: HTMLImageElement) => image.naturalWidth)).toBeGreaterThan(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath("staged-review.png"), fullPage: true });

  const reason = page.getByLabel("변경 사유");
  await reason.fill("합성 사진의 출처와 저장본 확인");
  await page.getByRole("button", { name: "공개 확정" }).click();
  await expect(page).toHaveURL(/\/admin\/reauth\?returnTo=/);
  const verifiedAt = new Date().toISOString();
  const expiresAt = new Date(Date.now() + 300_000).toISOString();
  local(["d1", "execute", "DB", "--command", `
    INSERT INTO admin_session_assurances(session_id,actor_user_id,method,verified_at,expires_at)
    VALUES('qa-admin-session','qa-admin','PASSWORD','${verifiedAt}','${expiresAt}');
  `]);
  await page.goto(location);
  await reason.fill("합성 사진의 출처와 저장본 확인");
  await page.getByRole("button", { name: "공개 확정" }).click();
  await expect(page.getByRole("status")).toContainText("공개 승인");
  await expect(page.getByRole("button", { name: "공개 확정" })).toHaveCount(0);

  const publicContext = await browser.newContext({ viewport: page.viewportSize(), isMobile: mobile, hasTouch: mobile });
  try {
    await publicContext.route("**/*", (route) => new URL(route.request().url()).origin === site ? route.continue() : route.abort());
    const publicPage = await publicContext.newPage();
    const placeName = "Re:Taste 샘플 라멘 동명";
    const detailPath = "/places/sample-dongmyeong-ramen";
    const publicPath = mobile ? `/places?${new URLSearchParams({ place: detailPath })}` : detailPath;
    const detail = mobile ? publicPage.getByRole("dialog") : publicPage.getByRole("main");
    const photoImage = detail.getByRole("img", { name: `${placeName} 장소 사진` });
    const sourceLink = detail.getByRole("link", { name: "출처", exact: true });

    await publicPage.goto(site + publicPath);
    await expect.poll(() => photoImage.evaluate((image: HTMLImageElement) => image.naturalWidth)).toBe(320);
    const originalUrl = "https://example.test/poi-photo";
    await expect(sourceLink).toHaveAttribute("href", originalUrl);
    await publicContext.route(originalUrl, (route) => route.fulfill({ status: 200, body: "synthetic original" }));
    const originalRequest = publicContext.waitForEvent("request", (request) => request.url() === originalUrl);
    const openedOriginal = publicPage.waitForEvent("popup");
    await sourceLink.click();
    expect(await (await originalRequest).headerValue("referer")).toBe(`${site}/`);
    const original = await openedOriginal;
    await expect(original).toHaveURL(originalUrl);
    expect(await original.evaluate(() => window.opener === null)).toBe(true);
    await original.close();

    // The detail still returns the approved metadata when its separate image request fails.
    const imageUrl = `${site}/poi-media/${photo}`;
    const failureStatus = mobile ? 404 : 503;
    await publicPage.route(imageUrl, (route) => route.fulfill({ status: failureStatus, body: "" }));
    const imageResponse = publicPage.waitForResponse(imageUrl);
    await publicPage.reload();
    expect((await imageResponse).status()).toBe(failureStatus);
    await expect(detail.getByRole("heading", { name: placeName, exact: true })).toBeVisible();
    await expect(detail.getByText("광주광역시 동구 동명동", { exact: true }).first()).toBeVisible();
    await expect(detail.getByRole("status").filter({ hasText: "장소 사진을 불러오지 못했어요." })).toBeVisible();
    await expect(photoImage).toHaveCount(0);
    await expect(sourceLink).toHaveCount(0);
    await publicPage.screenshot({ path: info.outputPath("public-photo-unavailable.png"), scale: "css" });
  } finally {
    await publicContext.close();
  }

  await reason.fill("합성 사진 공개 회수 확인");
  await page.getByRole("button", { name: "회수 확정" }).click();
  await expect(page.getByRole("status")).toContainText("회수");
  await expect(page.getByRole("img", { name: "등록 사진 검수 미리보기" })).toHaveCount(0);
  expect((await page.request.get(site + preview)).status()).toBe(404);
  await expect(page.getByRole("button", { name: "회수 확정" })).toHaveCount(0);
  await page.screenshot({ path: info.outputPath("withdrawn.png"), fullPage: true });
});
