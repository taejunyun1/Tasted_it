# 문맥형 전체 카테고리 분류 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 상호명과 업태의 문맥형 키워드 사전으로 전체 음식 카테고리를 촘촘하게 추천하고, 유효한 추천을 관리자 선택값에 자동 연결하며, 기존 체인점과 정상 AI 응답의 실패를 해소한다.

**Architecture:** 순수 데이터 모듈 `category-taxonomy.ts`에 카테고리별 포함·제외·우선순위 규칙을 두고 기존 점수 기반 분류기가 이를 소비한다. 체인점은 모든 분류보다 먼저 별도 정책으로 제외하며, AI는 규칙 후보 안에서만 보조하고 원문과 일치한 근거만 남긴다. 운영 변경 전에는 동일한 순수 분류기로 전체 후보를 집계하는 읽기 전용 감사를 수행한다.

**Tech Stack:** TypeScript, React Router, Drizzle ORM, Cloudflare Workers AI, Cloudflare D1, Vitest, Playwright, pnpm

## Global Constraints

- `main`에 직접 개발하지 않고 `tj_classification-taxonomy` 브랜치에서 작업한다.
- 모든 동작 변경은 실패하는 Vitest 테스트를 먼저 확인한다.
- 체인점 제외가 일반 음식 분류보다 먼저 적용된다.
- 관리자가 복원한 `OVERRIDDEN` 체인점은 다시 제외하지 않는다.
- AI 근거가 하나 이상 원문과 일치하면 일치한 근거만 사용하고, 모두 불일치하면 실패한다.
- AI 결과는 자동 공개가 아니라 대표 카테고리 추천에만 사용한다.
- 운영 데이터 감사 결과에는 상호명 전체 목록이나 개인정보를 저장하지 않는다.
- 패키지 의존성을 추가하지 않고 `pnpm`만 사용한다.

---

### Task 1: 문맥형 키워드 사전과 전체 카테고리 규칙

**Files:**
- Create: `app/features/candidates/category-taxonomy.ts`
- Modify: `app/features/candidates/category-suggestion.ts`
- Modify: `tests/unit/category-suggestion.test.ts`

**Interfaces:**
- Produces: `CategoryRule`, `nameCategoryRules`, `subtypeCategoryRules`
- Consumes: `classifyCandidate({ sourceType, businessSubtype, businessName, address })`

- [ ] **Step 1: 카테고리별 대표·충돌·오탐 회귀 테스트 작성**

`tests/unit/category-suggestion.test.ts`에 `it.each` 표를 추가한다. 최소 입력은 다음을 포함한다.

```ts
it.each([
  ["남도순대국", "gukbap-detail"],
  ["담양떡갈비", "grill"],
  ["바다아구찜", "seafood-dish"],
  ["연어연구소", "seafood-dish"],
  ["멘야하루", "ramen-detail"],
  ["마라공방", "mala-hotpot"],
  ["오월브런치", "brunch"],
  ["시장순대분식", "tteokbokki"],
  ["서울닭강정", "chicken"],
  ["사이공쌀국수", "vietnamese"],
  ["오늘베이킹", "bakery-detail"],
  ["추억의과자", "bakery-detail"],
  ["달빛빙수", "ice-dessert"],
  ["7080음악주점", "pub"],
  ["초록비건", "vegan"],
])("classifies %s as %s", (businessName, expected) => {
  expect(classifyCandidate({ sourceType: "GENERAL_RESTAURANT", businessName }).categorySlug).toBe(expected);
});

it.each(["사과농장", "망고상회", "딸기마켓", "자연어린이집"]) (
  "does not infer a food category from ambiguous name %s",
  (businessName) => expect(classifyCandidate({ sourceType: "GENERAL_RESTAURANT", businessName }).confidence).toBe("LOW"),
);
```

- [ ] **Step 2: 실패를 확인**

Run: `pnpm vitest run tests/unit/category-suggestion.test.ts`

Expected: `오늘베이킹`, `추억의과자`, 새 메뉴 별칭 중 기존 사전에 없는 사례가 기대 slug와 달라 FAIL.

- [ ] **Step 3: 규칙 데이터 모듈 작성**

`category-taxonomy.ts`에 다음 공개 타입과 배열을 만든다.

