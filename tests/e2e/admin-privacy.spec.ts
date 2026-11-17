import { execFileSync } from "node:child_process";
import { expect, test } from "@playwright/test";
const localD1 = (sql: string) => execFileSync("pnpm", ["exec", "wrangler", "d1", "execute", "DB", "--local", "--config", "wrangler.e2e.jsonc", "--persist-to", ".wrangler/e2e-state", "--command", sql], { encoding: "utf8" });

test("privacy intake and owner-requested cleanup retain their separate effects", async ({ page }, info) => {
  test.skip(Boolean(process.env.BASE_URL), "Requires isolated local D1 fixtures");
  const suffix = info.project.name === "chromium" ? "desktop" : "mobile", id = `qa-privacy-${suffix}`, reviewId = `${id}-review`, key = `reviews/${reviewId}/photo.jpg`, now = new Date().toISOString();
  localD1(`DELETE FROM privacy_requests WHERE user_id='qa-reviewer-member'; DELETE FROM admin_session_assurances WHERE session_id='qa-admin-session';
    INSERT OR IGNORE INTO users(id,email,display_name,role,created_at,updated_at) VALUES('${id}','withdrawn.${id}@invalid.local','합성 탈퇴 회원','USER','${now}','${now}');
    INSERT OR IGNORE INTO categories(id,slug,name,emoji,sort_order,is_active,created_at,updated_at) VALUES('${id}','${id}','라멘','x',999,1,'${now}','${now}');
    INSERT OR IGNORE INTO places(id,slug,name,status,address,neighborhood,latitude,longitude,search_text,created_at,updated_at) VALUES('${id}','${id}','합성 장소','PUBLISHED','광주','동명동',35,126,'합성','${now}','${now}');
    INSERT INTO reviewer_visit_reviews(id,place_id,reviewer_user_id,category_id,evaluation,badges_json,photo_count,published_at,created_at,updated_at) VALUES('${reviewId}','${id}','${id}','${id}','RECOMMEND','[]',1,'${now}','${now}','${now}');
    INSERT INTO reviewer_photo_cleanup_jobs(review_id,purpose,object_keys_json,next_attempt_at,attempt_count,status,created_at,updated_at) VALUES('${reviewId}','DELETE','["${key}"]','2099-01-01T00:00:00.000Z',1,'FAILED','${now}','${now}');`);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("response", (response) => { if (response.status() >= 500) errors.push(`HTTP ${response.status()}`); });
  try {
    await page.context().addCookies([{ name: "retaste_session", value: "qa-reviewer-member-session", domain: "127.0.0.1", path: "/" }]);
    await page.goto("/me/privacy");
    await page.getByRole("combobox", { name: "요청 유형", exact: true }).selectOption("DELETION");
    await page.getByRole("button", { name: "요청 유형 접수", exact: true }).click();
    await expect(page.getByRole("status")).toContainText("아직 자료를 열람·정정·삭제하거나 처리를 정지하지 않았습니다.");
    await page.context().addCookies([{ name: "retaste_session", value: "qa-admin-session", domain: "127.0.0.1", path: "/" }]);
    await page.goto("/admin/privacy");
    const requests = page.getByRole("region", { name: "개인정보 요청 · 최대 50건" });
    await requests.getByRole("combobox", { name: "처리 기록", exact: true }).selectOption("POLICY_UNRESOLVED");
    await requests.getByRole("button", { name: "요청 상태 미리보기", exact: true }).click();
    await page.getByRole("button", { name: "변경 확정", exact: true }).click();
    await expect(page).toHaveURL(/\/admin\/reauth\?returnTo=/);
    const returnTo = new URL(page.url()).searchParams.get("returnTo")!;
    const verifiedAt = new Date().toISOString(), expiresAt = new Date(Date.now() + 300_000).toISOString();
    localD1(`INSERT OR REPLACE INTO admin_session_assurances(session_id,actor_user_id,method,verified_at,expires_at) VALUES('qa-admin-session','qa-admin','PASSWORD','${verifiedAt}','${expiresAt}');`);
    await page.goto(returnTo);
    await page.getByRole("button", { name: "변경 확정", exact: true }).click();
    await expect(requests).toContainText("정책 확인 대기");
    await page.goto("/admin/privacy");
    const cleanup = page.getByRole("region", { name: "사진 정리 대기 · 최대 25건" });
    const job = cleanup.getByRole("listitem").filter({ hasText: reviewId });
    await job.getByRole("button", { name: "사진 정리 재시도 미리보기", exact: true }).click();
    await expect(page.getByRole("region", { name: "변경 미리보기" })).toContainText("이 확인 자체가 삭제 완료는 아닙니다.");
    expect(await page.content()).not.toContain(key);
    await page.screenshot({ path: info.outputPath("privacy-cleanup-preview.png"), fullPage: true });
    await page.getByRole("button", { name: "변경 확정", exact: true }).click();
    await expect(job).not.toContainText("실패·재시도 대기");
    await expect(job).toContainText("재시도 대기");
    expect(await page.content()).not.toContain(key);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect(errors).toEqual([]);
    await page.evaluate(() => { if (document.activeElement instanceof HTMLElement) document.activeElement.blur(); });
    await page.screenshot({ path: info.outputPath("privacy-console.png"), fullPage: true });
  } finally {
    localD1(`DELETE FROM reviewer_photo_cleanup_jobs WHERE review_id='${reviewId}'; DELETE FROM reviewer_visit_reviews WHERE id='${reviewId}'; DELETE FROM privacy_requests WHERE user_id='qa-reviewer-member'; DELETE FROM admin_session_assurances WHERE session_id='qa-admin-session';`);
  }
});

test("member cannot access administrator privacy records", async ({ page }) => {
  await page.context().addCookies([{ name: "retaste_session", value: "qa-reviewer-member-session", domain: "127.0.0.1", path: "/" }]);
  expect((await page.goto("/admin/privacy"))?.status()).toBe(403);
});
