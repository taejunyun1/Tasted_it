# TypeScript 7, Mobile Navigation, and Grounded Classification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Upgrade to TypeScript 7.0.2, simplify global navigation, collapse mobile search behind place details, and prevent ungrounded restaurant classifications.

**Architecture:** Keep map selection in the URL and pass a selection flag into the mobile panel. Use an accessible disclosure for secondary navigation. Replace first-match category rules with scored multi-signal evidence, then validate Workers AI evidence against the normalized business name and subtype before reconciliation.

**Tech Stack:** React 19, React Router 8.3, TypeScript 7.0.2, Vitest, Playwright, Cloudflare Workers AI, D1, Wrangler.

## Global Constraints

- Pin `typescript` to exactly `7.0.2`.
- Keep `wrangler types && react-router typegen && tsc -b` as the typecheck pipeline.
- Do not add an external web search API in this release.
- Never raise confidence from an AI probability alone.
- Preserve desktop map/list behavior and existing Cloudflare AI quota controls.

---

### Task 1: Multi-signal rule classification

**Files:**
- Modify: `app/features/candidates/category-suggestion.ts`
- Test: `tests/unit/candidate-auto-classification.test.ts`

**Interfaces:**
- Consumes: `classifyCandidate(input)` existing public API.
- Produces: the existing `CandidateClassification` with complete evidence in `reasons` and `CONFLICT` for multiple category signals.

- [ ] **Step 1: Add failing regression tests**

```ts
it("normalizes 육계장 and never suggests gimbap", () => {
  const result = classifyCandidate({ sourceType: "GENERAL_RESTAURANT", businessSubtype: "기타", businessName: "콩물동부육계장" });
  expect(result).toMatchObject({ categorySlug: "stew" });
  expect(result.reasons.join(" ")).toContain("육계장");
});

it("keeps mixed takoyaki and burger signals in manual conflict", () => {
  expect(classifyCandidate({ sourceType: "GENERAL_RESTAURANT", businessSubtype: "한식", businessName: "다마수제타코야끼앤버거" })).toMatchObject({ confidence: "CONFLICT" });
});
```

- [ ] **Step 2: Run the focused test and confirm the expected failures**

Run: `corepack pnpm vitest run tests/unit/candidate-auto-classification.test.ts`
Expected: `콩물동부육계장` resolves to the source default and the mixed name does not expose both signals.

- [ ] **Step 3: Implement normalization and all-signal collection**

Add `normalizeBusinessName()` that removes whitespace/punctuation and maps `육계장` to `육개장`. Add explicit `육개장`, `콩물`, and `타코야끼` rules. Replace `nameRules.find` with `nameRules.filter`, deduplicate slugs, and return `CONFLICT` when more than one slug remains. Keep one matching name signal as the selected slug and include every matched label in `reasons`.

- [ ] **Step 4: Run the focused unit test**