```ts
export type CategoryGroup = "korean" | "seafood" | "japanese" | "chinese" | "western" | "bunsik" | "chicken" | "world" | "cafe" | "bar" | "healthy" | "other";
export type SignalKind = "FOOD" | "CUISINE" | "VENUE" | "DEFAULT";
export type CategoryRule = {
  pattern: RegExp;
  slug: string;
  group: CategoryGroup;
  label: string;
  kind: SignalKind;
  priority?: number;
  excludePattern?: RegExp;
};

export const nameCategoryRules: CategoryRule[] = [
  { pattern: /해장국|순대국|돼지국밥|국밥|설렁탕|곰탕/, slug: "gukbap-detail", group: "korean", label: "상호의 국밥·해장국·탕반 표현", kind: "FOOD" },
  { pattern: /베이킹|베이커리|제과|제빵|과자(?:점)?|꽈배기|브레드|브래드|빵집|바게뜨|바게트|식빵|케이크|도넛|도너츠|크루아상|쿠키/, slug: "bakery-detail", group: "cafe", label: "상호의 제과·제빵·베이커리 표현", kind: "FOOD" },
];
```

기존 모든 `nameRules`, `subtypeRules`를 이 모듈로 옮기고 설계 문서 4.2의 별칭을 카테고리별 항목에 추가한다. `category-suggestion.ts`에서는 두 배열을 import하고 `excludePattern`이 이름 또는 업태와 일치하지 않는 규칙만 신호로 수집한다.

- [ ] **Step 4: 집중 테스트 통과 확인**

Run: `pnpm vitest run tests/unit/category-suggestion.test.ts`

Expected: 모든 표 기반 분류와 오탐 방지 테스트 PASS.

- [ ] **Step 5: 첫 구현 커밋**

```bash
git add app/features/candidates/category-taxonomy.ts app/features/candidates/category-suggestion.ts tests/unit/category-suggestion.test.ts
git commit -m "2026-08-08 문맥형 전체 카테고리 키워드 확장"
```

### Task 2: AI의 부분 유효 근거 인정

**Files:**
- Modify: `app/features/candidates/ai-classification-policy.ts`
- Modify: `tests/unit/ai-classification-policy.test.ts`

**Interfaces:**
- Consumes: `validateGroundedAiClassification(raw, allowedSlugs, evidenceText)`
- Produces: 검증 후 원문과 일치한 `evidence`만 포함한 `AiClassification`

- [ ] **Step 1: 혼합 근거 성공 테스트 작성**

```ts
it("keeps grounded evidence and drops invented evidence", () => {
  expect(validateGroundedAiClassification({
    categorySlug: "bakery-detail",
    confidence: 0.94,
    evidence: ["꽈배기", "베이커리"],
    reasons: ["꽈배기 전문점"],
  }, new Set(["bakery-detail"]), "다시마 꽈배기 제과점영업")).toMatchObject({
    categorySlug: "bakery-detail",
    evidence: ["꽈배기"],
  });
});

it("rejects when every evidence token is invented", () => {
  expect(() => validateGroundedAiClassification({
    categorySlug: "bakery-detail", confidence: 0.9, evidence: ["도넛"], reasons: [],
  }, new Set(["bakery-detail"]), "다시마 꽈배기 제과점영업")).toThrow("AI_EVIDENCE_UNGROUNDED");
});
```

- [ ] **Step 2: 기존의 `every` 검증 때문에 혼합 근거 테스트가 실패하는지 확인**

Run: `pnpm vitest run tests/unit/ai-classification-policy.test.ts`

Expected: 첫 테스트가 `AI_EVIDENCE_UNGROUNDED`로 FAIL, 두 번째 테스트는 PASS.

- [ ] **Step 3: 원문과 일치한 근거만 반환**

```ts
const groundedEvidence = parsed.evidence.filter((token) => {
  const normalizedToken = normalizeEvidence(token);
  return normalizedToken.length >= 2 && normalizedSource.includes(normalizedToken);
});
if (!groundedEvidence.length) throw new Error("AI_EVIDENCE_UNGROUNDED");
return { ...parsed, evidence: groundedEvidence };
```

- [ ] **Step 4: 정책과 AI 서버 단위 테스트 확인**

Run: `pnpm vitest run tests/unit/ai-classification-policy.test.ts tests/unit/ai-classification-server.test.ts`

Expected: 두 파일 모두 PASS.

- [ ] **Step 5: AI 정책 커밋**

```bash
git add app/features/candidates/ai-classification-policy.ts tests/unit/ai-classification-policy.test.ts
git commit -m "2026-08-08 AI 유효 분류 근거 부분 인정"
```

### Task 3: 기존 체인점 재분류와 복원 예외 보존

**Files:**
- Modify: `app/features/candidates/chain-store-policy.ts`
- Create: `drizzle/0011_backfill_chain_store_exclusions.sql`
- Modify: `tests/unit/chain-store-policy.test.ts`
- Modify: `tests/unit/candidate-server.test.ts`

**Interfaces:**
- Consumes: `matchChainStore(name)`
- Produces: 기존 `OPEN`·`PENDING` 체인점의 `ACTIVE` 제외 기록

