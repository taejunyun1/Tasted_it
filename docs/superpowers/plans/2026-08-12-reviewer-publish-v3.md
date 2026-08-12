# Re:Taste Reviewer Publish v3 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 리뷰어가 장소 선택부터 추천 여부, 카테고리별 배지, 선택적 Golden Pick까지 짧고 명확한 단계로 발행하는 모바일 우선 리뷰 흐름을 만든다.

**Architecture:** 기존 `current_votes`, `vote_events`, `flavor_ratings`, `golden_pick_events`를 추천 신호의 원본으로 유지한다. 발행 결과의 불변 스냅샷은 `reviewer_visit_reviews` 한 테이블에 평가·카테고리·배지·Golden 이벤트 참조를 저장하고, 사진은 신규 Cloudflare 저장소가 HOLD 상태이므로 브라우저 로컬 미리보기에서만 다룬다. 라우트 loader/action은 REVIEWER 권한, 게시 장소, 활성 리뷰어, 엄격한 폼 계약을 검증한다.

**Tech Stack:** React Router v8 framework mode, React 19, TypeScript 7, Drizzle ORM/D1, Zod 4, Vitest Workers, Playwright.

## Global Constraints

- 기능 브랜치 `codex/tj_reviewer-publish-v3`와 전용 worktree에서만 변경한다.
- 평가 선택지는 정확히 `추천`, `보류`, `비추천`이다.
- 운영 카테고리는 42개이며 카테고리마다 정확히 배지 3개를 제공하고 최대 2개만 선택한다.
- 일반 리뷰에는 서술형 본문이 없고 사진과 배지는 선택 사항이다.
- Golden Pick 사유만 15–100자로 허용하고, 월 3회·동일 장소 90일 제한을 유지한다.
- 타 리뷰어 결과는 현재 리뷰 발행 전에는 노출하지 않는다.
- 신규 R2/Cloudflare Images binding은 추가하지 않는다. 사진은 이번 변경에서 저장·발행되지 않음을 UI와 PR에 명시한다.
- 신규 D1 migration은 PR에서 Data/Tech human review를 받은 뒤에만 운영에 적용한다.

---

### Task 1: Structured Review Contract

**Files:**
- Create: `app/features/ratings/reviewer-visit.ts`
- Test: `tests/unit/reviewer-visit.test.ts`

**Interfaces:**
- Produces: `REVIEWER_BADGE_CATALOG`, `parseReviewerVisitSubmission(formData)`, `reviewerEvaluationToVoteValue()`.

- [x] **Step 1: Write failing catalog and parser tests**

Assert 42 categories, exactly three badges each, max two badges, exact evaluation enum, Golden reason length, unknown badge rejection, and absence of narrative fields.

- [x] **Step 2: Run RED test**

Run: `pnpm exec vitest run tests/unit/reviewer-visit.test.ts`

Expected: FAIL because the reviewer visit module does not exist.

- [x] **Step 3: Implement the minimal typed catalog and strict parser**

Use the approved catalog labels, Zod boundary validation, and a pure evaluation-to-vote mapping where HOLD maps to withdrawal.

- [x] **Step 4: Run GREEN test**

Run: `pnpm exec vitest run tests/unit/reviewer-visit.test.ts`

Expected: all tests pass.

### Task 2: Evaluation and Golden Pick Domain Support

**Files:**
- Modify: `app/features/ratings/vote.server.ts`
- Modify: `app/features/ratings/golden-pick.server.ts`
- Modify: `tests/integration/vote.server.test.ts`
- Modify: `tests/integration/golden-pick.server.test.ts`

**Interfaces:**
- Produces: `withdrawVote(db, input)` and Golden `reason` persistence.

- [x] **Step 1: Write failing integration tests**

Cover WITHDRAW event + current vote deletion + recompute enqueue, idempotent HOLD with no current vote, 15–100 character Golden reason persistence, and existing quota/cooldown rules.

- [x] **Step 2: Run RED Workers tests**

Run: `pnpm run test:integration -- tests/integration/vote.server.test.ts tests/integration/golden-pick.server.test.ts`

Expected: new tests fail on missing behavior.

- [x] **Step 3: Implement withdrawal and reason persistence**

Append a WITHDRAW event only when a current vote exists, delete the current vote in the same D1 batch, mark the place stale, enqueue recompute, and trim/validate Golden reason.

- [x] **Step 4: Run GREEN Workers tests**

Run the same command and expect all focused tests to pass.

### Task 3: Immutable Visit Review Snapshot

**Files:**
- Modify: `app/db/schema.ts`
- Create: `drizzle/0024_reviewer_visit_reviews.sql`
- Create: `app/features/ratings/reviewer-visit.server.ts`
- Create: `tests/integration/reviewer-visit.server.test.ts`

