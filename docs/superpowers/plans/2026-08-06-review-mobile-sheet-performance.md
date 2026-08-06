# Review, AI Performance, and Mobile Detail Sheet Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every selectable terminal category approvable, reduce AI classification latency, and replace mobile detail-page navigation with a reusable full-detail bottom sheet.

**Architecture:** Centralize terminal-category and approval-error policy in pure candidate helpers, then let the server and UI share it. Split AI work into rule-only completion and a concurrency-limited AI pool. Extract a shared place-detail view model behind a resource route and render it in one mobile sheet controlled by URL search parameters from both map and list surfaces.

**Tech Stack:** TypeScript 7, React 19, React Router 8 Framework Mode, Cloudflare Workers AI/D1, Vitest, Playwright.

## Global Constraints

- Mobile means viewport width `<= 760px`; desktop keeps `/places/:placeSlug` navigation.
- The mobile sheet always has a top-right close button and a persistent `맛집지도에 추가` action.
- Childless active categories are terminal; parent groups with active children are not terminal.
- AI processes at most 10 candidates and at most 3 AI requests concurrently.
- Existing AI quota, cache, retry, save, vote, and public-place visibility rules remain in force.
- Every completed change goes through a feature branch, PR, squash merge, and deployment from merged `main`.

---

### Task 1: Terminal category approval and useful failure feedback

**Files:**
- Modify: `app/features/candidates/category-selection.ts`
- Modify: `app/features/candidates/candidate.server.ts`
- Modify: `app/features/candidates/bulk-review.server.ts`
- Modify: `app/routes/admin-candidates.tsx`
- Modify: `tests/unit/category-selection.test.ts`
- Modify: `tests/integration/bulk-review.server.test.ts`

**Interfaces:**
- Produces: `getTerminalCategoryIds(categories): Set<string>` and `formatCandidateApprovalError(reason): string`.
- Consumes: active category rows with `id` and `parentId`.

- [ ] **Step 1: Write failing terminal-category tests**

Add assertions proving a childless parent such as `cat-chicken` is terminal, a child such as `cat-gukbap` is terminal, and a parent with a child such as `cat-korean` is not terminal. Add an integration case that approves a pending candidate using `cat-chicken`.

- [ ] **Step 2: Run RED tests**

Run: `corepack pnpm test tests/unit/category-selection.test.ts && corepack pnpm test:integration tests/integration/bulk-review.server.test.ts`

Expected: the childless-parent approval fails with `CATEGORY_NOT_FOUND`.

- [ ] **Step 3: Implement shared terminal policy**

Implement `getTerminalCategoryIds` by collecting all referenced parent IDs and returning every active row whose ID is not referenced as a parent. Use this set in `listSelectableCategories`, `approveCandidate`, and `approveCandidateSelections`.

- [ ] **Step 4: Add failure-message mapping and UI list**

Map `CATEGORY_NOT_FOUND`, `CANDIDATE_NOT_APPROVABLE`, duplicate, coordinate, and unknown errors to Korean text. Render each skipped candidate name and reason below the action summary.

- [ ] **Step 5: Verify and commit**

Run the focused unit and integration tests. Commit as `2026-08-06 최종 카테고리 승인과 실패 안내 수정`.

### Task 2: Rule-first, concurrency-limited AI classification

**Files:**
- Create: `app/features/candidates/ai-classification-concurrency.ts`
- Modify: `app/features/candidates/ai-classification.server.ts`
- Modify: `app/routes/admin-candidates.tsx`
- Create: `tests/unit/ai-classification-concurrency.test.ts`
- Modify: `tests/integration/ai-classification.server.test.ts`

**Interfaces:**
- Produces: `mapWithConcurrency<T, R>(items, concurrency, worker): Promise<R[]>`.
- Extends classification result with `ruleCompleted: number` while retaining `processed`, `succeeded`, `failed`, `cached`, `limited`, and `quota`.

- [ ] **Step 1: Write concurrency RED tests**

Use a controlled async worker to assert ordered results and a peak active count of exactly 3 for ten items. Add an integration test proving a HIGH rule candidate with an active terminal category does not call the AI binding.

- [ ] **Step 2: Run RED tests**

Run: `corepack pnpm test tests/unit/ai-classification-concurrency.test.ts && corepack pnpm test:integration tests/integration/ai-classification.server.test.ts`

Expected: missing helper and unexpected AI invocation failures.

- [ ] **Step 3: Extract one-candidate classification**

Keep hashing, cache validation, quota accounting, retry, success/failure persistence, and alert recording inside a focused worker function returning one candidate result.

- [ ] **Step 4: Add rule-only completion and a three-slot pool**

Partition candidates into terminal HIGH rule matches and AI-required candidates. Persist successful rule-only runs with model `RULE_ONLY`, zero token usage, and the current prompt version. Process only the second partition with `mapWithConcurrency(..., 3, ...)`.

- [ ] **Step 5: Update progress copy, verify, and commit**

Show `규칙 즉시 완료 N · AI 성공 N · 실패 N`. Run focused tests and commit as `2026-08-06 규칙 우선 AI 분류 병렬 처리`.

### Task 3: Shared place-detail resource model

**Files:**
- Create: `app/features/places/place-detail.server.ts`
- Create: `app/routes/place-detail-resource.ts`
- Modify: `app/routes/place-detail.tsx`
- Modify: `app/routes.ts`
- Create: `tests/integration/place-detail-resource.test.ts`