Run: `corepack pnpm vitest run tests/unit/candidate-auto-classification.test.ts`
Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add app/features/candidates/category-suggestion.ts tests/unit/candidate-auto-classification.test.ts
git commit -m "2026-08-06 상호명 다중 신호 분류 보강"
```

### Task 2: Ground Workers AI output

**Files:**
- Modify: `app/features/candidates/ai-classification-policy.ts`
- Modify: `app/features/candidates/ai-classification.server.ts`
- Test: `tests/unit/ai-classification-policy.test.ts`
- Test: `tests/integration/ai-classification.server.test.ts`

**Interfaces:**
- Produces: `validateGroundedAiClassification(raw, allowedSlugs, evidenceText)` which rejects evidence not present in the normalized input.
- Preserves: `reconcileAiClassification` return shape and quota accounting.

- [ ] **Step 1: Add a failing evidence-validation unit test**

```ts
expect(() => validateGroundedAiClassification(
  { categorySlug: "gimbap", confidence: 0.8, evidence: ["gimbap"], reasons: ["김밥"] },
  new Set(["gimbap"]),
  "콩물동부육계장 기타",
)).toThrow("AI_EVIDENCE_UNGROUNDED");
```

- [ ] **Step 2: Run the policy test and confirm missing API failure**

Run: `corepack pnpm vitest run tests/unit/ai-classification-policy.test.ts`
Expected: failure because `validateGroundedAiClassification` does not exist.

- [ ] **Step 3: Implement grounded schema and prompt v2**

Extend AI output with `evidence: string[]` containing 1–3 source tokens. Normalize both evidence and `evidenceText`; reject empty or absent tokens with `AI_EVIDENCE_UNGROUNDED`. Set prompt version to `place-category-v2`, include deterministic rule candidates in the payload, and instruct the model to select only those candidates or `other` while copying evidence tokens from the supplied name/subtype. Do not reuse v1 cache entries because the prompt version changes the input hash payload.

- [ ] **Step 4: Add and run integration coverage**

Add an integration case where Workers AI returns `gimbap` and evidence `gimbap` for `콩물동부육계장`; expect a failed run with `AI_EVIDENCE_UNGROUNDED`. Run: `corepack pnpm test:integration -- tests/integration/ai-classification.server.test.ts`. Expected: all integration tests pass.

- [ ] **Step 5: Commit**

```bash
git add app/features/candidates/ai-classification-policy.ts app/features/candidates/ai-classification.server.ts tests/unit/ai-classification-policy.test.ts tests/integration/ai-classification.server.test.ts
git commit -m "2026-08-06 AI 분류 근거 검증 추가"
```

### Task 3: Header disclosure and mobile panel coordination

**Files:**
- Modify: `app/root.tsx`
- Modify: `app/routes/home.tsx`
- Modify: `app/components/map/MapExplorerPanel.tsx`
- Modify: `app/app.css`
- Test: `tests/e2e/browse.spec.ts`
- Test: `tests/e2e/map-explorer-panel.spec.ts`

**Interfaces:**
- `MapExplorerPanel` gains `hasSelectedPlace: boolean`.
- Header fixed links are `/places` and `/me`; secondary actions live in `.site-menu`.

- [ ] **Step 1: Update E2E expectations before UI code**

Assert fixed links named `맛집 리스트` and `내 상태`, a button/summary named `메뉴`, and no visible `장소 제안` before opening the menu. In mobile map E2E, open `목록`, select a place, assert the quick-info dialog is visible and the panel has `data-mobile-view="map"`, then click `목록` and assert list content is visible again.

- [ ] **Step 2: Run focused E2E and confirm failure**

Run: `corepack pnpm exec playwright test tests/e2e/browse.spec.ts tests/e2e/map-explorer-panel.spec.ts --project=mobile-chromium`
Expected: failures for missing menu and unchanged list state after selection.

- [ ] **Step 3: Implement the disclosure and selection coordination**

Use `<details className="site-menu"><summary aria-label="메뉴">☰</summary>…</details>`. Keep `맛집 리스트` and `내 상태` outside it. Pass `Boolean(selectedPlace)` from `Home`; in `MapExplorerPanel`, use an effect on `hasSelectedPlace` that sets `mobileView` to `map` only when selection becomes true. Keep the list tab as the explicit reopen action.

- [ ] **Step 4: Add compact responsive CSS and run E2E**

Style `.site-head__primary` as the fixed link row and `.site-menu__panel` as a right-aligned flat popover with readable text actions. Keep the mobile header one row. Run the focused E2E command and expect all cases to pass.

- [ ] **Step 5: Commit**

```bash
git add app/root.tsx app/routes/home.tsx app/components/map/MapExplorerPanel.tsx app/app.css tests/e2e/browse.spec.ts tests/e2e/map-explorer-panel.spec.ts
git commit -m "2026-08-06 햄버거 메뉴와 모바일 탐색 패널 연동"
```

### Task 4: TypeScript 7 and release QA

**Files:**
- Modify: `package.json`
- Modify: `pnpm-lock.yaml`
- Modify only if diagnosed: `tsconfig.json`, `tsconfig.node.json`, `tsconfig.cloudflare.json`
- Modify: `docs/superpowers/plans/2026-08-06-typescript7-mobile-navigation-classification.md`

**Interfaces:**
- `corepack pnpm exec tsc --version` must report `Version 7.0.2`.

- [ ] **Step 1: Record the TypeScript 5.9 baseline**

Run `corepack pnpm typecheck` and save the exit status and duration in the release notes section of this plan.

- [ ] **Step 2: Pin TypeScript 7.0.2 and regenerate the lockfile**

Run `corepack pnpm add -D --save-exact typescript@7.0.2`. Verify React Router resolves with the TypeScript 7 peer dependency.

- [ ] **Step 3: Run TypeScript 7 and fix only diagnosed incompatibilities**

Run `corepack pnpm exec tsc --version && corepack pnpm typecheck`. If diagnostics identify removed compiler options, update only those exact options and rerun until clean.

- [ ] **Step 4: Run the complete QA matrix**

Run:

```bash
corepack pnpm test
corepack pnpm test:integration
corepack pnpm test:e2e
corepack pnpm typecheck
corepack pnpm build
corepack pnpm exec wrangler deploy --dry-run
corepack pnpm exec wrangler check startup
git diff --check
```

Expected: zero failed tests, zero TypeScript diagnostics, successful build/dry-run, and Worker startup within the reported platform limit.

- [ ] **Step 5: Commit and release through the repository workflow**

Commit the dependency and any compatibility changes, push `codex/ts7-mobile-nav`, open a PR to `main`, review the diff and checks, squash merge, update local `main`, deploy from merged `main`, and smoke-check the public map plus protected admin redirect.

## Release Notes

- TypeScript 5.9.3 baseline: 성공, 6.64초 (`wrangler types`, React Router typegen 포함).
