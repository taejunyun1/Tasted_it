# 프랜차이즈 MVP 필터와 승인 불가·예외 관리 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 전국·광역 프랜차이즈와 룸살롱·유흥주점 후보를 안전하게 제외하고, 관리자가 선택 후보를 사유와 함께 예외 처리하거나 복원할 수 있게 한다.

**Architecture:** JSON 기반 blacklist·allowlist를 순수 분류기가 exact/prefix/alias 규칙으로 평가하고 `business_license_exclusions`에 판정 근거를 저장한다. 제외 테이블은 체인·유흥업종·관리자 예외를 함께 기록하도록 새 migration에서 확장한다. 관리자 목록은 체인 제외와 승인 불가·예외를 분리해 보여주며 기존 기술적 차단 후보도 승인 불가·예외 탭에 합친다.

**Tech Stack:** TypeScript, React Router, Drizzle ORM, Cloudflare D1, JSON, Vitest, Playwright, pnpm

## Global Constraints

- `tj_exclusion-franchise-mvp` 브랜치에서만 개발한다.
- 동작 변경은 실패 테스트를 먼저 확인한다.
- allowlist가 blacklist보다 우선한다.
- 자동 제외는 신뢰도 0.90 이상 `NATIONAL_CHAIN`·`REGIONAL_CHAIN`만 허용한다.
- 짧은 브랜드 contains와 fuzzy matching을 사용하지 않는다.
- 단란주점은 자동 제외하지 않는다.
- `OVERRIDDEN` 제외 기록은 자동 정책이 다시 덮어쓰지 않는다.
- 원본 `business_licenses.raw_payload`는 수정하지 않는다.
- 관리자 일괄 예외 처리는 최대 25곳이다.
- 공정위 API 연동은 이번 범위에서 제외한다.

---

### Task 1: JSON 프랜차이즈 정책과 순수 판정기

**Files:**
- Create: `data/franchise-manual-blacklist.json`
- Create: `data/franchise-local-allowlist.json`
- Modify: `app/features/candidates/chain-store-policy.ts`
- Modify: `tests/unit/chain-store-policy.test.ts`

**Interfaces:**
- Produces: `classifyChainStore(name): ChainClassification`, `normalizeChainStoreName(name)`, `stripBranchSuffix(name)`
- `ChainClassification`: `chainStatus`, `chainId`, `chainName`, `matchedTerm`, `matchMethod`, `confidence`

- [ ] **Step 1: exact·prefix·alias·allowlist·짧은 이름 실패 테스트 작성**

```ts
expect(classifyChainStore("스타벅스 광주봉선DT점")).toMatchObject({ chainStatus: "NATIONAL_CHAIN", matchMethod: "BRAND_PREFIX", confidence: 0.95 });
expect(classifyChainStore("메가커피 충장점")).toMatchObject({ chainName: "메가MGC커피", matchMethod: "ALIAS_PREFIX", confidence: 0.9 });
expect(classifyChainStore("동네설빙연구소")).toBeNull();
expect(classifyChainStore("광주로컬허용점")).toMatchObject({ chainStatus: "LOCAL_CHAIN", confidence: 1 });
```

- [ ] **Step 2: 실패 확인**

Run: `pnpm vitest run tests/unit/chain-store-policy.test.ts`

Expected: 새 함수와 데이터가 없어 FAIL.

- [ ] **Step 3: 첨부 명세 초기 blacklist 전체와 주요 alias를 JSON에 작성**

햄버거, 커피, 치킨, 피자, 분식, 김밥, 중식, 도시락, 고기, 족발, 샤브샤브, 패밀리레스토랑, 베이커리·빙과, 주점 그룹의 모든 브랜드를 객체 항목으로 작성한다. `franchise-local-allowlist.json`에는 테스트용 `광주로컬허용` 항목을 두고 운영자가 추가할 수 있는 구조를 고정한다.

- [ ] **Step 4: 순수 판정기 구현**

정규화 → allowlist exact/prefix → blacklist 공식명 exact/prefix → alias exact/prefix → 길이 4 이상 contains 순으로 평가한다. 0.75 contains는 결과를 반환하되 `matchChainStore` 호환 함수는 0.90 이상만 반환한다.

- [ ] **Step 5: 집중 테스트와 JSON 파싱 확인**

Run: `pnpm vitest run tests/unit/chain-store-policy.test.ts`

Expected: 전체 PASS.

- [ ] **Step 6: 커밋**

