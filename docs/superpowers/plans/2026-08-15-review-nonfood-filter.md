# 검수 파이프라인 선택 토글·비음식점 자동 제외 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 1단계 검수의 전체 선택을 단일 토글로 바꾸고, 현재 페이지의 확실한 비음식점을 업태·상호 규칙으로 자동 제외한다.

**Architecture:** UI는 선택 상태만 토글한다. 자동 제외 action은 현재 페이지의 work item ID를 서버로 보내고, 서버가 기존 `classifyFoodVenue` 정책으로 비음식점만 `EXCLUDED` 및 감사 이력으로 기록한다.

**Tech Stack:** React Router 8, React 19, Drizzle/D1, Vitest, Cloudflare Workers.

## Global Constraints

- 자동 제외는 `SOURCE_REVIEW` 단계의 활성 항목에만 적용한다.
- 기존 `food-venue-policy`의 확실한 일치만 사용한다.
- 장소·사업자 원천·공개 상태는 삭제하거나 변경하지 않는다.
- 최대 25개를 처리하고 새 의존성, migration, 외부 API는 추가하지 않는다.

---

### Task 1: 자동 비음식 제외 서비스

**Files:**
- Modify: `app/features/places/place-review-work-items.server.ts`
- Test: `tests/integration/place-review-work-items.server.test.ts`

**Interface:** `autoExcludeNonFoodReviewItems(db, { workItemIds, actorUserId, now })` returns changed IDs and skipped codes.

- [x] **Step 1: Write the failing test**

```ts
it("auto-excludes only definite non-food source-review items", async () => {
  const result = await autoExcludeNonFoodReviewItems(db, { workItemIds: [nonFood.id, restaurant.id], actorUserId: adminId, now });
  expect(result.changed).toEqual([nonFood.id]);
  expect(result.skipped).toContainEqual({ workItemId: restaurant.id, code: "NOT_NON_FOOD" });
  await expect(findWorkItem(nonFood.id)).resolves.toMatchObject({ status: "EXCLUDED", holdCode: "AUTO_NON_FOOD" });
});
```

- [x] **Step 2: Verify RED**

Run: `pnpm vitest run tests/integration/place-review-work-items.server.test.ts`

Expected: FAIL because `autoExcludeNonFoodReviewItems` is missing.

- [x] **Step 3: Implement the minimal service**

```ts
export async function autoExcludeNonFoodReviewItems(db: AppDb, input: { workItemIds: string[]; actorUserId: string; now: string }) {
  // For each active SOURCE_REVIEW item, load its business license and call classifyFoodVenue.
  // On EXCLUDE: write EXCLUDED, AUTO_NON_FOOD, matched-rule note, and PLACE_REVIEW_AUTO_EXCLUDE_NON_FOOD audit log.
  // Otherwise record NOT_NON_FOOD; reject stale/non-active/non-source items as skipped.
}
```

- [x] **Step 4: Verify GREEN**

Run: `pnpm vitest run tests/integration/place-review-work-items.server.test.ts`

Expected: PASS.

- [x] **Step 5: Commit**

Run: `git add app/features/places/place-review-work-items.server.ts tests/integration/place-review-work-items.server.test.ts && git commit -m "2026-08-15 검수 비음식점 자동 제외 추가"`

### Task 2: 검수 action과 단일 선택 토글

**Files:**
- Modify: `app/routes/admin-place-operations.tsx`
- Modify: `app/components/admin/PlaceReviewPipeline.tsx`
- Test: `tests/unit/admin-place-operations-auto-exclude.test.ts`
- Test: `tests/unit/place-review-pipeline-contract.test.ts`

**Interface:** POST intent `auto-exclude-non-food-review-items` invokes Task 1 only at step 1.

- [x] **Step 1: Write failing route and UI contract tests**

```ts
expect(route).toContain('intent === "auto-exclude-non-food-review-items"');
expect(route).toContain("autoExcludeNonFoodReviewItems");
expect(component).toContain("togglePageSelection");
expect(component).toContain('query.step === 1');
```

- [x] **Step 2: Verify RED**

Run: `pnpm vitest run tests/unit/admin-place-operations-auto-exclude.test.ts tests/unit/place-review-pipeline-contract.test.ts`

Expected: FAIL because the action and toggle do not exist.

- [x] **Step 3: Implement the route action and UI**

```tsx
const togglePageSelection = () => setSelectedIds((current) => current.length ? [] : page.rows.slice(0, 25).map((row) => row.workItemId));
<button type="button" onClick={togglePageSelection}>{selectedIds.length ? "선택 해제" : `현재 페이지 ${page.rows.length}곳 선택`}</button>
{query.step === 1 && <button name="intent" value="auto-exclude-non-food-review-items">비음식점 자동 제외</button>}
```

The form supplies all current page work items for the automatic action regardless of checkbox state. The route rejects non-step-1 or empty requests before generic selection validation.

- [x] **Step 4: Verify GREEN**

Run: `pnpm vitest run tests/unit/admin-place-operations-auto-exclude.test.ts tests/unit/place-review-pipeline-contract.test.ts`

Expected: PASS.

- [x] **Step 5: Commit**

Run: `git add app/routes/admin-place-operations.tsx app/components/admin/PlaceReviewPipeline.tsx tests/unit/admin-place-operations-auto-exclude.test.ts tests/unit/place-review-pipeline-contract.test.ts && git commit -m "2026-08-15 검수 선택 토글과 자동 제외 버튼 추가"`

### Task 3: 전체 검증과 UI 증거

**Files:**
- Modify: `docs/superpowers/plans/2026-08-15-review-nonfood-filter.md`

- [x] **Step 1: Run full checks**

Run: `pnpm run typecheck && pnpm test && ./node_modules/.bin/react-router build`

Expected: exit 0.

Result: `pnpm run typecheck`, unit suite (767 tests), changed-scope Workers integration tests, and production build passed. The full Workers integration suite has three baseline failures outside this change: two NAVER confidence fixtures expect 80 while the shared matcher returns 100, and one React module-resolution failure under the worktree path.

- [x] **Step 2: Verify desktop and mobile UI**

Use local E2E data and Playwright CLI to capture desktop and mobile step-1 screens. Confirm one selection button and `비음식점 자동 제외`; open step 2 to confirm the automatic action is absent.

- [x] **Step 3: Commit completed checklist**

Run: `git add docs/superpowers/plans/2026-08-15-review-nonfood-filter.md && git commit -m "2026-08-15 비음식점 자동 제외 검증 기록"`

## Self-review

- Task 1 covers safe policy reuse, status update, and audit log.
- Task 2 covers the one-button selection UX and route guard.
- Task 3 covers tests and desktop/mobile evidence.
- No placeholder, migration, dependency, or external-service work remains.
