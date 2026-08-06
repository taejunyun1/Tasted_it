# Context Category v3 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 한국 음식점 문맥을 대표 메뉴 중심으로 분류하고, 관리자 카테고리 선택 시 발생하는 `null.value` 렌더 오류를 제거한다.

**Architecture:** 상호명과 업태에서 구체 음식, 음식군, 영업 형태, 행정 분류 신호를 추출해 점수화하고 가장 구체적인 음식 신호를 대표 카테고리로 선택한다. 규칙 결과는 상위 2~4개 AI 후보를 제공하며, Workers AI는 이 후보와 점수 근거를 검증한다. 관리자 선택 UI는 DOM 이벤트 객체를 상태 업데이트 콜백에 보존하지 않고 문자열 값을 즉시 캡처한다.

**Tech Stack:** React Router 8 Framework Mode, React 19, TypeScript 7, Vitest, Cloudflare Workers AI, D1/Drizzle

## Global Constraints

- `호프/통닭`, `통닭호프`, `치킨호프`는 치킨을 우선한다.
- 해장국, 순대국, 돼지국밥, 설렁탕, 곰탕은 MVP에서 국밥으로 통합한다.
- 구체 음식은 음식군·영업 형태·행정 업태보다 우선한다.
- AI는 규칙의 단일 결과가 아니라 상위 2~4개 활성 세부 카테고리 중 선택한다.
- 기존 관리자 승인·공개 절차는 변경하지 않는다.
- AI 프롬프트와 캐시는 `place-category-v3`으로 버전 분리한다.

---

### Task 1: 관리자 카테고리 선택 오류 수정

**Files:**
- Modify: `app/routes/admin-candidates.tsx`
- Create: `app/features/candidates/category-selection.ts`
- Test: `tests/unit/category-selection.test.ts`

**Interfaces:**
- Produces: `setCandidateCategory(current: Record<string, string>, candidateId: string, categoryId: string): Record<string, string>`

- [ ] **Step 1: Write the failing test**

```ts
expect(setCandidateCategory({ a: "old" }, "a", "new")).toEqual({ a: "new" });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `corepack pnpm vitest run tests/unit/category-selection.test.ts`
Expected: FAIL because `category-selection` does not exist.

- [ ] **Step 3: Implement the minimal state helper and capture the select value synchronously**

```tsx
onChange={(event) => {
  const categoryId = event.currentTarget.value;
  setChosenCategories((current) => setCandidateCategory(current, row.id, categoryId));
}}
```

- [ ] **Step 4: Run the unit test**

Run: `corepack pnpm vitest run tests/unit/category-selection.test.ts`
Expected: PASS.

### Task 2: 대표 메뉴 문맥 점수 분류

**Files:**
- Modify: `app/features/candidates/category-suggestion.ts`
- Modify: `tests/unit/category-suggestion.test.ts`
- Modify: `tests/unit/candidate-auto-classification.test.ts`

**Interfaces:**
- Produces: existing `classifyCandidate(...) => CandidateClassification`
- Produces: `candidateSlugs` ordered by contextual score, maximum four unique slugs.

- [ ] **Step 1: Add failing examples**

```ts
expect(suggestCategorySlugs("ENTERTAINMENT_BAR", "호프/통닭")[0]).toBe("chicken");
expect(classifyCandidate({ sourceType: "GENERAL_RESTAURANT", businessName: "전주해장국", businessSubtype: "한식" }).categorySlug).toBe("gukbap-detail");
expect(classifyCandidate({ sourceType: "GENERAL_RESTAURANT", businessName: "서울설렁탕", businessSubtype: "한식" }).categorySlug).toBe("gukbap-detail");
```

- [ ] **Step 2: Run focused tests and verify contextual examples fail**

Run: `corepack pnpm vitest run tests/unit/category-suggestion.test.ts tests/unit/candidate-auto-classification.test.ts`
Expected: FAIL for `호프/통닭` and soup-family mappings.

- [ ] **Step 3: Implement scored signals**

Use explicit priorities: business-name concrete food `100`, subtype concrete food `70`, cuisine group `30`, venue style `20`, source default `5`. Merge duplicate slugs, sort descending, and retain the top four. Mark a result as conflict only when top competing concrete-food signals are close; do not treat a lower broad cuisine or venue signal as a conflict.

- [ ] **Step 4: Run focused tests**

Run: `corepack pnpm vitest run tests/unit/category-suggestion.test.ts tests/unit/candidate-auto-classification.test.ts`
Expected: PASS.

### Task 3: Workers AI contextual candidate validation

**Files:**
- Modify: `app/features/candidates/ai-classification.server.ts`
- Modify: `tests/integration/ai-classification.server.test.ts`

**Interfaces:**
- Changes: `AI_CLASSIFICATION_PROMPT = "place-category-v3"`
- Consumes: ordered `CandidateClassification.candidateSlugs`.

- [ ] **Step 1: Add a failing integration test**

Insert a `호프/통닭` candidate and assert the AI payload contains `chicken`, the prompt is v3, and the persisted successful run uses `chicken`.

- [ ] **Step 2: Run the integration test and verify it fails**

Run: `corepack pnpm test:integration -- tests/integration/ai-classification.server.test.ts`
Expected: FAIL because prompt v2/current candidate restriction is unchanged.

- [ ] **Step 3: Update prompt payload and candidate validation**

Send ordered rule candidates with score/reason context, allow only those active candidates, and explain in the system prompt that specific food terms outrank venue terms (`통닭 > 호프`, `해장국 > 한식`). Retain grounded-evidence validation and one retry.

- [ ] **Step 4: Run integration tests**

Run: `corepack pnpm test:integration -- tests/integration/ai-classification.server.test.ts`
Expected: PASS.

### Task 4: Full verification and delivery

**Files:**
- Modify: `docs/superpowers/plans/2026-08-06-context-category-v3.md` (checkbox completion only if needed)

- [ ] **Step 1: Run unit, integration, type, and build verification**

```bash
corepack pnpm test
corepack pnpm test:integration
corepack pnpm typecheck
corepack pnpm build
```

Expected: all commands exit 0.

- [ ] **Step 2: Commit, push, open PR, review diff/checks, squash merge, and deploy merged main**

Use branch `codex/context-category-v3`; do not push directly to `main`.
