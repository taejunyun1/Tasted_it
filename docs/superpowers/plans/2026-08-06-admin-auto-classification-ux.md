# 관리자 자동 분류 검수 UX 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 공공데이터 동기화 후 신규 후보 10곳을 자동 분류하고, 검수 목록의 재분류 상태와 페이지 이동을 빠르게 확인할 수 있게 한다.

**Architecture:** 동기화와 Workers AI 호출은 서로 다른 React Router action 요청으로 유지한다. 동기화 성공 후 `autoClassify=1`이 포함된 검수 URL로 리다이렉트하고, 검수 화면의 `useFetcher`가 최초 1회 AI action을 호출한 뒤 쿼리를 제거한다. 후보 상태는 서버의 최신 AI 실행 기록으로 계산하며 페이지 이동 컴포넌트는 표 위·아래에서 공유한다.

**Tech Stack:** React Router 8 Framework Mode, React 19, TypeScript 7.0.2, Drizzle ORM, Cloudflare D1, Workers AI, Vitest

## Global Constraints

- AI 분류 한 번의 최대 처리량은 10곳이다.
- Workers AI 일일 사용량 90% 이상에서는 자동·수동 분류를 중단한다.
- AI 분류 성공만으로 장소를 공개하지 않는다.
- 폐업·좌표 누락·중복 후보는 계속 승인 불가다.
- 공공데이터 동기화와 AI 호출을 한 서버 요청으로 합치지 않는다.
- 기존 검색·필터·페이지 쿼리를 보존한다.

---

### Task 1: 동기화 후 자동 분류 이동 계약

**Files:**
- Create: `app/features/candidates/auto-classification-navigation.ts`
- Test: `app/features/candidates/auto-classification-navigation.test.ts`
- Modify: `app/routes/admin-data-sync.tsx`

**Interfaces:**
- Produces: `buildAutoClassificationReviewUrl(): string`
- Produces: 동기화 action 성공 시 `/admin/candidates?autoClassify=1` 리다이렉트

- [ ] **Step 1: 실패 테스트 작성**

`buildAutoClassificationReviewUrl()`이 `/admin/candidates?autoClassify=1`을 반환하고 다른 쿼리가 주어지면 안전하게 병합하는 테스트를 작성한다.

- [ ] **Step 2: RED 확인**

Run: `corepack pnpm vitest run app/features/candidates/auto-classification-navigation.test.ts`

Expected: 모듈 또는 함수가 없어 실패한다.

- [ ] **Step 3: 최소 구현**

`URLSearchParams`로 `autoClassify=1`을 추가하는 순수 함수를 만들고 동기화 action이 성공 결과를 세션에 의존하지 않는 redirect로 반환하게 한다.

- [ ] **Step 4: GREEN 확인**

Run: `corepack pnpm vitest run app/features/candidates/auto-classification-navigation.test.ts`

Expected: 테스트가 통과한다.

- [ ] **Step 5: 커밋**

`git commit -m "2026-08-06 동기화 후 자동 분류 이동 추가"`

### Task 2: 자동 실행 1회 및 재분류 상태 전환

**Files:**
- Create: `app/features/candidates/auto-classification-trigger.ts`
- Test: `app/features/candidates/auto-classification-trigger.test.ts`
- Modify: `app/routes/admin-candidates.tsx`
- Modify: `app/features/candidates/bulk-review.server.ts`
- Test: `app/features/candidates/bulk-review.server.test.ts`

**Interfaces:**
- Produces: `shouldAutoClassify(searchParams, fetcherState): boolean`
- Produces: `removeAutoClassificationParam(searchParams): string`
- Consumes: 기존 `classifyPendingCandidatesWithAi(..., { limit: 10 })`

- [ ] **Step 1: 자동 실행·쿼리 정리 실패 테스트 작성**

`autoClassify=1`이고 fetcher가 idle일 때만 실행되며, 완료 후 다른 필터는 보존하고 `autoClassify`만 제거하는 테스트를 작성한다.

- [ ] **Step 2: RED 확인**

Run: `corepack pnpm vitest run app/features/candidates/auto-classification-trigger.test.ts`

Expected: 모듈 또는 함수가 없어 실패한다.

- [ ] **Step 3: 순수 함수 최소 구현**

자동 실행 여부와 쿼리 제거를 route 밖의 순수 함수로 구현한다.

- [ ] **Step 4: 분류 상태 실패 테스트 작성**

