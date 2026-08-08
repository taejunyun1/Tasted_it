# 상호명 문맥 기반 카테고리 분류 개선 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**목표:** 상호명에 포함된 음식과 영업 형태의 문맥을 구분해 해산물 음식점과 라이브 주점을 올바르게 추천하고, 과일 이름만으로 음식점 카테고리를 확정하지 않도록 한다.

**구조:** 기존 규칙 기반 분류기의 점수 체계를 유지하되, 일반 단어보다 구체적인 복합 문맥에 우선 점수를 부여한다. 해산물은 새 상위·하위 카테고리로 추가하고, 전체 후보는 동일한 순수 함수로 다시 분류해 신뢰도별 결과를 감사 문서로 남긴다.

**기술 스택:** TypeScript, Vitest, Drizzle SQL migration, Cloudflare D1/Wrangler

## 전체 제약

- 브랜치 `tj_category-semantic`과 전용 worktree에서만 작업한다.
- 작업 소유권은 GitHub Issue #46에 기록한다.
- 운영 D1 마이그레이션과 운영 배포는 별도 승인 전 실행하지 않는다.
- 문서와 사용자-facing 분류 근거는 한국어로 작성한다.
- 패키지 관리자는 `pnpm`만 사용한다.

---

### Task 1: 분류 기대 동작을 테스트로 고정

**Files:**
- Modify: `tests/unit/candidate-auto-classification.test.ts`
- Modify: `tests/unit/category-suggestion.test.ts`

**Interfaces:**
- Consumes: `classifyCandidate(input): CandidateClassification`
- Produces: 해산물, 라이브 주점, 과일 제외 회귀 테스트

- [ ] **Step 1: 해산물 대표 상호 테스트 작성**

  `연어`, `장어`, `크랩`, `대게`, `랍스터`, `전복`, `굴`, `꼬막`, `조개`, `낙지`, `주꾸미`, `문어`, `오징어`, `아귀`, `생선`, `고등어`, `갈치`, `복어`, `물회`, `해물`이 `seafood-dish`로 분류되는 표 기반 테스트를 추가한다.

- [ ] **Step 2: 복합 문맥과 제외 기준 테스트 작성**

  `장어구이`가 일반 `grill`보다 해산물을 우선하고, `라이브카페`·`음악주점`은 `pub`으로 분류되며, `사과농장`·`망고상회`·`딸기마켓`은 원천 기본값의 `LOW`를 유지하는 테스트를 추가한다.

- [ ] **Step 3: 실패를 확인**

  Run: `pnpm vitest run tests/unit/candidate-auto-classification.test.ts tests/unit/category-suggestion.test.ts`

  Expected: 새 `seafood-dish`와 라이브 주점 기대값이 현재 구현에서 실패한다.

### Task 2: 규칙 분류기와 카테고리 계층 구현

**Files:**
- Modify: `app/features/candidates/category-suggestion.ts`
- Create: `drizzle/0009_category_semantic_taxonomy.sql`

**Interfaces:**
- Consumes: 사업장명, 원천 업태, 원천 데이터 종류
- Produces: `seafood-dish`, `pub` 또는 기존 카테고리와 신뢰도·근거

- [ ] **Step 1: 구체 문맥 우선순위 구현**

  규칙에 선택적 가중치를 추가해 해산물 음식명과 `라이브카페` 같은 복합 영업 형태가 일반 `구이`·`카페` 신호보다 앞서도록 한다. `스시`·`초밥`은 기존 일식 카테고리에 유지하고 `회`·생선·갑각류·연체류 명칭은 `seafood-dish`로 분리한다.

- [ ] **Step 2: 원천 업태 보강**

  원천 업태에 `횟집`, `해산물`, `수산`, `라이브`, `음악`, `유흥주점`이 있으면 상호명 분류를 보강하도록 규칙을 추가한다.

- [ ] **Step 3: 새 카테고리 migration 작성**

  `cat-seafood` 상위 카테고리와 `cat-seafood-dish` 하위 카테고리를 `INSERT OR IGNORE`로 추가한다. 기존 migration은 수정하지 않는다.

