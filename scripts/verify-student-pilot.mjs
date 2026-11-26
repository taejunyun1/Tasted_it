import assert from "node:assert/strict";
import { chmod, mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium, expect, request } from "@playwright/test";

const [origin, credentialFile, ...extra] = process.argv.slice(2);
if (!/^http:\/\/127\.0\.0\.1:[0-9]{1,5}$/.test(origin ?? "") || !credentialFile || extra.length) {
  console.error("Usage: node scripts/verify-student-pilot.mjs http://127.0.0.1:<port> <private-credentials.json>");
  process.exit(1);
}

let phase = "load synthetic credentials";
const expected = { admin: "pilot-admin@example.test", C: "pilot-student-c@example.test", D: "pilot-student-d@example.test" };
const validPassword = (password) => typeof password === "string" && /^[A-Za-z0-9_-]{32}$/.test(password);
let browser;
let anonymous;

async function login(page, account) {
  await page.getByLabel("이메일", { exact: true }).fill(account.email);
  await page.getByLabel("비밀번호", { exact: true }).fill(account.password);
  await page.getByRole("button", { name: "로그인", exact: true }).click();
}

async function applyAsReviewer(page) {
  await page.goto("/reviewer/apply");
  if (!(await page.locator('[name="statement"]').count())) {
    await expect(page.getByRole("heading", { name: /신청이 접수됐습니다|관리자가 검토 중입니다|현재 활동 중인 리뷰어/ })).toBeVisible();
    return;
  }
  await page.locator('[name="statement"]').fill("광주 골목 식당을 직접 방문하고 재료와 가격 대비 만족도, 재방문 의사를 기록합니다. 광고보다 일관된 기준과 솔직한 근거를 중요하게 생각합니다. 여러 번 방문해 계절과 시간대에 따른 차이를 기록하고 운영자의 확인 사항을 보완하겠습니다.");
  await page.locator('[name="occupation"]').fill("합성 학생");
  await page.locator('[name="tasteDirection"]').fill("국물 요리와 동네 식당을 좋아합니다.");
  await page.locator('input[name="specialtySlugs"]').first().check();
  await page.getByRole("button", { name: "리뷰어 신청 제출" }).click();
  await expect(page.getByText("신청이 접수됐습니다. 관리자 검토를 기다려 주세요.")).toBeVisible();
}

async function submission(page, seat, evidence) {
  await page.goto("/reviewer/ratings");
  await page.getByPlaceholder("다녀온 장소 검색").fill("샘플 라멘 동명");
  await page.getByRole("button", { name: /Re:Taste 샘플 라멘 동명/ }).click();
  await page.getByRole("button", { name: "다음: 평가" }).click();
  await page.getByRole("button", { name: "추천", exact: true }).click();
  await page.getByRole("button", { name: "다음: 맛 배지" }).click();
  await page.getByRole("button", { name: "다음: 사진·Golden" }).click();
  // Generate a JPEG with no account, place, or document content.
  const jpeg = await page.evaluate(() => {
    const canvas = document.createElement("canvas");
    canvas.width = 240;
    canvas.height = 160;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#e8eada";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = "#1a291e";
    ctx.font = "20px sans-serif";
    ctx.fillText("LOCAL TEST PHOTO", 20, 85);
    return canvas.toDataURL("image/jpeg").split(",")[1];
  });
  await page.locator('input[name="photos"]').setInputFiles({
    name: "synthetic.jpg", mimeType: "image/jpeg", buffer: Buffer.from(jpeg, "base64"),
  });
  await expect(page.getByRole("img", { name: "제출 전 사진 1" })).toBeVisible();
  const today = new Date().toISOString().slice(0, 10);
  await page.getByLabel("사진 1 촬영일", { exact: true }).fill(today);
  await page.getByRole("combobox", { name: "사진 1 이용권리", exact: true }).selectOption("OWN_WORK");
  await page.getByLabel("사진 1 권리 근거", { exact: true }).fill("로컬 검증을 위해 직접 생성한 합성 이미지");
  await page.getByLabel("사진 1 설명", { exact: true }).fill("격리 검수용 합성 사진");
  await page.getByLabel("사진 1의 불필요한 인물·차량번호·개인정보 노출을 확인했어요.").check();
  const screenshot = join(evidence, `student-${seat}.png`);
  await page.locator('[aria-labelledby="review-step-photo"]').scrollIntoViewIfNeeded();
  await page.evaluate(() => document.activeElement?.blur());
  await page.screenshot({ path: screenshot });
  await chmod(screenshot, 0o600);
  await page.getByRole("button", { name: "다음: 확인" }).click();
  await page.getByLabel("방문일", { exact: true }).fill(today);
  await page.getByRole("textbox", { name: "직접 확인한 방문 근거", exact: true }).fill("합성 시험 자료: 방문 리뷰 상태와 사진 공개 범위를 검증합니다.");
  await page.getByRole("combobox", { name: "광고·협찬·이해관계", exact: true }).selectOption("NONE");
  await page.getByRole("button", { name: "검수 요청", exact: true }).click();
  await expect(page).toHaveURL(/notice=review-with-photos-submitted/);
  const id = new URL(page.url()).searchParams.get("submitted");
  assert.match(id, /^[0-9a-z-]+$/);
  const row = page.locator(`#review-${id}`);
  const privatePath = await row.locator(".reviewer-history-thumb").getAttribute("src");
  assert.match(privatePath, /^\/review-photos\/[0-9a-z-]+\?preview=1$/);
  return { id, row, privatePath, publicPath: privatePath.split("?")[0] };
}

