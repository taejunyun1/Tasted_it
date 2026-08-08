# 경양식 돈가스 분류·승인 불가 탭 분리·DB 감사 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 경양식 후보를 돈가스로 추천하고 승인 불가 후보를 전용 탭으로 격리하며 운영 DB 무결성을 개인정보 없는 집계로 확인한다.

**Architecture:** 기존 카테고리 신호 점수 체계에 `경양식` 전용 원천 업태 규칙을 추가하고, 관리자 loader에서 일반 검수 집합과 승인 불가 집합을 명시적으로 분리한다. DB 구조와 운영 데이터는 변경하지 않으며 재사용 가능한 읽기 전용 SQL로 무결성 집계를 기록한다.

**Tech Stack:** TypeScript, React Router, Cloudflare D1, Vitest, Playwright, pnpm, Wrangler

## Global Constraints

- `tj_review-queue-donkatsu-audit` 브랜치와 전용 worktree에서만 작업한다.
- 기능 변경은 실패 테스트를 먼저 확인한다.
- `경양식`만 돈가스로 보내고 일반 `양식`은 파스타를 유지한다.
- 상호명의 구체 음식 신호는 업태 기본값보다 우선한다.
- `BLOCKED`는 일반 `전체`, `분류 완료`, `수동 확인`에서 표시하지 않는다.
- 운영 DB 감사는 읽기 전용이며 상호명·주소·전화번호·이메일·원본 payload를 출력하지 않는다.
- 운영 데이터 오류가 발견되어도 이번 작업에서 수정하지 않는다.

---

### Task 1: 경양식 돈가스 분류

**Files:**
- Modify: `app/features/candidates/category-taxonomy.ts`
- Modify: `tests/unit/category-suggestion.test.ts`

**Interfaces:**
- Consumes: `classifyCandidate(input): CandidateClassification`
- Produces: `subtypeCategoryRules`의 `경양식 → donkatsu-detail` 규칙

- [ ] **Step 1: 실패 테스트 작성**

```ts
it("maps only the 경양식 subtype to donkatsu", () => {
  expect(classifyCandidate({ sourceType: "GENERAL_RESTAURANT", businessSubtype: "경양식", businessName: "동명식당" }).categorySlug)
    .toBe("donkatsu-detail");
  expect(classifyCandidate({ sourceType: "GENERAL_RESTAURANT", businessSubtype: "양식", businessName: "동명식당" }).categorySlug)
    .toBe("pasta");
});

it("keeps a concrete western food name above the 경양식 default", () => {
  expect(classifyCandidate({ sourceType: "GENERAL_RESTAURANT", businessSubtype: "경양식", businessName: "동명파스타" }).categorySlug)
    .toBe("pasta");
});
```

- [ ] **Step 2: 실패 확인**

Run: `pnpm vitest run tests/unit/category-suggestion.test.ts`

Expected: `경양식` 결과가 현재 `pasta`여서 FAIL.

- [ ] **Step 3: 최소 규칙 구현**

`subtypeCategoryRules`에서 광범위 규칙보다 앞에 다음 규칙을 추가하고 기존 규칙은 `/양식/`만 처리한다.

```ts
{ pattern: /경양식/, group: "japanese", slug: "donkatsu-detail", label: "원천 업태의 경양식 표현", kind: "CUISINE" },
{ pattern: /양식/, group: "western", slug: "pasta", label: "원천 업태의 양식 표현", kind: "CUISINE", excludePattern: /경양식/ },
```

- [ ] **Step 4: 집중 테스트 확인**

Run: `pnpm vitest run tests/unit/category-suggestion.test.ts`

Expected: 전체 PASS.

- [ ] **Step 5: 커밋**

```bash
git add app/features/candidates/category-taxonomy.ts tests/unit/category-suggestion.test.ts
git commit -m "2026-08-08 경양식 돈가스 분류 추가"
```

### Task 2: 승인 불가 후보 전용 탭 격리

**Files:**
- Modify: `app/routes/admin-candidates.tsx`
- Modify: `tests/e2e/admin-candidate-review.spec.ts`

**Interfaces:**
- Consumes: `reviewState: "AUTO" | "MANUAL" | "BLOCKED"`
- Produces: 일반 집합 `reviewableRows`, 전용 집합 `blockedRows`, `counts.ALL`의 승인 가능 후보 수

- [ ] **Step 1: 실패 E2E 작성**

기존 첫 E2E에서 기본 페이지의 차단 후보 기대를 제거하고 아래 검증을 추가한다.

```ts
await expect(page.getByRole("heading", { name: "QA 카페봄" })).toHaveCount(0);
await expect(page.getByRole("heading", { name: "Re:Taste 샘플 라멘 동명" })).toHaveCount(0);

await page.getByRole("link", { name: "승인 불가·예외" }).click();
await expect(page.getByRole("heading", { name: "QA 카페봄" })).toBeVisible();
await expect(page.getByText("좌표 확인 필요")).toBeVisible();
await expect(page.getByRole("heading", { name: "Re:Taste 샘플 라멘 동명" })).toBeVisible();
await expect(page.getByText("기존 공개 장소와 중복")).toBeVisible();
```

- [ ] **Step 2: 실패 확인**

Run: `pnpm exec playwright test tests/e2e/admin-candidate-review.spec.ts --project=chromium`

