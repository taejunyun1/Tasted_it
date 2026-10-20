import { execFileSync } from "node:child_process";
import { expect, test, type BrowserContext, type Page } from "@playwright/test";

test.describe("student workspace", () => {
  test.use({ actionTimeout: 15_000 });
  test.skip(Boolean(process.env.BASE_URL), "Student fixtures must only run against isolated local D1.");
  test.beforeEach(() => {
    execFileSync("pnpm", ["exec", "wrangler", "d1", "execute", "DB", "--local", "--config", "wrangler.e2e.jsonc", "--persist-to", ".wrangler/e2e-state", "--file", "scripts/seed-student-qa.sql"], { stdio: "pipe" });
  });

  test("administrator invitation forms also work before JavaScript starts", async ({ browser, baseURL }) => {
    const context = await browser.newContext({ baseURL, javaScriptEnabled: false });
    try {
      await context.addCookies([{ name: "retaste_session", value: "qa-admin-session", url: baseURL! }]);
      const page = await context.newPage(); await page.goto("/admin/students");
      await page.getByRole("button", { name: "학생 A 초대 발급", exact: true }).click();
      await expect(page.getByLabel("학생에게 전달할 초대 링크")).toBeVisible();
    } finally { await context.close(); }
  });

  test("recovers an invitation after reload and sign-in in the same tab", async ({ page, context, browser, baseURL }, info) => {
    await context.addCookies([{ name: "retaste_session", value: "qa-admin-session", url: baseURL! }]);
    await page.goto("/admin/students");
    await page.getByRole("button", { name: "학생 A 초대 발급", exact: true }).click();
    const invite = await page.getByLabel("학생에게 전달할 초대 링크").inputValue();
    const studentContext = await browser.newContext({ baseURL, viewport: page.viewportSize() });
    try {
      const student = await studentContext.newPage();
      await student.goto(invite);
      await expect(student.getByRole("heading", { name: "먼저 개인 계정으로 로그인해 주세요" })).toBeVisible();
      await student.reload();
      await expect(student.getByRole("heading", { name: "먼저 개인 계정으로 로그인해 주세요" })).toBeVisible();
      await student.getByRole("link", { name: "로그인하고 초대 수락 계속하기", exact: true }).click();
      await expect(student).toHaveURL(`${baseURL}/login?returnTo=%2Fstudent%2Fjoin`);
      // Synthetic local authenticated session: no provider or live invitation is used.
      await studentContext.addCookies([{ name: "retaste_session", value: "qa-student-a-session", url: baseURL! }]);
      await student.goto("/login?returnTo=%2Fstudent%2Fjoin");
      await expect(student.getByRole("heading", { name: "시험 학생 A 계정으로 참여", exact: true })).toBeVisible();
      await student.screenshot({ path: info.outputPath("recovered-invitation.png"), fullPage: true });
      await student.getByRole("button", { name: "초대 수락하고 내 작업 열기" }).click();
      await expect(student.getByRole("heading", { name: "학생 A의 작업", exact: true })).toBeVisible();
      // The accepted invitation must no longer be restored on a later visit.
      await student.goto("/student/join");
      await expect(student).toHaveURL(`${baseURL}/student`);
    } finally { await studentContext.close(); }
  });

  test("four personal invitations, assigned classification, independent checks and revocation", async ({ page: admin, context, browser, baseURL }, info) => {
    test.setTimeout(120_000);
    await context.addCookies([{ name: "retaste_session", value: "qa-admin-session", url: baseURL! }]);
    await admin.goto("/admin/students");
    await expect(admin.getByRole("heading", { name: "학생 계정과 업무 배정", exact: true })).toBeVisible();
    await admin.screenshot({ path: info.outputPath("student-admin.png"), fullPage: true });
    const contexts: BrowserContext[] = []; const students: Record<string, Page> = {};
    try {
      for (const code of ["A", "B", "C", "D"]) {
        await admin.getByRole("button", { name: `학생 ${code} 초대 발급`, exact: true }).click();
        await expect(admin.getByText(`학생 ${code} 개별 초대`, { exact: true })).toBeVisible();
        const invite = await admin.getByLabel("학생에게 전달할 초대 링크").inputValue();
        expect(new URL(invite).hash.length).toBe(44);
        const studentContext = await browser.newContext({ baseURL, viewport: admin.viewportSize(), isMobile: info.project.name === "mobile-chromium", hasTouch: info.project.name === "mobile-chromium" });
        contexts.push(studentContext);
        const student = await studentContext.newPage(); students[code] = student;
        await student.goto(invite);
        await expect(student).toHaveURL(`${baseURL}/student/join`);
        await expect(student.getByRole("heading", { name: "먼저 개인 계정으로 로그인해 주세요" })).toBeVisible();
        // Keep the original invitation tab alive while signup and verification
        // run in another tab, exactly as the student-facing instructions say.
        const signup = await studentContext.newPage();
        const email = `e2e-${code.toLowerCase()}-${crypto.randomUUID()}@example.test`;
        const password = `synthetic-${crypto.randomUUID()}`;
        await signup.goto("/signup");
        await signup.getByLabel("이름", { exact: true }).fill(`가입 시험 학생 ${code}`);
        await signup.getByLabel("이메일", { exact: true }).fill(email);
        await signup.getByLabel("비밀번호 · 10자 이상", { exact: true }).fill(password);
        await signup.getByRole("checkbox", { name: /만 14세 이상/ }).check();
        await signup.getByRole("button", { name: "인증 메일 받고 가입하기", exact: true }).click();
        await expect(signup.getByRole("alert")).toContainText("인증 안내가 등록된 이메일로 전송됩니다.");
        const delivery = await studentContext.request.get(`/__e2e/email?email=${encodeURIComponent(email)}`);
        expect(delivery.status()).toBe(200);
        const message = await delivery.json() as { html: string };
        const verification = message.html.match(/href="([^"]+)"/)![1]!;
        expect(new URL(verification).origin).toBe(new URL(baseURL!).origin);
        await signup.goto(verification);
        await expect(signup.getByRole("heading", { name: "이메일 인증 완료", exact: true })).toBeVisible();
        await signup.goto("/login?returnTo=%2Fstudent%2Fjoin");
        await signup.getByLabel("이메일", { exact: true }).fill(email);
        await signup.getByLabel("비밀번호", { exact: true }).fill(password);
        await signup.getByRole("button", { name: "로그인", exact: true }).click();
        await expect(signup).toHaveURL(`${baseURL}/student/join`);
        await student.getByRole("button", { name: "로그인 상태 확인", exact: true }).click();
        await expect(student.getByRole("heading", { name: `가입 시험 학생 ${code} 계정으로 참여`, exact: true })).toBeVisible();
        await student.getByRole("button", { name: "초대 수락하고 내 작업 열기" }).click();
        await expect(student.getByRole("heading", { name: `학생 ${code}의 작업`, exact: true })).toBeVisible();
        await expect(student.getByText("아직 배정된 작업이 없습니다.", { exact: false })).toBeVisible();
      }
      await admin.goto("/admin/students?step=5");
      await admin.getByRole("combobox", { name: "배정할 대상", exact: true }).selectOption("qa-student-new-store");
      await admin.getByLabel("학생에게 보일 작업명").fill("점포 분류와 등록 인가 실습");
      await admin.getByRole("button", { name: "선택 작업 1건 배정" }).click();
      await expect(admin.getByText("작업을 배정했습니다.", { exact: true })).toBeVisible();

      const a = students.A!; const b = students.B!; const c = students.C!; const d = students.D!;
      await a.goto("/student");
      await a.getByRole("link", { name: /점포 분류와 등록 인가 실습/ }).click();
      await a.getByLabel("세부 음식 종류").selectOption("cat-ramen");
      await a.getByLabel("분류 사유와 확인한 사실").fill("직접 방문하여 독립 운영, 매장 좌석과 음식 종류를 확인했습니다.");
      await a.screenshot({ path: info.outputPath("student-place-form.png"), fullPage: true });
      await a.getByRole("button", { name: "분류 제출하고 교차 확인 요청" }).click();
      await expect(a.getByText("기록을 저장했습니다.", { exact: true })).toBeVisible();
      await expect(a.getByRole("button", { name: "신규 점포 등록 인가", exact: true })).toHaveCount(0);

      const taskUrl = a.url();
      const denied = await c.goto(taskUrl); expect(denied?.status()).toBe(404);
      await b.goto("/student"); await b.getByRole("link", { name: /점포 분류와 등록 인가 실습/ }).click();
      await b.getByLabel("교차 확인 근거 또는 보완할 내용").fill("원천 자료, 현재 영업과 세부 업종을 다시 대조하여 확인했습니다.");
      await b.screenshot({ path: info.outputPath("student-registration-check.png"), fullPage: true });
      await b.getByRole("button", { name: "신규 점포 등록 인가", exact: true }).click();
      await expect(b.getByText("이 작업의 교차 확인을 마쳤습니다.", { exact: true })).toBeVisible();
      await expect(b.getByText("실제 공개는 운영 담당자가", { exact: false })).toHaveCount(0);

      await admin.goto("/admin/students");
      await admin.getByLabel("업무 종류").selectOption("REVIEW");
      await admin.getByRole("combobox", { name: "배정할 대상", exact: true }).selectOption("qa-student-negative-review");
      await admin.getByLabel("학생에게 보일 작업명").fill("리뷰와 사진 분류 실습");
      await admin.getByRole("button", { name: "선택 작업 1건 배정" }).click();
      await expect(admin.getByText("작업을 배정했습니다.", { exact: true })).toBeVisible();
      await c.goto("/student"); await c.getByRole("link", { name: /리뷰와 사진 분류 실습/ }).click();
      await expect(c.getByText("작성자 평가 비추천", { exact: true })).toBeVisible();
      await c.getByLabel("분류 결과").selectOption("NEEDS_INFO");
      await c.getByLabel("분류 사유와 확인한 사실").fill("사진이 없어 현장 근거 보완이 필요합니다. 작성자의 비추천 평가는 유지합니다.");
      await c.getByRole("button", { name: "분류 제출하고 교차 확인 요청" }).click();
      await expect(c.getByText("기록을 저장했습니다.", { exact: true })).toBeVisible();
      await d.goto("/student"); await d.getByRole("link", { name: /리뷰와 사진 분류 실습/ }).click();
      await expect(d.getByRole("button", { name: "신규 점포 등록 인가", exact: true })).toHaveCount(0);
      await d.getByLabel("교차 확인 근거 또는 보완할 내용").fill("사진 보완이 필요하다는 분류를 확인했으며 원래의 평가는 수정하지 않았습니다.");
      await d.getByRole("button", { name: "교차 확인 완료", exact: true }).click();
      await expect(d.getByText("이 작업의 교차 확인을 마쳤습니다.", { exact: true })).toBeVisible();
      await expect(d.getByText("작성자 평가 비추천", { exact: true })).toBeVisible();

      await admin.goto("/admin/students");
      await admin.getByRole("row").filter({ has: admin.getByText("학생 A", { exact: true }) }).getByRole("button", { name: "접근 중지", exact: true }).click();
      await expect(admin.getByText("학생 접근 상태를 변경했습니다.", { exact: false })).toBeVisible();
      const revoked = await a.goto("/student"); expect(revoked?.status()).toBe(403);
      const adminDenied = await b.goto("/admin/students"); expect(adminDenied?.status()).toBe(403);
    } finally { await Promise.allSettled(contexts.map((studentContext) => studentContext.close())); }
  });
});
