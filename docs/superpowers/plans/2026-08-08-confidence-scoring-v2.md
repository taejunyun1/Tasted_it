# 분류 신뢰도 점수 고도화 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 상호명·원천 업태·공공데이터 종류를 연속 점수로 합산하고, 구체 음식 근거끼리만 충돌시키며, AI 결과는 규칙 점수를 보조하도록 변경한다.

**Architecture:** `category-suggestion.ts`가 근거별 기본 점수와 후보별 합산 점수, 점수 차이 기반 충돌을 계산한다. `ai-classification-policy.ts`는 규칙 점수를 유지한 채 AI 일치·불일치만 가감하고, 서버 호출부는 실제 AI와 `RULE_ONLY` 기록을 구분한다.

**Tech Stack:** TypeScript 7, Vitest 4, React Router 8, Cloudflare Workers/D1

## Global Constraints

- UI, 데이터베이스 스키마·데이터, `category-taxonomy.ts`, 배포 설정은 변경하지 않는다.
- 점수는 항상 0~100 정수로 제한한다.
- 등급 경계는 `HIGH` 78~100, `MEDIUM` 50~77, `LOW` 0~49다.
- 충돌은 서로 다른 slug의 구체 `FOOD` 근거가 각각 65점 이상이고 점수 차이가 20점 이하일 때만 발생한다.
- AI 없음·실패는 규칙 점수와 등급을 낮추지 않으며 자동 승인할 수 없다.
- 실제 AI가 규칙과 다르면 규칙 slug를 유지한다.
- 원격 D1 migration, 실제 Workers AI 호출, 운영 배포를 실행하지 않는다.

---

### Task 1: 규칙 근거 점수와 충돌 판정

**Files:**
- Modify: `app/features/candidates/category-suggestion.ts`
- Test: `tests/unit/candidate-auto-classification.test.ts`

**Interfaces:**
- Consumes: `nameCategoryRules`, `subtypeCategoryRules`, `PublicDataSource`
- Produces: `CandidateClassification.confidenceScore: number`, `confidenceFromScore(score): "HIGH" | "MEDIUM" | "LOW"`

- [ ] **Step 1: 대표 입력과 점수 경계의 실패 테스트 작성**

```ts
it.each([
  ["사계순대", "한식", "tteokbokki"],
  ["전주해장국", "한식", "gukbap-detail"],
  ["스시하루", "한식", "sushi-sashimi"],
])("keeps a specific name signal for %s", (businessName, businessSubtype, categorySlug) => {
  const result = classifyCandidate({ sourceType: "GENERAL_RESTAURANT", businessName, businessSubtype });
  expect(result).toMatchObject({ categorySlug, confidence: "HIGH" });
  expect(result.confidenceScore).toBeGreaterThanOrEqual(78);
});

it("keeps similarly strong concrete food signals in conflict", () => {
  expect(classifyCandidate({
    sourceType: "GENERAL_RESTAURANT",
    businessSubtype: "한식",
    businessName: "타코야끼앤버거",
  })).toMatchObject({ confidence: "CONFLICT" });
});

it("keeps broad subtype and source-only evidence below high", () => {
  const result = classifyCandidate({ sourceType: "GENERAL_RESTAURANT", businessSubtype: "한식", businessName: "맛있는집" });
  expect(result).toMatchObject({ categorySlug: "home-meal", confidence: "LOW" });
  expect(result.confidenceScore).toBeLessThan(50);
});
```

- [ ] **Step 2: 대상 테스트가 현재 동작 때문에 실패하는지 확인**

Run: `pnpm test tests/unit/candidate-auto-classification.test.ts`

Expected: `스시하루 + 한식`이 `CONFLICT`, 구체 이름 단독이 `MEDIUM`, `confidenceScore`가 없어서 FAIL.

- [ ] **Step 3: 근거 기본 점수와 후보 합산 구현**

```ts
const BASE_SCORES: Record<SignalOrigin, Partial<Record<SignalKind, number>>> = {
  NAME: { FOOD: 80, VENUE: 74 },
  SUBTYPE: { FOOD: 65, VENUE: 45, CUISINE: 35 },
  SOURCE: { DEFAULT: 15 },
};

function priorityBonus(priority = 0) {
  return Math.min(10, Math.max(0, Math.round(priority / 4)));
}

export function confidenceFromScore(score: number) {
  if (score >= 78) return "HIGH" as const;
  if (score >= 50) return "MEDIUM" as const;
  return "LOW" as const;
}
```

후보별로 가장 강한 근거는 전부 반영하고, 같은 slug의 두 번째 이후 근거는 해당 기본 점수의 30%만 반영한다. 선택 후보와 같은 그룹의 다른 `SUBTYPE + CUISINE` 근거가 있으면 6점을 보조 가산하고 100점에서 제한한다.

