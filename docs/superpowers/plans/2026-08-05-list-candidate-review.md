# List Candidate Review Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 관리자 후보 검수를 지도 없는 단일 리스트로 통합하고, 주소에서 동네를 자동 계산하며, 자동 분류 후보와 수동 분류 후보를 안전하게 일괄 승인한다.

**Architecture:** `bulk-review.server.ts`가 모든 후보를 AUTO, MANUAL, BLOCKED 상태로 계산한다. `/admin/candidates` loader는 이 결과와 활성 세부 카테고리를 제공하고 action은 후보별 선택 카테고리를 검증한 뒤 승인한다. `/admin/candidates/bulk`는 호환성을 위해 통합 화면으로 redirect한다.

**Tech Stack:** React Router 8, React 19, Cloudflare Workers/D1, Drizzle ORM, Vitest Workers, Playwright.

## Global Constraints

- 관리자 화면에 지도와 동네 입력 필드를 표시하지 않는다.
- 동네는 승인 시 제출값이 아니라 주소에서 서버가 계산한 값만 사용한다.
- 폐업, 비대상 업종, 주소·좌표 누락, 동네 추출 실패, 중복은 승인할 수 없다.
- HIGH 후보만 AUTO이며 MEDIUM, LOW, CONFLICT는 MANUAL이다.
- 실제 외부 AI 호출은 이번 PR에 넣지 않고 구조화된 분류 제공자 경계만 둔다.
- 일괄 승인은 한 번에 최대 25곳이다.
- 제목과 주요 버튼은 최대 600 weight를 사용한다.

---

### Task 1: 검수 상태 모델과 주소 기반 승인

**Files:**
- Create: `app/features/candidates/review-classification.ts`
- Modify: `app/features/candidates/bulk-review.server.ts`
- Modify: `app/features/candidates/candidate.server.ts`
- Test: `tests/unit/candidate-review-state.test.ts`
- Test: `tests/integration/candidate.server.test.ts`

**Interfaces:**
- Produces: `classifyReviewState(input): { state: "AUTO" | "MANUAL" | "BLOCKED"; blockers: string[]; reviewReasons: string[] }`.
- Changes: `approveCandidate` no longer accepts `neighborhood`; it derives the value with `extractNeighborhood(input.address)`.

- [ ] **Step 1: Write failing state tests**

```ts
expect(classifyReviewState({ confidence: "HIGH", categoryAvailable: true, address: "광주광역시 동구 동명동", neighborhood: "동명동", latitude: 35.1, longitude: 126.9, duplicate: false })).toMatchObject({ state: "AUTO" });
expect(classifyReviewState({ confidence: "CONFLICT", categoryAvailable: true, address: "광주광역시 동구 동명동", neighborhood: "동명동", latitude: 35.1, longitude: 126.9, duplicate: false })).toMatchObject({ state: "MANUAL" });
expect(classifyReviewState({ confidence: "HIGH", categoryAvailable: true, address: "광주", neighborhood: null, latitude: null, longitude: null, duplicate: false })).toMatchObject({ state: "BLOCKED" });
```

- [ ] **Step 2: Run tests and verify missing module failure**

Run: `pnpm test -- tests/unit/candidate-review-state.test.ts`

- [ ] **Step 3: Implement the pure state model**

Hard blockers are missing address, missing neighborhood, invalid coordinates, and duplicate. Missing or inactive automatic category and non-HIGH confidence become review reasons so an administrator can choose an active child category manually.

- [ ] **Step 4: Write a failing approval test**

Call `approveCandidate` without `neighborhood` and assert that the created Place stores `운림동` from the address. Call it with an address lacking 동·읍·면·리 and assert `PLACE_NEIGHBORHOOD_NOT_FOUND`.

- [ ] **Step 5: Implement server-owned neighborhood derivation**

Remove the input field from the TypeScript signature, call `extractNeighborhood(input.address)`, and use the result in `places.neighborhood` and `searchText`.

- [ ] **Step 6: Run unit, integration, and type tests**

Run: `pnpm test && pnpm run test:integration && pnpm run typecheck`

### Task 2: 수동 카테고리 선택 일괄 승인

**Files:**
- Modify: `app/features/candidates/bulk-review.server.ts`
- Test: `tests/integration/bulk-review.server.test.ts`

**Interfaces:**
- Produces: `approveCandidateSelections(db, { selections: Array<{ candidateId: string; categoryId: string }>; actorUserId: string; now: string })`.
- Consumes: Task 1 review state and address-derived neighborhood.

- [ ] **Step 1: Write failing integration tests**

