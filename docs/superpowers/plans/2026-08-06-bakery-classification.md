# Bakery Classification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Expand the existing bakery category so Korean bakery business names and public-data subtypes are classified as `bakery-detail` without introducing broad false positives.

**Architecture:** Extend the focused rule tables in `category-suggestion.ts`; keep category storage and UI unchanged because `bakery-detail` already exists and is active. Prove every behavior through the existing pure classification unit tests before changing production rules.

**Tech Stack:** TypeScript 7, Vitest, React Router Framework Mode, Cloudflare Workers/D1.

## Global Constraints

- Reuse `bakery-detail`; do not add a database migration or a second bakery category.
- Do not treat standalone `빵` or `과자` as strong bakery signals.
- Specific bakery food signals outrank generic `카페` and `디저트` venue signals.
- Follow feature branch, PR, squash merge, and deployment workflow from `AGENTS.md`.

---

### Task 1: Bakery alias classification

**Files:**
- Modify: `tests/unit/category-suggestion.test.ts`
- Modify: `app/features/candidates/category-suggestion.ts`

**Interfaces:**
- Consumes: `classifyCandidate(input): CandidateClassification` and `suggestCategorySlugs(sourceType, subtype): string[]`.
- Produces: `bakery-detail` category suggestions for the approved bakery aliases.

- [ ] **Step 1: Write failing tests for bakery business-name aliases**

Add table-driven assertions for `제과점`, `제빵소`, `제과제빵`, `식빵`, `케이크`, `도넛`, `도너츠`, `크루아상`, `쿠키`, and `과자점` names, expecting `categorySlug` to equal `bakery-detail`.

- [ ] **Step 2: Run the focused test and verify RED**

Run: `corepack pnpm test tests/unit/category-suggestion.test.ts`

Expected: at least `제빵소`, `식빵`, `도넛`, `크루아상`, `쿠키`, or `과자점` fails with a non-bakery category.

- [ ] **Step 3: Extend name and subtype rules minimally**

Update the bakery name rule to match the approved explicit aliases. Update the subtype rule to cover `제빵` and `과자점`. Move `케이크` out of the generic dessert rule so one name cannot produce equal-strength bakery and dessert signals.

- [ ] **Step 4: Run the focused test and verify GREEN**

Run: `corepack pnpm test tests/unit/category-suggestion.test.ts`

Expected: all focused tests pass.

- [ ] **Step 5: Commit**

Commit message: `2026-08-06 베이커리 자동 분류 별칭 확장`

### Task 2: Priority and false-positive regression

**Files:**
- Modify: `tests/unit/category-suggestion.test.ts`
- Modify: `app/features/candidates/category-suggestion.ts` only if the tests expose a priority defect.

**Interfaces:**
- Consumes: bakery rules from Task 1.
- Produces: deterministic bakery-over-cafe behavior and protection from standalone broad terms.

- [ ] **Step 1: Write failing or characterization tests**

Assert that `OO베이커리카페` and `OO케이크디저트` classify as `bakery-detail`; `행복한빵` and `추억의과자` do not classify as `bakery-detail`; and `제과점영업` subtype returns bakery first.

- [ ] **Step 2: Run the focused test**

Run: `corepack pnpm test tests/unit/category-suggestion.test.ts`

Expected: all intended priority behavior passes after Task 1; if a regression fails, change only the conflicting rule.

- [ ] **Step 3: Run classification regression tests**

Run: `corepack pnpm test tests/unit/category-suggestion.test.ts tests/unit/context-category-classification.test.ts`

Expected: all tests pass.

- [ ] **Step 4: Commit**

Commit message: `2026-08-06 베이커리 분류 우선순위 회귀 테스트 추가`

### Task 3: Full verification and delivery

**Files:**
- Verify all changed files and generated build output only; do not commit generated build artifacts.

**Interfaces:**
- Consumes: completed bakery classification rules.
- Produces: merged and deployed production change.

- [ ] **Step 1: Run complete verification**

Run: `corepack pnpm typecheck && corepack pnpm test && corepack pnpm test:integration && corepack pnpm build`

Expected: zero failures.

- [ ] **Step 2: Review diff and repository state**

Run: `git diff --check origin/main...HEAD && git status --short --branch`

Expected: no whitespace errors and only intended commits.

- [ ] **Step 3: Push, open PR, review checks, and squash merge**

Push `codex/bakery-classification`, create a PR into `main`, review the complete diff, and merge only after checks pass.

- [ ] **Step 4: Deploy merged main and smoke test**

Update local `main` from `origin/main`, run `corepack pnpm deploy`, then confirm `/`, `/admin/candidates`, and bakery classification tests remain healthy.