```bash
git add data/franchise-manual-blacklist.json data/franchise-local-allowlist.json app/features/candidates/chain-store-policy.ts tests/unit/chain-store-policy.test.ts
git commit -m "2026-08-08 프랜차이즈 MVP 판정 정책 추가"
```

### Task 2: 범용 제외 스키마와 자동 업종·체인 제외

**Files:**
- Create: `app/features/candidates/exclusion-policy.ts`
- Modify: `app/db/schema.ts`
- Modify: `app/features/candidates/candidate.server.ts`
- Create: `drizzle/0013_expand_candidate_exclusions.sql`
- Modify: `tests/integration/candidate.server.test.ts`
- Create: `tests/unit/exclusion-policy.test.ts`

**Interfaces:**
- Produces: `classifyAutomaticExclusion({ businessName, businessSubtype }): AutomaticExclusion | null`
- Produces: 확장된 `businessLicenseExclusions` 행과 `listExcludedCandidates(db, filters, reasons?)`

- [ ] **Step 1: 룸살롱·유흥주점과 단란주점 회귀 테스트 작성**

```ts
expect(classifyAutomaticExclusion({ businessName: "황제 룸싸롱", businessSubtype: "유흥주점영업" })).toMatchObject({ reason: "ADULT_ENTERTAINMENT" });
expect(classifyAutomaticExclusion({ businessName: "동네 단란주점", businessSubtype: "단란주점영업" })).toBeNull();
```

통합 테스트는 스타벅스·룸살롱 upsert가 일반 큐에서 빠지고, 복원 후 resync해도 `OVERRIDDEN`으로 남는지 검증한다.

- [ ] **Step 2: 실패 확인**

Run: `pnpm vitest run tests/unit/exclusion-policy.test.ts && pnpm vitest run --config vitest.workers.config.ts tests/integration/candidate.server.test.ts`

Expected: 새 정책·스키마가 없어 FAIL.

- [ ] **Step 3: 0013 migration 작성**

기존 테이블을 `business_license_exclusions_legacy`로 이름 변경하고 범용 nullable 열을 가진 새 테이블을 만든 뒤 기존 체인 행을 복사하고 legacy 테이블을 삭제한다. 이어 `OPEN`·`PENDING` 룸살롱·룸싸롱·유흥주점과 JSON blacklist의 정규화 prefix 값으로 기존 후보를 backfill한다.

- [ ] **Step 4: Drizzle schema와 자동 정책 구현**

reason enum을 `CHAIN_STORE | ADULT_ENTERTAINMENT | ADMIN_EXCEPTION`으로 확장하고 `exclusionCategory`, `matchedBrand`, `matchedAlias`, `chainScope`, `matchMethod`, `matchConfidence`, `note`, `excludedBy`를 nullable 열로 추가한다. `upsertBusinessLicense`는 업종 정책을 먼저, 고신뢰 체인 정책을 다음으로 적용하고 기존 `OVERRIDDEN`을 보존한다.

- [ ] **Step 5: 단위·통합·로컬 migration 검증**

Run: `pnpm vitest run tests/unit/exclusion-policy.test.ts tests/unit/chain-store-policy.test.ts && pnpm vitest run --config vitest.workers.config.ts tests/integration/candidate.server.test.ts && pnpm run db:migrate:local`

Expected: 모두 PASS, 0013 적용 성공.

- [ ] **Step 6: 커밋**

```bash
git add app/features/candidates/exclusion-policy.ts app/db/schema.ts app/features/candidates/candidate.server.ts drizzle/0013_expand_candidate_exclusions.sql tests/unit/exclusion-policy.test.ts tests/integration/candidate.server.test.ts
git commit -m "2026-08-08 유흥업종 및 범용 후보 제외 추가"
```

### Task 3: 관리자 수동 예외 서비스

**Files:**
- Modify: `app/features/candidates/candidate.server.ts`
- Create: `app/features/candidates/manual-exclusion.ts`
- Create: `tests/unit/manual-exclusion.test.ts`
- Modify: `tests/integration/candidate.server.test.ts`

**Interfaces:**
- Produces: `validateManualExclusion(category, note)`
- Produces: `excludeCandidates(db, { candidateIds, category, note, actorUserId, now })`

- [ ] **Step 1: 사유·메모·25곳 제한 테스트 작성**

`OTHER`는 공백 제거 후 메모가 없으면 `EXCLUSION_NOTE_REQUIRED`, 허용되지 않은 사유는 `EXCLUSION_CATEGORY_INVALID`, 26곳은 `BULK_LIMIT_EXCEEDED`를 기대한다.