Expected: 기본 전체에 두 차단 후보가 남아 FAIL.

- [ ] **Step 3: loader 집합 분리**

```ts
const blockedRows = allRows.filter((row) => row.reviewState === "BLOCKED");
const reviewableRows = allRows.filter((row) => row.reviewState !== "BLOCKED");
const filteredRows = reviewableRows.filter((row) =>
  (!states.includes(requestedState as (typeof states)[number]) || row.reviewState === requestedState)
  && (!categoryId || row.categoryId === categoryId)
  && (!confidence || row.confidence === confidence));
```

`counts.ALL`, `counts.AUTO`, `counts.MANUAL`은 `reviewableRows`로 계산하고 `counts.EXCEPTION`은 `blockedRows + exceptionRows`를 유지한다.

- [ ] **Step 4: 데스크톱·모바일 E2E 확인**

Run: `pnpm exec playwright test tests/e2e/admin-candidate-review.spec.ts --project=chromium --project=mobile-chromium`

Expected: 전체 PASS.

- [ ] **Step 5: 화면 증거 저장과 커밋**

`output/playwright/reviewable-queue-desktop.png`와 `output/playwright/exceptions-mobile.png`를 저장한다.

```bash
git add app/routes/admin-candidates.tsx tests/e2e/admin-candidate-review.spec.ts output/playwright/reviewable-queue-desktop.png output/playwright/exceptions-mobile.png
git commit -m "2026-08-08 승인 불가 후보 전용 탭 격리"
```

### Task 3: 운영 DB 무결성 읽기 전용 감사

**Files:**
- Create: `scripts/audit-db-integrity.sql`
- Create: `docs/db-integrity-audit-2026-08-08.md`

**Interfaces:**
- Produces: 개인정보 없는 단일 집계 결과와 운영 감사 보고서

- [ ] **Step 1: 감사 SQL 작성**

`scripts/audit-db-integrity.sql`은 여러 행의 `metric`, `value`만 반환한다. 필수 쿼리 형태는 다음과 같다.

```sql
SELECT 'foreign_key_violations' AS metric, count(*) AS value FROM pragma_foreign_key_check
UNION ALL
SELECT 'duplicate_source_keys', count(*) FROM (
  SELECT source_type, source_management_no FROM business_licenses
  GROUP BY source_type, source_management_no HAVING count(*) > 1
)
UNION ALL
SELECT 'open_pending_missing_coordinates', count(*) FROM business_licenses
WHERE normalized_status = 'OPEN' AND review_status = 'PENDING'
  AND (latitude IS NULL OR longitude IS NULL)
UNION ALL
SELECT 'active_exclusion_approved_conflicts', count(*)
FROM business_license_exclusions e JOIN business_licenses b ON b.id = e.business_license_id
WHERE e.status = 'ACTIVE' AND b.review_status = 'APPROVED';
```

같은 UNION에 좌표 범위, 승인-장소 링크, 카테고리 고아·비활성·비말단 연결, 제외 사유별 활성 건수, AI 분류 성공·실패 건수를 추가한다.

- [ ] **Step 2: SQL 안전성 검사**

Run: `rg -n "business_name|road_address|lot_address|phone|email|raw_payload|UPDATE|INSERT|DELETE|ALTER|DROP" scripts/audit-db-integrity.sql`

Expected: 결과 없음.

- [ ] **Step 3: 운영 읽기 전용 감사 실행**

Run: `pnpm exec wrangler d1 execute DB --remote --command "$(<scripts/audit-db-integrity.sql)"`

Expected: `rows_written = 0`, 집계 metric과 value만 출력.

- [ ] **Step 4: 결과 문서화**

`docs/db-integrity-audit-2026-08-08.md`에 실행 시각, migration 상태, metric별 건수, 판정과 별도 수정 필요 항목을 기록한다. 실제 상호명과 주소는 기록하지 않는다.

- [ ] **Step 5: 전체 검증**

Run:

```bash
pnpm test
pnpm test:integration
pnpm run typecheck
pnpm run build
git diff --check
```

Expected: 모두 exit 0.

- [ ] **Step 6: 커밋**

```bash
git add scripts/audit-db-integrity.sql docs/db-integrity-audit-2026-08-08.md
git commit -m "2026-08-08 운영 DB 무결성 감사 추가"
```

### Task 4: PR과 배포 준비

**Files:**
- Modify: GitHub issue #52 and PR body

**Interfaces:**
- Consumes: Task 1~3 검증 결과
- Produces: `main` 대상 PR, 승인 후 배포 가능한 브랜치

- [ ] **Step 1: 최신 origin/main 반영 확인**

Run: `git fetch origin main && git rev-list --left-right --count HEAD...origin/main`

Expected: 오른쪽 값 0. 값이 있으면 변경을 보존하며 origin/main을 반영하고 전체 검증을 다시 실행한다.

- [ ] **Step 2: push와 PR 생성**

PR에는 변경 범위, 테스트 수, DB 감사 결과, 운영 데이터 쓰기 0건, UI 증거, 남은 위험을 기록한다.

- [ ] **Step 3: 사람 승인 대기**

독립적인 사람의 승인 전에는 merge하거나 배포하지 않는다. 긴급 핫픽스로 별도 명시된 경우에만 저장소의 긴급 절차를 따른다.
