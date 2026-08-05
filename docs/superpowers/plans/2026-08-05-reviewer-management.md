# Reviewer Management Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 일반 회원의 리뷰어 신청, 관리자 심사, 공개 프로필, 휴면·정지 관리를 하나의 검증 가능한 흐름으로 구현한다.

**Architecture:** 신청 이력은 `reviewer_applications`, 공개 상태는 `reviewer_profiles`에 분리한다. `reviewer.server.ts`가 상태 전이와 역할 동기화를 소유하며 React Router loader/action은 인증과 폼 변환만 담당한다. 승인 장소 제안 수는 현재 0을 반환하는 독립 함수로 두고 이후 장소 제안 테이블에 연결한다.

**Tech Stack:** React Router 8 Framework Mode, React 19, Cloudflare Workers, D1, Drizzle ORM, Vitest Workers, Playwright.

## Global Constraints

- ACTIVE 프로필만 `users.role = REVIEWER`다.
- 일반 승인은 승인 장소 제안 10곳 이상이어야 한다.
- 10곳 미만 예외 승인은 사유가 필수다.
- 의견서는 100~1,000자, 전문 대분류는 1~3개다.
- 신청·심사·상태 변경은 감사 로그에 기록한다.
- 모든 텍스트와 버튼은 최대 font-weight 600을 사용한다.

---

### Task 1: 리뷰어 데이터 계약과 마이그레이션

**Files:**
- Create: `drizzle/0004_reviewer_management.sql`
- Modify: `app/db/schema.ts`
- Modify: `tests/unit/schema-contract.test.ts`

**Interfaces:**
- Produces: `reviewerApplications`, `reviewerProfiles` Drizzle tables.

- [ ] **Step 1: Write failing schema contract tests**

Import both tables and assert their table names and status columns exist.

- [ ] **Step 2: Run the unit test and verify missing exports**

Run: `pnpm test -- tests/unit/schema-contract.test.ts`
Expected: FAIL because the table exports do not exist.

- [ ] **Step 3: Add migration and Drizzle schema**

Create application states `APPLIED|REVIEWING|APPROVED|REJECTED`, profile states `ACTIVE|DORMANT|SUSPENDED`, unique active application protection through service validation, foreign keys, status indexes, slug unique index, and timestamps.

- [ ] **Step 4: Run unit and integration migration tests**

Run: `pnpm test && pnpm run test:integration`
Expected: PASS.

### Task 2: 신청·심사·휴면 도메인 서비스

**Files:**
- Create: `app/features/reviewers/reviewer-policy.ts`
- Create: `app/features/reviewers/reviewer.server.ts`
- Create: `tests/unit/reviewer-policy.test.ts`
- Create: `tests/integration/reviewer.server.test.ts`

**Interfaces:**
- Produces: `submitReviewerApplication`, `listReviewerAdminRows`, `reviewReviewerApplication`, `changeReviewerStatus`, `applyDormancy`, `getPublicReviewerProfile`, `getReviewerDashboard`.
- Produces: `validateReviewerApplication`, `isDormantAt` pure policy helpers.

- [ ] **Step 1: Write failing policy tests**

Cover statement length, specialty count, 90-day dormancy boundary and required override reason.

- [ ] **Step 2: Run policy tests and verify missing module failure**

Run: `pnpm test -- tests/unit/reviewer-policy.test.ts`
Expected: FAIL because the module is absent.

- [ ] **Step 3: Implement minimal policy helpers**

Return Korean field errors and make the 90-day comparison deterministic with explicit ISO timestamps.

- [ ] **Step 4: Write failing service integration tests**

Cover duplicate pending application, rejected reapplication, under-qualified normal approval rejection, override approval, role/profile creation, dormancy role removal, reactivation, suspension hiding and audit records.

- [ ] **Step 5: Run integration test and verify missing service failure**

Run: `pnpm run test:integration -- tests/integration/reviewer.server.test.ts`
Expected: FAIL because service exports are absent.