**Interfaces:**
- Produces: `getPlaceDetailView(db, { slug, request, now })` returning `{ place, rating, flavorPrint, hiddenGem, hasGoldenPick, user, vote, saved }`.
- Resource loader: `GET /resources/places/:placeSlug` returns the view model as JSON.
- Resource action accepts existing `vote` and `save` intents and returns updated JSON without redirect.

- [ ] **Step 1: Write failing view-model and resource tests**

Assert the resource returns published place detail, rating composition, save state, vote state, badges, and Flavor Print; assert hidden places return 404.

- [ ] **Step 2: Run RED tests**

Run: `corepack pnpm test:integration tests/integration/place-detail-resource.test.ts`

Expected: resource route/helper does not exist.

- [ ] **Step 3: Extract the existing detail loader**

Move the data assembly from `place-detail.tsx` into `getPlaceDetailView` and have both the page loader and resource loader call it. Preserve detail-view recording once per loader request.

- [ ] **Step 4: Add resource save/vote action**

Reuse `setSaved` and `castVote`, require login for mutations, and return the refreshed view model rather than redirecting.

- [ ] **Step 5: Verify and commit**

Run the new integration test plus existing rating/save tests. Commit as `2026-08-06 모바일 상세 리소스 모델 분리`.

### Task 4: Reusable mobile full-detail bottom sheet

**Files:**
- Create: `app/components/places/MobilePlaceDetailSheet.tsx`
- Create: `app/features/places/mobile-detail-state.ts`
- Modify: `app/app.css`
- Create: `tests/unit/mobile-detail-state.test.ts`
- Create: `tests/e2e/mobile-place-detail-sheet.spec.ts`

**Interfaces:**
- `MobilePlaceDetailSheet({ slug, onClose, returnTo })` loads `/resources/places/:slug` with `useFetcher`.
- `openMobilePlaceDetail(urlSearchParams, slug)` and `closeMobilePlaceDetail(urlSearchParams)` manage `place=<slug>` without removing existing filters.

- [ ] **Step 1: Write URL-state RED tests**

Assert opening preserves `bbox`, `category`, and `q`, and closing removes only `place`.

- [ ] **Step 2: Run RED test**

Run: `corepack pnpm test tests/unit/mobile-detail-state.test.ts`

Expected: helper module does not exist.

- [ ] **Step 3: Implement the sheet and URL helpers**

Render loading, error, and full detail states. Add `role="dialog"`, `aria-modal`, fixed top-right close button, focus restoration, Escape/backdrop close, body scroll lock, and a scrollable content region.

- [ ] **Step 4: Connect save, vote, login return, and fixed actions**

Use resource fetcher submissions for authenticated save/vote. For anonymous users, link to `/login?returnTo=<current URL with place param>`. Keep `맛집지도에 추가` and `네이버 길찾기` in the bottom action bar.

- [ ] **Step 5: Add CSS and mobile E2E**

Test close button visibility, full rating content, bottom action visibility, Escape/backdrop close, history back, and scroll restoration at the mobile viewport.

- [ ] **Step 6: Verify and commit**

Run unit and mobile E2E tests. Commit as `2026-08-06 모바일 전체 상세 바텀시트 구현`.

### Task 5: Map and discovery-list integration

**Files:**
- Modify: `app/routes/home.tsx`
- Modify: `app/routes/place-list.tsx`
- Modify: `app/components/map/MapPlaceDetail.tsx`
- Modify: `app/components/places/PlaceCard.tsx`
- Modify: `app/components/places/PlaceDiscoveryRail.tsx`
- Modify: `tests/e2e/map-explorer-panel.spec.ts`
- Modify: `tests/e2e/place-discovery-feed.spec.ts`

**Interfaces:**
- Place cards receive optional `onDetail(place)`; without it they retain a normal detail link.
- Home and place-list routes render one `MobilePlaceDetailSheet` from the `place` search parameter.

- [ ] **Step 1: Write failing map/list E2E expectations**

On mobile, clicking the map quick sheet `상세 보기` or a discovery card must keep the current pathname and open the full sheet. On desktop the same discovery card must navigate to `/places/:slug`.

- [ ] **Step 2: Run RED E2E tests**

Run: `corepack pnpm exec playwright test tests/e2e/map-explorer-panel.spec.ts tests/e2e/place-discovery-feed.spec.ts --project=mobile-chromium`

Expected: current links navigate away.

- [ ] **Step 3: Wire mobile interception without breaking links**

Use viewport media matching to intercept only mobile activation, update the current route's search params, and preserve standard anchors for desktop, keyboard fallback, and open-in-new-tab behavior.

- [ ] **Step 4: Verify both viewport modes and commit**

Run the two specs in Chromium and mobile Chromium. Commit as `2026-08-06 지도 목록 모바일 상세 흐름 통일`.

### Task 6: Full verification, PR, merge, and deployment

**Files:**
- Verify all modified source, test, spec, and plan files.

**Interfaces:**
- Produces the merged and deployed release.

- [ ] **Step 1: Run full verification**

Run: `corepack pnpm typecheck && corepack pnpm test && corepack pnpm test:integration && corepack pnpm build && corepack pnpm exec playwright test`.

- [ ] **Step 2: Review diff and repository state**

Run: `git diff --check origin/main...HEAD && git status --short --branch` and review every changed file.

- [ ] **Step 3: Push and create PR**

Push `codex/review-mobile-sheet-performance`, open a PR into `main`, review checks and the GitHub diff, then squash merge.

- [ ] **Step 4: Deploy merged main and smoke test**

Fast-forward local `main`, deploy with `corepack pnpm deploy`, then verify public map/list/detail resources and authenticated admin approval UI.