- [ ] **Step 2: 실패 확인**

Run: `pnpm vitest run tests/unit/manual-exclusion.test.ts`

Expected: 모듈이 없어 FAIL.

- [ ] **Step 3: 검증 함수와 DB 서비스 구현**

허용 사유는 `BUSINESS_TYPE`, `NOT_RESTAURANT`, `BAD_OR_DUPLICATE_DATA`, `POLICY`, `OTHER`다. `OPEN`·`PENDING`·비활성 제외 후보만 `ADMIN_EXCEPTION`으로 upsert하고 처리·건너뜀 목록을 반환하며 감사 로그를 남긴다.

- [ ] **Step 4: 단위·통합 테스트 확인**

Run: `pnpm vitest run tests/unit/manual-exclusion.test.ts && pnpm vitest run --config vitest.workers.config.ts tests/integration/candidate.server.test.ts`

Expected: 모두 PASS.

- [ ] **Step 5: 커밋**

```bash
git add app/features/candidates/manual-exclusion.ts app/features/candidates/candidate.server.ts tests/unit/manual-exclusion.test.ts tests/integration/candidate.server.test.ts
git commit -m "2026-08-08 관리자 일괄 예외 처리 서비스 추가"
```

### Task 4: 승인 불가·예외 관리자 UI

**Files:**
- Modify: `app/routes/admin-candidates.tsx`
- Modify: `scripts/seed-admin-qa.sql`
- Modify: `tests/e2e/admin-candidate-review.spec.ts`

**Interfaces:**
- Consumes: action intent `excludeSelected`, fields `exclusionCategory`, `exclusionNote`
- Produces: `state=EXCEPTION` 탭과 복원 액션

- [ ] **Step 1: 브라우저 실패 테스트 작성**

일반 후보 선택 후 `선택 장소 예외 처리`, 사유 선택, 처리 완료를 검증한다. `state=EXCEPTION`에서 룸살롱 자동 제외와 관리자 예외 행의 사유·복원 버튼을 확인하고 `체인점 제외`에는 체인만 존재하는지 검증한다.

- [ ] **Step 2: 실패 확인**

Run: `pnpm exec playwright test tests/e2e/admin-candidate-review.spec.ts --project=chromium`

Expected: 버튼·탭이 없어 FAIL.

- [ ] **Step 3: loader·action·UI 구현**

기존 `BLOCKED` 탭을 `EXCEPTION`으로 대체하고 기술적 BLOCKED 행과 비체인 활성 제외 행을 합친다. 선택 작업 영역에 사유 select, 메모 input, `선택 장소 예외 처리` 버튼을 추가한다. 제외 행은 유형별 badge, 사유, 처리자·일시, 복원 버튼을 표시한다.

- [ ] **Step 4: PC·모바일 E2E 확인**

Run: `pnpm exec playwright test tests/e2e/admin-candidate-review.spec.ts --project=chromium --project=mobile-chromium`

Expected: 모두 PASS.

- [ ] **Step 5: 커밋**

```bash
git add app/routes/admin-candidates.tsx scripts/seed-admin-qa.sql tests/e2e/admin-candidate-review.spec.ts
git commit -m "2026-08-08 승인 불가 예외 관리 UI 추가"
```

### Task 5: 운영 감사·전체 검증·배포

**Files:**
- Create: `docs/franchise-exclusion-audit-2026-08-08.md`
- Modify: GitHub issue #50 and PR body

- [ ] **Step 1: 운영 읽기 전용 감사**

현재 `OPEN`·`PENDING` 후보를 읽어 새 순수 정책으로 체인·유흥업종 예상 제외 수, 0.90 미만 신호 수, allowlist 유지 수를 집계한다. 상호명은 문서에 기록하지 않는다.

- [ ] **Step 2: 전체 검증**

Run:

```bash
pnpm test
pnpm test:integration
pnpm run typecheck
pnpm run build
git diff --check
```

Expected: 모두 exit 0.

- [ ] **Step 3: push와 PR**

`tj_exclusion-franchise-mvp`를 push하고 main 대상 PR을 생성한다. 범위, 검증, 0013 migration, 운영 이동 규모, 공정위 API 후속 범위를 기록한다.

- [ ] **Step 4: 승인된 방식으로 main 반영 후 운영 배포**

운영 D1 미적용 목록이 0013 하나인지 확인하고 적용한다. `pnpm run deploy` 후 HTTP 200, 고신뢰 체인·유흥업종 일반 큐 잔존 0, 예외 탭 건수를 확인한다.