Test that a CONFLICT candidate is approved when an administrator supplies an active child category. Test that BLOCKED candidates remain skipped even when a category is supplied. Test the 25-item limit.

- [ ] **Step 2: Verify the new function is absent**

Run: `pnpm run test:integration -- tests/integration/bulk-review.server.test.ts`

- [ ] **Step 3: Implement selection validation**

Load the current review rows, validate the submitted category against active child categories, reject BLOCKED rows, deduplicate candidate IDs and same-name/address rows, then call `approveCandidate`.

- [ ] **Step 4: Preserve the automatic approval wrapper**

Keep `bulkApproveCandidates` as a compatibility wrapper that converts AUTO rows to `{ candidateId, categoryId }` selections. MANUAL rows require an explicit submitted category.

- [ ] **Step 5: Run integration tests**

Run: `pnpm run test:integration -- tests/integration/bulk-review.server.test.ts`

### Task 3: 통합 리스트 검수 화면

**Files:**
- Rewrite: `app/routes/admin-candidates.tsx`
- Replace: `app/routes/admin-candidates-bulk.tsx`
- Modify: `app/app.css`
- Test: `tests/e2e/admin-candidate-review.spec.ts`

**Interfaces:**
- Consumes: `listBulkReviewGroups`, `approveCandidateSelections`, active child categories.
- Produces: tabbed list at `/admin/candidates` and redirect from `/admin/candidates/bulk`.

- [ ] **Step 1: Rewrite E2E expectations first**

Assert that the page has tabs `전체`, `자동 승인`, `수동 확인`, `승인 불가`; has no `후보 네이버 지도` or `동네` textbox; shows HIGH as selectable; shows CONFLICT with a category select; and shows duplicate/coordinate-missing rows disabled.

- [ ] **Step 2: Run E2E and confirm old map UI fails expectations**

Run: `BASE_URL=http://127.0.0.1:5173 pnpm exec playwright test tests/e2e/admin-candidate-review.spec.ts --project=chromium`

- [ ] **Step 3: Build the unified loader and action**

The loader returns grouped rows, summary counts, active child categories, subtype options and URL filters. The action parses checked `candidateIds` and corresponding `category:<candidateId>` values and calls `approveCandidateSelections`.

- [ ] **Step 4: Build the list UI**

Use a responsive table/list with summary cards, tabs, filters, 25/50/100 page size, per-row checkbox, automatic neighborhood text, editable category select for MANUAL rows, blockers for BLOCKED rows, and expandable classification reasons.

- [ ] **Step 5: Remove map and manual neighborhood UI**

Delete `CandidateMap` usage from the route. Do not render any input named `neighborhood`. Keep coordinates read-only in the row.

- [ ] **Step 6: Redirect the legacy bulk route**

The `/admin/candidates/bulk` loader returns `redirect("/admin/candidates")`; no duplicate UI remains.

- [ ] **Step 7: Run desktop and mobile E2E**

Run: `BASE_URL=http://127.0.0.1:5173 pnpm run test:e2e`

### Task 4: Full QA, documentation, PR, and deployment gate

**Files:**
- Modify: `docs/superpowers/specs/2026-08-05-tastedit-product-direction-v2-design.md` only if implementation reveals a contradiction.
- Modify: `README.md` only if operator commands change.

**Interfaces:**
- Verifies all outputs from Tasks 1–3.

- [ ] **Step 1: Seed QA candidates and run browser QA**

Verify AUTO, MANUAL, BLOCKED, duplicate, coordinate-missing, and closed candidates. Manually choose a category for a conflict candidate, approve it, and confirm it appears in the member list.

- [ ] **Step 2: Run the full verification suite**

```bash
pnpm test
pnpm run test:integration
pnpm run test:e2e
pnpm run typecheck
pnpm run build
pnpm exec wrangler deploy --dry-run
```

- [ ] **Step 3: Inspect secrets and diff**

Confirm `.dev.vars`, API keys, passwords, Playwright artifacts, and QA-generated files are not staged.

- [ ] **Step 4: Commit, push, PR, and merge**

Use a dated Korean summary commit, push `feature/product-direction-v2`, open a PR into `main`, inspect checks and the complete diff, then squash merge and delete the remote branch.

- [ ] **Step 5: Deploy only when runtime prerequisites are present**

Update local `main`, apply required remote D1 migrations, verify required secrets, deploy the merged main, and smoke-test `/`, `/places`, `/login`, and `/admin/candidates`. If Resend secrets remain absent, report the exact deployment blocker rather than publishing an incomplete authentication flow.