- [ ] **Step 6: Implement service and state transitions**

Use transactions/batches where role and profile must change together. `countApprovedPlaceSuggestions` returns 0 until the place suggestion feature supplies its table.

- [ ] **Step 7: Run unit, integration and type tests**

Run: `pnpm test && pnpm run test:integration && pnpm run typecheck`
Expected: PASS.

### Task 3: 회원 신청·관리자 관리·공개 프로필 UI

**Files:**
- Create: `app/routes/reviewer-apply.tsx`
- Create: `app/routes/admin-reviewers.tsx`
- Create: `app/routes/reviewer-profile.tsx`
- Modify: `app/routes.ts`
- Modify: `app/root.tsx`
- Modify: `app/routes/me.tsx`
- Test: `tests/e2e/reviewer-management.spec.ts`

**Interfaces:**
- Consumes: Task 2 reviewer service.
- Produces: `/reviewer/apply`, `/admin/reviewers`, `/reviewers/:slug`.

- [ ] **Step 1: Write failing E2E expectations**

Assert member application fields and eligibility notice, admin state tabs/actions, public profile visibility, and suspended profile 404 behavior.

- [ ] **Step 2: Run E2E and verify missing routes**

Run: `BASE_URL=http://127.0.0.1:5180 pnpm exec playwright test tests/e2e/reviewer-management.spec.ts --project=chromium`
Expected: FAIL with route 404.

- [ ] **Step 3: Register routes and build member application page**

Use `requireUser`, active parent categories, field errors, latest application status and disabled duplicate submission.

- [ ] **Step 4: Build admin reviewer registry**

Use status tabs, name/email search, application/profile details, review start, approve, override approve, reject, dormant, suspend, reactivate and batch dormancy actions.

- [ ] **Step 5: Build public profile and navigation links**

Display ACTIVE/DORMANT profiles, return 404 for SUSPENDED, add reviewer application link to `/me` and reviewer management link to admin navigation.

- [ ] **Step 6: Run desktop and mobile E2E**

Run: `BASE_URL=http://127.0.0.1:5180 pnpm run test:e2e`
Expected: PASS.

### Task 4: 가이드 갱신, 전체 QA, PR과 배포 게이트

**Files:**
- Modify: `docs/superpowers/specs/2026-08-05-tastedit-product-direction-v2-design.md`
- Modify: `scripts/seed-admin-qa.sql`

**Interfaces:**
- Verifies all previous outputs and updates remaining roadmap.

- [ ] **Step 1: Add QA member, application and active reviewer fixtures**

Seed deterministic sessions and reviewer states without storing production credentials.

- [ ] **Step 2: Perform actual browser QA**

Submit a member application, override-approve it as admin, verify the public profile, apply dormancy and verify role/status changes.

- [ ] **Step 3: Update the product guide**

Move reviewer application/management/profile to completed, keep place suggestions, reviewer evaluations, trust metrics, following and notifications in their correct remaining stages.

- [ ] **Step 4: Run full verification**

Run: `pnpm test && pnpm run test:integration && BASE_URL=http://127.0.0.1:5180 pnpm run test:e2e && pnpm run typecheck && pnpm run build && pnpm exec wrangler deploy --dry-run`
Expected: all commands exit 0.

- [ ] **Step 5: Inspect secrets and diff**

Confirm `.dev.vars`, API keys, passwords, Playwright artifacts and QA output are absent from the staged diff.

- [ ] **Step 6: Commit, push, PR, review and merge**

Push `feature/reviewer-management`, open a PR to `main`, review checks and full diff, squash merge, delete the remote branch and update local `main`.

- [ ] **Step 7: Apply migration and deploy only with prerequisites**

Apply D1 migration 0004 after merge. Deploy only if `RESEND_API_KEY`, `RESEND_FROM_EMAIL`, and `APP_BASE_URL` are all configured; otherwise report the exact blocker.