- [ ] **Step 1: 지점명이 붙은 체인 판정과 복원 보존 테스트 작성**

```ts
it.each(["뚜레쥬르 여수무선점", "뚜레쥬르광주첨단점", "파리바게뜨 중흥점"])(
  "matches chain branch name %s",
  (name) => expect(matchChainStore(name)?.chainName).toBeTruthy(),
);
```

후보 서버 테스트에는 기존 `OVERRIDDEN` 제외 행을 가진 체인점을 다시 upsert해도 상태가 `OVERRIDDEN`으로 남는 기대를 추가한다.

- [ ] **Step 2: 현재 운영 잔존 사례를 재현하는 테스트 실패 확인**

Run: `pnpm vitest run tests/unit/chain-store-policy.test.ts tests/unit/candidate-server.test.ts`

Expected: 미지원 표기 변형 또는 기존 행 재분류 기대가 FAIL.

- [ ] **Step 3: 명시적 체인 별칭 보강 및 backfill migration 작성**

`0011_backfill_chain_store_exclusions.sql`은 `INSERT OR IGNORE ... SELECT`로 `business_licenses` 중 `normalized_status='OPEN'`, `review_status='PENDING'`이며 정규화한 상호가 파리바게뜨·뚜레쥬르 별칭을 포함하는 행만 등록한다. 이미 PK가 존재하는 `OVERRIDDEN` 행은 `OR IGNORE`로 보존한다.

```sql
INSERT OR IGNORE INTO business_license_exclusions(
  business_license_id, reason, matched_rule, chain_name, matched_term,
  status, excluded_at, created_at, updated_at
)
SELECT id, 'CHAIN_STORE', 'EXPLICIT_CHAIN_NAME',
  CASE WHEN replace(business_name, ' ', '') LIKE '%뚜레쥬르%' THEN '뚜레쥬르' ELSE '파리바게뜨' END,
  CASE WHEN replace(business_name, ' ', '') LIKE '%뚜레쥬르%' THEN '뚜레쥬르' ELSE '파리바게뜨' END,
  'ACTIVE', datetime('now'), datetime('now'), datetime('now')
FROM business_licenses
WHERE normalized_status = 'OPEN' AND review_status = 'PENDING'
  AND (replace(business_name, ' ', '') LIKE '%뚜레쥬르%' OR replace(business_name, ' ', '') LIKE '%파리바게%');
```

- [ ] **Step 4: 체인 관련 테스트와 로컬 migration 확인**

Run: `pnpm vitest run tests/unit/chain-store-policy.test.ts tests/unit/candidate-server.test.ts && pnpm run db:migrate:local`

Expected: 테스트 PASS, `0011_backfill_chain_store_exclusions.sql` 적용 성공.

- [ ] **Step 5: 체인 재분류 커밋**

```bash
git add app/features/candidates/chain-store-policy.ts drizzle/0011_backfill_chain_store_exclusions.sql tests/unit/chain-store-policy.test.ts tests/unit/candidate-server.test.ts
git commit -m "2026-08-08 기존 체인점 제외 목록 재분류"
```

### Task 4: 추천 카테고리 자동 선택 불변식

**Files:**
- Modify: `tests/unit/category-selection.test.ts`
- Modify: `tests/e2e/admin-candidate-review.spec.ts`
- Modify only if failing: `app/routes/admin-candidates.tsx`

**Interfaces:**
- Consumes: loader row의 `categoryId`
- Produces: `chosenCategories[candidateId]` 초기값과 선택창 value의 동일성

- [ ] **Step 1: 베이커리 추천값이 선택창에 반영되는 브라우저 테스트 작성**

QA seed의 비체인 후보를 `오늘베이킹`으로 추가하거나 변경하고 다음 기대를 작성한다.

```ts
const bakerySelect = page.getByLabel("오늘베이킹 대표 카테고리");
await expect(bakerySelect).toHaveValue("cat-bakery-detail");
await expect(page.getByText("추천 · 베이커리")).toBeVisible();
```

- [ ] **Step 2: 브라우저 테스트를 실행해 데이터 연결 실패 여부 확인**

Run: `pnpm exec playwright test tests/e2e/admin-candidate-review.spec.ts --project=chromium`

Expected: 새 QA 후보나 선택값 연결이 없으면 FAIL.

- [ ] **Step 3: 필요한 최소 UI 초기화 수정**

loaderData가 바뀔 때 모든 행의 추천 category ID를 선택 상태로 다시 구성한다.

```ts
useEffect(() => {
  setChosenCategories(Object.fromEntries(loaderData.rows.map((row) => [row.id, row.categoryId ?? ""])));
}, [loaderData.rows]);
```