**Interfaces:**
- Consumes: parsed submission, vote withdrawal/cast, Flavor Print, Golden Pick grant.
- Produces: `publishReviewerVisit(db, input)` and `listReviewerVisitHistory(db, reviewerUserId)`.

- [x] **Step 1: Write failing publication integration tests**

Cover normal publish without photo/badges, recommendation and non-recommendation signals, HOLD withdrawal, selected badge snapshot, Golden conditional validation, published history ordering, and no peer aggregate before publication.

- [x] **Step 2: Run RED Workers test**

Run: `pnpm run test:integration -- tests/integration/reviewer-visit.server.test.ts`

Expected: migration/schema/service are absent.

- [x] **Step 3: Add schema, forward migration, and domain service**

Store evaluation, selected category, `badges_json`, optional Golden event reference, version, and timestamps. Validate every referenced entity before performing mutations. Do not store photo blobs, paths, or EXIF.

- [x] **Step 4: Run GREEN Workers test**

Run the focused test and expect all cases to pass.

### Task 4: Connected Reviewer Workspace UI

**Files:**
- Rewrite: `app/routes/reviewer-ratings.tsx`
- Create: `app/components/reviewer-visit-flow.tsx`
- Modify: `app/app.css`
- Modify: `tests/e2e/rating-foundation.spec.ts`
- Create: `tests/unit/reviewer-visit-components.test.ts`

**Interfaces:**
- Consumes: loader place/category/quota/history data and publish action.
- Produces: app-first five-step flow with local draft persistence.

- [x] **Step 1: Write failing component and E2E assertions**

Assert searchable place selection, exact evaluation controls, three category badges with max two, local photo preview disclosure, conditional Golden reason, preview, publish success, recent history, desktop summary, and mobile sticky action.

- [x] **Step 2: Run RED UI tests**

Run: `pnpm exec vitest run tests/unit/reviewer-visit-components.test.ts` and `pnpm run test:e2e -- tests/e2e/rating-foundation.spec.ts`.

Expected: old list workspace fails the new flow contract.

- [x] **Step 3: Implement the v3 UI**

Use the current Re:Taste spacing, cream/ink/green palette, calm rounded states, accessible pressed states, focusable dialogs/sheets, `localStorage` autosave/resume/discard, and no game-like Golden treatment.

- [x] **Step 4: Run GREEN UI tests**

Run the focused unit and desktop/mobile E2E tests and expect all cases to pass.

### Task 5: Verification and Delivery

**Files:**
- Modify: `docs/superpowers/plans/2026-08-12-reviewer-publish-v3.md`

**Interfaces:**
- Produces: verified feature branch and reviewable PR.

- [x] **Step 1: Run focused and full verification**

Run typecheck, build, focused unit/integration/E2E, relevant full suites, and `git diff --check`.

- [x] **Step 2: Capture visual evidence**

Capture desktop and 390px mobile screenshots for the empty state, badge selection, Golden conditional state, preview, and success/history state.

- [x] **Step 3: Self-review privacy, accessibility, and migration rollback**

Confirm no photo bytes or EXIF reach D1/logs, peer data remains hidden before publication, controls have visible text and keyboard state, and migration rollback is documented as dropping only the new snapshot table before production data exists.

- [ ] **Step 4: Commit, push, and open PR**

Use a dated Korean commit summary, push only the feature branch, and open a PR to `main` linking Issue #85 with Data/Tech review, migration, photo HOLD, verification evidence, and rollback notes. Do not merge or deploy without human approval.

## Verification Notes — 2026-08-12

- Unit: `./node_modules/.bin/vitest run --config vitest.config.ts` — 93 files, 588 tests passed.
- Workers/D1: `./node_modules/.bin/vitest run --config vitest.workers.config.ts` — 43 files, 224 tests passed.
- Browser: `BASE_URL=http://127.0.0.1:5173 ./node_modules/.bin/playwright test tests/e2e/rating-foundation.spec.ts --project=chromium --project=mobile-chromium` — 4 passed.
- Type: `./node_modules/.bin/react-router typegen && ./node_modules/.bin/tsc -b` — passed.
- Build: `./node_modules/.bin/react-router build` — passed; sandbox-only Wrangler log-file warning did not affect the build output or exit status.
- Visual evidence: desktop and 390px mobile for empty, badges, Golden HOLD, preview, and success/history states under `docs/evidence/`.
- Privacy: selected local photo bytes, paths, and EXIF are never submitted or written to D1/logs.
- Rollback: before production data exists, roll back by dropping only `reviewer_visit_reviews`; after production data exists, export/approval is required before any destructive rollback.
- Release gate: migration `0024` and production deployment remain blocked on Data/Tech human approval. Golden Pick publication remains disabled until durable photo storage is separately approved.