- [ ] **Step 4: 구체 음식 근거만 사용하는 충돌 판정 구현**

```ts
const concreteFoodCandidates = rankSignals(
  signals.filter((signal) => signal.kind === "FOOD" && signal.origin !== "SOURCE"),
);
const hasConcreteConflict = concreteFoodCandidates.length > 1
  && concreteFoodCandidates[0].score >= 65
  && concreteFoodCandidates[1].score >= 65
  && concreteFoodCandidates[0].slug !== concreteFoodCandidates[1].slug
  && concreteFoodCandidates[0].score - concreteFoodCandidates[1].score <= 20;
```

최종 결과에 `confidenceScore`를 넣고, 충돌이 아니면 `confidenceFromScore`로 등급을 계산한다.

- [ ] **Step 5: 규칙 단위 테스트 통과 확인**

Run: `pnpm test tests/unit/candidate-auto-classification.test.ts tests/unit/category-suggestion.test.ts`

Expected: 두 파일의 모든 테스트 PASS.

- [ ] **Step 6: 규칙 점수 구현 커밋**

```bash
git add app/features/candidates/category-suggestion.ts tests/unit/candidate-auto-classification.test.ts
git commit -m "2026-08-08 분류 신뢰도 점수 및 충돌 판정 고도화"
```

### Task 2: AI 점수 보정 정책

**Files:**
- Modify: `app/features/candidates/ai-classification-policy.ts`
- Test: `tests/unit/ai-classification-policy.test.ts`

**Interfaces:**
- Consumes: `confidenceFromScore`, `ClassificationConfidence`, `AiClassification`
- Produces: `reconcileAiClassification({ ruleSlug, ruleConfidence, ruleScore, ai })` 결과의 `categorySlug`, `confidence`, `confidenceScore`, `eligible`, `reasons`

- [ ] **Step 1: AI 없음·일치·약한 불일치·강한 불일치 실패 테스트 작성**

```ts
expect(reconcileAiClassification({ ruleSlug: "ramen-detail", ruleConfidence: "HIGH", ruleScore: 82, ai: null }))
  .toMatchObject({ categorySlug: "ramen-detail", confidence: "HIGH", confidenceScore: 82, eligible: false });

expect(reconcileAiClassification({ ruleSlug: "ramen-detail", ruleConfidence: "MEDIUM", ruleScore: 70,
  ai: { categorySlug: "ramen-detail", confidence: 0.9, reasons: [] } }))
  .toMatchObject({ categorySlug: "ramen-detail", confidence: "HIGH", confidenceScore: 79, eligible: true });

expect(reconcileAiClassification({ ruleSlug: "ramen-detail", ruleConfidence: "HIGH", ruleScore: 82,
  ai: { categorySlug: "gukbap-detail", confidence: 0.7, reasons: [] } }))
  .toMatchObject({ categorySlug: "ramen-detail", confidence: "MEDIUM", confidenceScore: 72, eligible: false });

expect(reconcileAiClassification({ ruleSlug: "ramen-detail", ruleConfidence: "HIGH", ruleScore: 82,
  ai: { categorySlug: "gukbap-detail", confidence: 0.95, reasons: [] } }))
  .toMatchObject({ categorySlug: "ramen-detail", confidence: "CONFLICT", confidenceScore: 82, eligible: false });
```

- [ ] **Step 2: 대상 테스트의 기존 정책 실패 확인**

Run: `pnpm test tests/unit/ai-classification-policy.test.ts`

Expected: AI 없음이 `MEDIUM`으로 내려가고 불일치 때 AI slug로 교체되며 `confidenceScore`가 없어 FAIL.

- [ ] **Step 3: 점수 보정과 자동 승인 조건 구현**

```ts
const clampScore = (score: number) => Math.min(100, Math.max(0, Math.round(score)));

// AI 없음: 규칙 결과 그대로, eligible false
// AI 일치: round(ai.confidence * 10) 가산
// AI 불일치 + confidence < 0.85: 10점 감산, 규칙 slug 유지
// AI 불일치 + confidence >= 0.85: 규칙 slug 유지, CONFLICT
// 자동 승인: AI confidence >= 0.85, 보정 등급 HIGH, 규칙 자체가 CONFLICT가 아닐 때만 true
```

- [ ] **Step 4: AI 정책 단위 테스트 통과 확인**

Run: `pnpm test tests/unit/ai-classification-policy.test.ts`

Expected: 모든 AI 정책 테스트 PASS.

- [ ] **Step 5: AI 정책 구현 커밋**

```bash
git add app/features/candidates/ai-classification-policy.ts tests/unit/ai-classification-policy.test.ts
git commit -m "2026-08-08 AI 분류 점수 보정 정책 반영"
```

### Task 3: 서버 전달과 통합 회귀

