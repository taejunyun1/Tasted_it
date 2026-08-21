# NAVER 카테고리 근거 v2 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** NAVER 장소 일치와 세부 카테고리 확정을 분리해, 넓은 NAVER 업종이 `디저트`·`백반·가정식` 같은 세부 카테고리로 자동 적용되지 않게 한다.

**Architecture:** 기존 NAVER Local 응답은 계속 요청 직후 폐기한다. 순수 판정 함수가 카테고리 경로의 마지막 업종만 해석하고, 세부 업종이 아닌 경우에는 `NAVER_BROAD_CATEGORY` 근거만 남긴다. 관리자 파이프라인은 이 근거를 읽어 추천·보류를 구분해서 표시한다.

**Tech Stack:** React Router Framework Mode, TypeScript, Drizzle/D1, Vitest. 새 의존성·Cloudflare binding·외부 API는 추가하지 않는다.

## Global Constraints

- 상호·주소 일치는 NAVER 확인 상태로 유지하되, 넓은 업종만으로 세부 카테고리를 자동 확정하지 않는다.
- 원문 NAVER 검색 응답과 카테고리 문자열은 저장하지 않는다. 현재의 상태·점수·근거 코드만 저장한다.
- 기존 공개 장소·기존 카테고리는 일괄 변경하지 않는다.
- UI 변경은 데스크톱·모바일에서 확인하고, PR에 근거·검증·rollback을 기록한다.

---

### Task 1: NAVER 카테고리 경로의 안전한 세부 업종 판정

**Files:**
- Modify: `app/features/candidates/naver-local-category.ts`
- Test: `tests/unit/naver-local-category-v2.test.ts`

**Interfaces:**
- Produces: `matchNaverLocalCategory(...).mappedCategorySlug`
- Guarantees: `음식점>카페/디저트` 같은 넓은 leaf는 `null`, `음식점>한식>육류,고기요리`는 `grill`

- [ ] **Step 1: Write the failing tests** for a broad `카페/디저트` path and a specific `베이커리` leaf.
- [ ] **Step 2: Run** `pnpm exec vitest run tests/unit/naver-local-category-v2.test.ts` and confirm the new expectations fail against the current parent-path substring matcher.
- [ ] **Step 3: Implement** a category-path leaf extractor and map only that leaf; preserve existing specific mappings and `NAVER_BROAD_CATEGORY` semantics.
- [ ] **Step 4: Re-run** the focused test and confirm it passes.

### Task 2: 관리자 검수 카드에서 카테고리 근거 표시

**Files:**
- Modify: `app/features/places/place-review-query.server.ts`
- Modify: `app/components/admin/PlaceReviewCard.tsx`
- Test: `tests/integration/place-review-query.server.test.ts`
- Test: `tests/unit/place-review-pipeline-contract.test.ts`

**Interfaces:**
- Produces: `PlaceReviewQueueRow.naverCategoryEvidence` as `SPECIFIC`, `BROAD`, or `NONE`
- Consumes: existing verification evidence JSON only; does not retain provider category text.

- [ ] **Step 1: Write failing query/component contract tests** for specific recommendation and broad-only hold wording.
- [ ] **Step 2: Run the focused tests** and confirm the new row field and wording are absent.
- [ ] **Step 3: Implement** evidence projection in the query and concise card copy: `NAVER 세부 업종 추천`, `NAVER 광역 업종만 확인`, or `NAVER 업종 근거 없음`.
- [ ] **Step 4: Re-run focused tests** and confirm both cases pass.

### Task 3: Regression verification and handoff

**Files:**
- Modify: test files from Tasks 1–2 only if coverage needs a regression assertion.

- [ ] **Step 1: Run** focused unit and integration tests plus `pnpm run typecheck`.
- [ ] **Step 2: Review** `git diff --check` and the final diff; confirm no migration, secret, dependency, or production data operation is included.
- [ ] **Step 3: Commit and push** the dedicated branch, create a PR with NAVER call limits unchanged and rollback as reverting the code-only change.
- [ ] **Step 4: After checks pass**, review, squash merge, update local main, and deploy from merged main only.