기존 구현이 이미 동일 동작을 하면 제품 코드는 변경하지 않고 회귀 테스트만 커밋한다.

- [ ] **Step 4: 단위·브라우저 테스트 통과 확인**

Run: `pnpm vitest run tests/unit/category-selection.test.ts && pnpm exec playwright test tests/e2e/admin-candidate-review.spec.ts --project=chromium`

Expected: 추천 베이커리가 자동 선택되고 체인점은 일반 검수 목록에 없음.

- [ ] **Step 5: 자동 선택 회귀 테스트 커밋**

```bash
git add app/routes/admin-candidates.tsx tests/unit/category-selection.test.ts tests/e2e/admin-candidate-review.spec.ts scripts/seed-admin-qa.sql
git commit -m "2026-08-08 추천 카테고리 자동 선택 검증"
```

### Task 5: 전체 후보 분류 감사와 최종 검증

**Files:**
- Create: `app/features/candidates/classification-audit.ts`
- Create: `tests/unit/classification-audit.test.ts`
- Create: `docs/category-classification-audit-2026-08-08.md`
- Modify: GitHub issue #48 and PR description

**Interfaces:**
- Produces: `auditClassifications(rows, activeSlugs)`의 총계·slug별·신뢰도별·불일치 집계

- [ ] **Step 1: 개인정보 없는 집계 테스트 작성**

```ts
expect(auditClassifications(rows, new Set(["bakery-detail", "seafood-dish"]))).toEqual({
  total: 3,
  byCategory: { "bakery-detail": 1, "seafood-dish": 1, "home-meal": 1 },
  byConfidence: { HIGH: 1, MEDIUM: 1, LOW: 1, CONFLICT: 0 },
  unknownCategoryCount: 1,
  lowOrConflictCount: 1,
});
```

- [ ] **Step 2: 구현 전 실패 확인**

Run: `pnpm vitest run tests/unit/classification-audit.test.ts`

Expected: 모듈이 없어 FAIL.

- [ ] **Step 3: 순수 집계 함수 구현**

`classification-audit.ts`는 상호명이나 주소를 반환하지 않고 숫자 집계만 반환한다. 운영 D1에서는 후보의 분류 입력만 읽고 로컬에서 이 함수를 적용한다.

- [ ] **Step 4: 운영 데이터 읽기 전용 감사와 문서화**

운영 변경 전 다음 읽기 전용 조회로 `OPEN`·`PENDING` 후보의 상호명, 업태, source type만 일시적으로 확인한다. 결과 파일을 커밋하지 않고 동일 입력을 감사 함수에 전달해 집계만 `docs/category-classification-audit-2026-08-08.md`에 기록한다. `LOW`, `CONFLICT`, unknown category, 일반 큐의 체인점 잔존 건수를 포함한다.

```bash
pnpm exec wrangler d1 execute DB --remote --command "SELECT source_type, business_subtype, business_name FROM business_licenses WHERE normalized_status='OPEN' AND review_status='PENDING';"
```

- [ ] **Step 5: 전체 검증 실행**

Run:

```bash
pnpm test
pnpm test:integration
pnpm run typecheck
pnpm run build
git diff --check
```

Expected: 모든 명령 exit 0. Vitest 종료 경고가 있더라도 테스트 실패가 없어야 한다.

- [ ] **Step 6: 감사 및 최종 구현 커밋**

```bash
git add app/features/candidates/classification-audit.ts tests/unit/classification-audit.test.ts docs/category-classification-audit-2026-08-08.md
git commit -m "2026-08-08 전체 후보 카테고리 분류 감사"
```

- [ ] **Step 7: 브랜치 push와 PR 생성**

```bash
git push -u origin tj_classification-taxonomy
gh pr create --base main --head tj_classification-taxonomy --title "문맥형 전체 카테고리 분류 정확도 개선" --body $'Closes #48\n\n## 범위\n- 문맥형 전체 음식 카테고리 사전\n- AI 부분 유효 근거 인정\n- 기존 체인점 제외 재분류\n- 추천 카테고리 자동 선택 검증\n\n## 검증\n- pnpm test\n- pnpm test:integration\n- pnpm run typecheck\n- pnpm run build\n\n## 운영 영향\n- 신규 D1 migration 0011 적용 필요\n- 분류 감사 결과는 docs/category-classification-audit-2026-08-08.md 참고'
```

PR에는 이슈 #48, 변경 범위, 테스트 결과, migration `0011`, 운영 분류 이동 규모, 남은 오탐 위험을 기록한다. 사람 승인을 받은 뒤에만 병합하고 운영 D1 migration 및 배포를 진행한다.