async function status(api, path, expectedStatus) {
  const response = await api.get(path, { maxRedirects: 0 });
  assert.equal(response.status(), expectedStatus);
  return response;
}

try {
  const { access, admin, students } = JSON.parse(await readFile(credentialFile, "utf8"));
  assert.equal(access.username, "pilot");
  assert.equal(admin.email, expected.admin);
  assert.deepEqual(students.map(({ seat, email }) => [seat, email]), [["C", expected.C], ["D", expected.D]]);
  assert([access, admin, ...students].every(({ password }) => validPassword(password)));
  const httpCredentials = { username: access.username, password: access.password, origin, send: "always" };
  const evidence = await mkdtemp(join(tmpdir(), "retaste-pilot-browser-"));
  await chmod(evidence, 0o700);
  browser = await chromium.launch();
  const newContext = async (viewport) => {
    const context = await browser.newContext({ baseURL: origin, httpCredentials, viewport, serviceWorkers: "block" });
    context.setDefaultTimeout(12_000);
    await context.route("**/*", (route) => {
      const url = new URL(route.request().url());
      return url.origin === origin || url.protocol === "data:" || url.protocol === "blob:" ? route.continue() : route.abort();
    });
    return context;
  };

  phase = "anonymous and scoped route boundaries";
  anonymous = await request.newContext({ baseURL: origin });
  await status(anonymous, "/student", 401);
  await status(anonymous, "/assets/not-a-real-file.js", 401);
  assert.match(await (await status(anonymous, "/robots.txt", 200)).text(), /Disallow: \//);
  const adminContext = await newContext({ width: 1366, height: 850 });
  const adminPage = await adminContext.newPage();
  for (const path of ["/register", "/auth/google", "/internal/rsi-self-check", "/admin/providers", "/admin/providers.data", "/me/privacy"]) {
    await status(adminContext.request, path, 404);
  }
  assert.equal((await adminContext.request.post("/admin/reauth", { form: { intent: "email-send" }, maxRedirects: 0 })).status(), 403);

  phase = "real admin login and verification of recent authentication";
  await adminPage.goto("/login?returnTo=%2Fadmin%2Fstudents");
  await login(adminPage, admin);
  await expect(adminPage.getByRole("heading", { name: "학생 계정과 업무 배정" })).toBeVisible();
  await adminPage.goto("/admin/reauth?returnTo=%2Fadmin%2Fstudents");
  await adminPage.getByLabel("현재 비밀번호").fill(admin.password);
  await adminPage.getByRole("button", { name: "비밀번호로 확인" }).click();
  await expect(adminPage.getByRole("heading", { name: "학생 계정과 업무 배정" })).toBeVisible();
  console.log("Access boundaries, administrator login and password reauthentication passed.");

  const participants = [];
  let invitationsIssued = 0;
  for (const account of students) {
    phase = `invitation and reviewer application ${account.seat}`;
    await adminPage.goto("/admin/students");
    const context = await newContext(account.seat === "C" ? { width: 1366, height: 850 } : { width: 390, height: 844 });
    const page = await context.newPage();
    const issue = adminPage.getByRole("button", { name: `학생 ${account.seat} 초대 발급 미리보기`, exact: true });
    if (await issue.count()) {
      await issue.click();
      await adminPage.getByRole("button", { name: "변경 확정", exact: true }).click();
      const invite = new URL(await adminPage.getByLabel("학생에게 전달할 초대 링크").inputValue());
      assert.equal(invite.origin, origin);
      assert.equal(invite.pathname, "/student/join");
      await page.goto(invite.href);
      await page.getByText("로그인하고 초대 수락 계속하기", { exact: true }).click();
      await login(page, account);
      await page.getByRole("button", { name: "초대 수락하고 내 작업 열기" }).click();
      invitationsIssued += 1;
    } else {
      await page.goto("/login?returnTo=%2Fstudent");
      await login(page, account);
    }
    await expect(page.getByRole("heading", { name: `학생 ${account.seat}의 작업`, exact: true })).toBeVisible();
    await status(context.request, "/admin/students", 403);
    await applyAsReviewer(page);
    participants.push({ account, context, page });
  }

  phase = "moderator approval for the two synthetic reviewer applications";
  await adminPage.goto("/admin/reviewers?status=APPLIED");
  const approval = adminPage.locator("form").filter({ has: adminPage.getByRole("button", { name: "선택 신청 미리보기" }) });
  let approved = 0;
  for (const { account } of participants) {
    const selected = approval.getByLabel(`합성 학생 ${account.seat} 신청 선택`);
    if (await selected.count()) {
      await selected.check();
      approved += 1;
    }
  }
  if (approved) {
    await approval.locator('select[name="change"]').selectOption("OVERRIDE_APPROVE");
    await approval.locator('input[name="reason"]').fill("격리 실증에서 학생 두 명의 사진 제출 범위를 확인합니다.");
    await approval.getByRole("button", { name: "선택 신청 미리보기" }).click();
    await adminPage.getByRole("button", { name: "선택한 변경 확정" }).click();
    await expect(adminPage.getByRole("heading", { name: "작업 영수증", exact: true })).toBeVisible();
  }
  console.log(`Verified both linked seats; this run issued ${invitationsIssued} invitations and approved ${approved} applications.`);

  for (const participant of participants) {
    phase = `photo wizard and private pending image ${participant.account.seat}`;
    const review = await submission(participant.page, participant.account.seat, evidence);
    Object.assign(participant, review);
    await status(participant.context.request, review.privatePath, 200);
    await status(adminContext.request, review.publicPath, 404);
  }

  phase = "image approval and signed-out public-place verification";
  const viewer = await newContext({ width: 1366, height: 850 });
  for (const participant of participants) {
    const card = adminPage.locator(`#moderation-${participant.id}`);
    await adminPage.goto("/admin/reviewer-visits?status=ALL");
    await card.getByLabel("검수 사유").fill("합성 방문과 사진 권리를 확인했습니다.");
    for (const name of ["visitVerified", "rightsVerified", "privacyVerified", "placeVerified"]) {
      await card.locator(`input[name="${name}"]`).check();
    }
    await card.getByRole("button", { name: "승인·공개", exact: true }).click();
    await expect(card.locator(".reviewer-moderation-status")).toHaveText("승인됨");
    const image = await status(viewer.request, participant.publicPath, 200);
    assert.equal(image.headers()["content-type"], "image/jpeg");
  }
  const publicPage = await viewer.newPage();
  await publicPage.goto("/places/sample-dongmyeong-ramen");
  const photos = publicPage.getByRole("region", { name: "리뷰어가 남긴 사진", exact: true });
  await expect(photos.getByRole("link", { name: /^사진 제공/ })).toHaveCount(2);

  phase = "student withdrawal and public image removal";
  for (const { context, page, id, publicPath } of participants) {
    await page.goto("/reviewer/ratings");
    const row = page.locator(`#review-${id}`);
    const version = await row.locator('form:has(input[value="withdraw-review"]) input[name="expectedVersion"]').inputValue();
    const result = await context.request.post("/reviewer/ratings", {
      maxRedirects: 0, headers: { Origin: origin },
      form: { intent: "withdraw-review", reviewId: id, expectedVersion: version, reason: "격리 검증 뒤 합성 사진 정리" },
    });
    assert.equal(result.status(), 303);
    await status(viewer.request, publicPath, 404);
  }
  console.log("Verified two student sign-ins, review submissions, image visibility and withdrawal.");
  console.log(`Synthetic desktop and mobile evidence: ${evidence}`);
} catch {
  console.error(`Student pilot browser verification failed at phase: ${phase}`);
  process.exitCode = 1;
} finally {
  await browser?.close();
  await anonymous?.dispose();
}