최신 v3 AI 성공 후보는 `AUTO`, AI 실패 후보는 `MANUAL`이며 `classificationSource`가 `AI_FAILED`인 것을 검증한다.

- [ ] **Step 5: RED 확인**

Run: `corepack pnpm vitest run app/features/candidates/bulk-review.server.test.ts`

Expected: 실패 배지 메타 또는 상태 계약이 없어 실패한다.

- [ ] **Step 6: 검수 화면 구현**

헤더 AI 버튼을 제거하고 `useFetcher`로 최초 1회 자동 action을 제출한다. 선택 작업 버튼 문구를 `선택 장소 다시 분류`로 바꾸고 결과 완료 후 loader 재검증으로 배지를 갱신한다. AI 실패 행에는 `AI 확인 실패` 보조 배지를 표시한다.

- [ ] **Step 7: GREEN 확인**

Run: `corepack pnpm vitest run app/features/candidates/auto-classification-trigger.test.ts app/features/candidates/bulk-review.server.test.ts`

Expected: 두 테스트 파일이 통과한다.

- [ ] **Step 8: 커밋**

`git commit -m "2026-08-06 자동 분류 실행과 검수 배지 개선"`

### Task 3: 상·하단 페이지 이동과 필터 보존

**Files:**
- Create: `app/features/candidates/pagination.ts`
- Test: `app/features/candidates/pagination.test.ts`
- Modify: `app/routes/admin-candidates.tsx`

**Interfaces:**
- Produces: `buildCandidatePageHref(params: URLSearchParams, page: number): string`
- Consumes: 기존 `Pagination` 표시 컴포넌트

- [ ] **Step 1: 실패 테스트 작성**

페이지 링크가 검색·상태·지역·페이지 크기를 보존하면서 page만 교체하고 `autoClassify`는 제거하는 테스트를 작성한다.

- [ ] **Step 2: RED 확인**

Run: `corepack pnpm vitest run app/features/candidates/pagination.test.ts`

Expected: 모듈 또는 함수가 없어 실패한다.

- [ ] **Step 3: 최소 구현**

페이지 URL 빌더를 추가하고 동일 `Pagination` 컴포넌트를 표 바로 위와 아래에 렌더링한다. 첫·마지막 페이지의 비활성 상태와 현재/전체 페이지 문구를 유지한다.

- [ ] **Step 4: GREEN 확인**

Run: `corepack pnpm vitest run app/features/candidates/pagination.test.ts`

Expected: 테스트가 통과한다.

- [ ] **Step 5: 커밋**

`git commit -m "2026-08-06 검수 목록 상하단 페이지 이동 추가"`

### Task 4: 통합 검증·운영 배포

**Files:**
- Modify only if verification reveals an in-scope defect.

**Interfaces:**
- Produces: 병합된 `main`의 운영 Worker 배포

- [ ] **Step 1: 전체 정적·단위·통합 검증**

Run: `corepack pnpm typecheck && corepack pnpm test && corepack pnpm test:integration && corepack pnpm build`

Expected: 모든 명령 exit 0.

- [ ] **Step 2: 브라우저 QA**

관리자 계정으로 동기화 성공 이동, 자동 분류 1회, 수동 확인 목록 제외, 상·하단 페이지 이동, 필터 보존, 승인 공개 회귀를 확인한다.

- [ ] **Step 3: 변경 검토와 커밋 정리**

Run: `git diff origin/main...HEAD --check && git status --short`

Expected: 공백 오류와 미커밋 변경이 없다.

- [ ] **Step 4: PR·체크·병합**

기능 브랜치를 push하고 `main` 대상 PR을 만든다. 체크 통과와 diff 검토 후 squash merge하고 원격 기능 브랜치를 삭제한다.

- [ ] **Step 5: 운영 배포와 스모크 QA**

병합된 `origin/main`에서 `corepack pnpm deploy`를 실행하고 운영 관리자 검수 화면 HTTP·핵심 인터랙션을 확인한다.

- [ ] **Step 6: 사용하지 않는 브랜치 정리**

모든 로컬·원격 브랜치의 병합 여부, 열린 PR, 연결 워크트리를 확인한다. 열린 PR·미병합 커밋·다른 워크트리에서 사용 중인 브랜치는 보존하고, `origin/main`에 병합된 사용하지 않는 기능 브랜치만 삭제한다.