- [ ] **Step 4: 테스트 통과 확인**

  Run: `pnpm vitest run tests/unit/candidate-auto-classification.test.ts tests/unit/category-suggestion.test.ts`

  Expected: 모든 대상 테스트가 통과한다.

### Task 3: AI 보조 분류 지침 갱신

**Files:**
- Modify: `app/features/candidates/ai-classification.server.ts`
- Test: `tests/unit/ai-classification.test.ts` 또는 해당 상수를 검증하는 기존 단위 테스트

**Interfaces:**
- Consumes: 규칙 분류 후보와 근거
- Produces: 새 프롬프트 버전 `place-category-v4` 및 문맥 지침

- [ ] **Step 1: 실패 테스트 작성 및 확인**

  프롬프트 버전이 `place-category-v4`이고 시스템 지침이 해산물·라이브 주점·과일 제외 원칙을 포함해야 한다는 테스트를 추가한 뒤 실패를 확인한다.

- [ ] **Step 2: 프롬프트 상수와 지침 구현**

  시스템 지침을 내보낼 수 있는 상수로 분리하고 버전을 올린다. 과일 이름만으로 음식점 종류를 추론하지 않으며 `라이브카페`는 주점 맥락으로 판단하도록 명시한다.

- [ ] **Step 3: 테스트 통과 확인**

  Run: `pnpm vitest run tests/unit/ai-classification*.test.ts`

  Expected: 관련 테스트가 통과한다.

### Task 4: 전체 후보 분류 감사

**Files:**
- Create: `app/features/candidates/category-audit.ts`
- Create: `tests/unit/category-audit.test.ts`
- Create: `docs/category-classification-audit-2026-08-08.md`

**Interfaces:**
- Consumes: `{ businessName, businessSubtype, sourceType }[]`
- Produces: 카테고리·신뢰도별 집계와 수동 확인 대상 목록

- [ ] **Step 1: 감사 집계 실패 테스트 작성**

  감사 함수가 총 건수, 카테고리별 건수, 신뢰도별 건수, `LOW`·`CONFLICT` 수동 검토 목록을 반환하는 테스트를 추가하고 실패를 확인한다.

- [ ] **Step 2: 최소 감사 함수 구현**

  각 행에 `classifyCandidate`를 적용하고 개인정보나 전체 운영 행을 저장하지 않는 집계 결과만 반환한다.

- [ ] **Step 3: 읽기 전용 전체 후보 감사 실행**

  원격 데이터는 변경하지 않고 조회만 수행한다. 전체 결과에서 `seafood-dish`, `pub`, `LOW`, `CONFLICT`의 규모와 대표적인 오분류 위험을 확인한다.

- [ ] **Step 4: 감사 문서 작성**

  적용 규칙, 카테고리별 집계, 수동 확인 필요 조건, 과일 제외 원칙, 운영 migration 미적용 상태를 한국어로 기록한다. 실제 상호명 전체 목록이나 개인정보는 문서에 포함하지 않는다.

### Task 5: 전체 검증과 인수인계

**Files:**
- Modify: 변경된 모든 파일

**Interfaces:**
- Consumes: 구현 및 문서
- Produces: 검증된 feature branch와 `main` 대상 Pull Request

- [ ] **Step 1: 전체 검증**

  Run: `pnpm test`

  Run: `pnpm run typecheck`

  Run: `pnpm run build`

  Expected: 세 명령 모두 exit code 0.

- [ ] **Step 2: diff와 migration 자체 검토**

  `git diff --check`, `git diff --stat`, 변경 파일 diff를 확인하고 운영 데이터 변경이나 비밀값 포함이 없는지 검토한다.

- [ ] **Step 3: 커밋·푸시·PR**

  날짜와 주요 내용을 포함한 커밋을 만들고 `origin/tj_category-semantic`으로 푸시한 뒤 `main` 대상 PR을 생성한다. PR에는 Issue #46, 검증 결과, 신규 migration과 운영 미적용 사실, 남은 수동 검토 위험을 기록한다.