**Files:**
- Modify: `app/features/candidates/bulk-review.server.ts`
- Modify: `app/features/candidates/ai-classification.server.ts`
- Test: `tests/integration/bulk-review.server.test.ts`
- Test: `tests/integration/ai-classification.server.test.ts`

**Interfaces:**
- Consumes: `CandidateClassification.confidenceScore`, `reconcileAiClassification(...ruleScore...)`
- Produces: 실제 AI만 `AI_RULE`, 예약 처리의 `RULE_ONLY`는 규칙 결과로 유지

- [ ] **Step 1: RULE_ONLY와 실제 AI를 구분하는 실패 통합 테스트 작성**

```ts
it("keeps a RULE_ONLY run manual without lowering the rule score", async () => {
  // HIGH 규칙 후보에 model: "RULE_ONLY" SUCCESS 기록을 추가한다.
  // listBulkReviewGroups 결과가 classificationSource RULE_ONLY,
  // confidence HIGH, eligible false인지 검증한다.
});

it("calls Workers AI for an explicitly selected high-confidence rule", async () => {
  // candidateIds가 전달된 HIGH 규칙 후보는 run을 1회 호출하고
  // 실제 모델의 SUCCESS 결과를 저장하는지 검증한다.
});
```

- [ ] **Step 2: 통합 테스트의 기존 동작 실패 확인**

Run: `pnpm test:integration tests/integration/bulk-review.server.test.ts tests/integration/ai-classification.server.test.ts`

Expected: `RULE_ONLY`가 실제 AI처럼 처리되고 명시 선택된 HIGH 규칙이 AI 호출을 건너뛰어 FAIL.

- [ ] **Step 3: 서버 호출부에 규칙 점수 전달 및 AI 출처 구분**

```ts
const isActualAiSuccess = aiRun?.status === "SUCCESS" && aiRun.model !== "RULE_ONLY";
if (isActualAiSuccess) {
  ai = validateAiClassification(/* 기존 검증 입력 */);
}
const combined = reconcileAiClassification({
  ruleSlug: classification.categorySlug,
  ruleConfidence: classification.confidence,
  ruleScore: classification.confidenceScore,
  ai,
});
```

`classificationSource`도 `isActualAiSuccess`일 때만 `AI_RULE`로 표시한다.

- [ ] **Step 4: 명시 선택 후보는 실제 AI 검증을 수행하도록 조정**

```ts
const mayCompleteByRuleOnly = !input.candidateIds?.length
  && rule.confidence === "HIGH"
  && terminalSlugs.has(rule.categorySlug);
```

예약 실행에서는 기존 `RULE_ONLY` 비용 절감 경로를 유지하고, 관리자에서 `candidateIds`를 명시한 실행은 실제 AI를 호출한다. AI payload에 `ruleConfidenceScore`를 추가한다.

- [ ] **Step 5: 통합 테스트 및 전체 회귀 검증**

Run: `pnpm test:integration tests/integration/bulk-review.server.test.ts tests/integration/ai-classification.server.test.ts`

Expected: 대상 통합 테스트 PASS.

Run: `pnpm test && pnpm test:integration && pnpm run typecheck && pnpm run build`

Expected: 모든 명령 exit code 0.

- [ ] **Step 6: 서버 통합 구현 커밋**

```bash
git add app/features/candidates/bulk-review.server.ts app/features/candidates/ai-classification.server.ts tests/integration/bulk-review.server.test.ts tests/integration/ai-classification.server.test.ts
git commit -m "2026-08-08 신뢰도 점수 서버 전달 및 AI 출처 구분"
```

### Task 4: PR 준비

**Files:**
- Modify: `docs/superpowers/plans/2026-08-08-confidence-scoring-v2.md` 체크 상태

**Interfaces:**
- Consumes: 전체 테스트·타입검사·빌드 결과
- Produces: 이슈 #54를 닫는 검토 가능한 Pull Request

- [ ] **Step 1: 최신 origin/main 반영 여부와 diff 검토**

Run: `git fetch origin && git merge --no-edit origin/main`

Expected: 충돌 없이 최신 main 반영.

Run: `git diff --check && git diff --stat origin/main...HEAD && git status --short`

Expected: whitespace 오류 없음, 범위 밖 파일 없음.

- [ ] **Step 2: 최종 검증 재실행**

Run: `pnpm test && pnpm test:integration && pnpm run typecheck && pnpm run build`

Expected: 모든 명령 exit code 0.

- [ ] **Step 3: 브랜치 push와 PR 생성**

```bash
git push -u origin tj_confidence-scoring-v2
gh pr create --base main --head tj_confidence-scoring-v2 --title "분류 신뢰도 점수 고도화" --body "Closes #54"
```

PR 본문에는 변경 범위, 검증 결과, 운영 영향, 남은 위험을 기록한다. 사람 리뷰 승인 전에는 병합하지 않고, 병합 전 필수 검사를 기다린다.
