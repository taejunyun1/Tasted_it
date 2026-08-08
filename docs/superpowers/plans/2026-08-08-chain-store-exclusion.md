# 체인점 수집 제외 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 알려진 베이커리 체인점을 수집 단계에서 일반 검수 대상에서 제외하고, 어드민에서 제외 사유 확인과 검수 대기 복원을 제공한다.

**Architecture:** 순수 체인 판정 정책과 제외 이력 저장을 분리한다. 후보 저장 직후 제외 이력을 동기화하고, 일반 검수 쿼리는 활성 제외를 빼며 어드민의 별도 탭은 활성 제외만 조회한다.

**Tech Stack:** TypeScript, Drizzle ORM, Cloudflare D1, React Router, Vitest

## Global Constraints

- 브랜치 `tj_category-semantic`과 전용 worktree만 사용한다.
- 패키지 관리자는 `pnpm`만 사용한다.
- 운영 D1 migration과 배포는 별도 승인 전 실행하지 않는다.
- 제외 후보를 삭제하지 않고 복원·자동 해제 이력을 보존한다.
- 승인된 후보를 자동 제외 상태로 되돌리지 않는다.

---

### Task 1: 체인 판정과 비체인 베이커리 분류

**Files:**
- Create: `app/features/candidates/chain-store-policy.ts`
- Create: `tests/unit/chain-store-policy.test.ts`
- Modify: `app/features/candidates/category-suggestion.ts`
- Modify: `tests/unit/category-suggestion.test.ts`

**Interfaces:**
- Produces: `matchChainStore(businessName): ChainStoreMatch | null`
- Produces: 비체인 `꽈배기|베이커리|브레드|브래드|빵집`의 `bakery-detail` 추천

- [ ] 표기 변형 `파리바게뜨|파리바게트|파리베게뜨|파리베게트|뚜레쥬르|뜌레쥬르`가 체인으로 판정되는 실패 테스트를 작성한다.
- [ ] `파리의바게트`, `동네브레드`, `시장꽈배기` 같은 비체인 상호가 체인으로 판정되지 않는 테스트를 작성한다.
- [ ] `pnpm vitest run tests/unit/chain-store-policy.test.ts tests/unit/category-suggestion.test.ts`를 실행해 새 기대값이 실패하는지 확인한다.
- [ ] 명시적 체인 목록과 정규화 함수로 `matchChainStore`를 구현한다.
- [ ] 비체인 베이커리 표현을 분류 규칙에 추가한다.
- [ ] 같은 테스트를 다시 실행해 통과를 확인한다.

### Task 2: 제외 이력과 수집 연동

**Files:**
- Create: `drizzle/0010_chain_store_exclusions.sql`
- Modify: `app/db/schema.ts`
- Modify: `app/features/candidates/candidate.server.ts`
- Modify: `app/features/candidates/sync.server.ts`
- Modify: `tests/integration/candidate.server.test.ts`
- Modify: `tests/integration/public-data-sync.server.test.ts`

**Interfaces:**
- Produces: `businessLicenseExclusions` 테이블
- Produces: `listExcludedCandidates(db, filters)`
- Produces: `restoreExcludedCandidate(db, { candidateId, actorUserId, now })`
- Changes: `upsertBusinessLicense` 반환값에 `excluded: boolean`

- [ ] 신규 체인 후보가 `ACTIVE / CHAIN_STORE`로 제외되고 일반 검수 목록에서 빠지는 통합 실패 테스트를 작성한다.
- [ ] 복원 후 재동기화해도 `OVERRIDDEN`이 유지되는 실패 테스트를 작성한다.
- [ ] 체인명이 사라지면 `ACTIVE`가 `CLEARED`로 바뀌는 실패 테스트를 작성한다.
- [ ] `pnpm vitest run --config vitest.workers.config.ts tests/integration/candidate.server.test.ts`로 실패를 확인한다.
- [ ] 제외 테이블 migration과 Drizzle 스키마를 추가한다.
- [ ] upsert 뒤 체인 판정 결과에 따라 제외 상태를 생성·유지·자동 해제한다.
- [ ] 일반 후보 목록에서 `ACTIVE` 제외를 빼고 제외 목록·복원 함수를 구현한다.
- [ ] 동기화 결과에 `excluded` 집계를 추가한다.
- [ ] 통합 테스트를 다시 실행해 통과를 확인한다.

### Task 3: 어드민 제외 탭과 복원

**Files:**
- Modify: `app/routes/admin-candidates.tsx`
- Modify: `tests/e2e/admin-candidate-review.spec.ts`

**Interfaces:**
- Consumes: `listExcludedCandidates`, `restoreExcludedCandidate`
- Produces: `state=EXCLUDED` 탭, 제외 사유 행, `restoreExcluded` 액션

- [ ] 어드민 페이지에 `체인점 제외` 탭과 복원 버튼이 필요하다는 브라우저 실패 테스트를 작성한다.
- [ ] loader가 `state=EXCLUDED`일 때 활성 제외 목록과 건수를 반환하도록 구현한다.
- [ ] 제외 탭에서는 선택·AI·카테고리 입력을 숨기고 체인명·제외 사유·복원 버튼을 표시한다.
- [ ] action에서 관리자만 `restoreExcluded`를 실행하도록 연결한다.
- [ ] 관련 단위·통합 테스트와 가능한 브라우저 테스트를 실행한다.

### Task 4: 문서·전체 검증·PR 업데이트

**Files:**
- Modify: `docs/category-classification-audit-2026-08-08.md`
- Modify: `docs/superpowers/plans/2026-08-08-chain-store-exclusion.md`

**Interfaces:**
- Produces: 운영 미적용 상태와 체인 제외 기준 문서

- [ ] 감사 문서에 체인 제외 목록, 비체인 베이커리 규칙, 복원 동작을 기록한다.
- [ ] `pnpm test`, `pnpm test:integration`, `pnpm run typecheck`, `pnpm run build`, `pnpm run db:migrate:local`을 실행한다.
- [ ] `git diff --check`와 변경 파일 diff를 검토한다.
- [ ] 날짜와 핵심 내용이 포함된 커밋을 만들고 `tj_category-semantic`을 push한다.
- [ ] PR #47 본문과 검증 결과를 갱신한다.
