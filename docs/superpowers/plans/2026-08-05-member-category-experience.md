# Member Category Experience Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 위치 기반 지도 탐색, 이메일 인증 회원 계정, 내 취향, 안전한 어드민 대표 분류·승인 흐름을 완성한다.

**Architecture:** React Router Framework loader/action이 모든 서버 변형을 담당하고 D1/Drizzle이 계정·장소 상태를 저장한다. 지도 필터는 URL의 category, bbox, lat, lng를 단일 상태로 사용하며 Resend 호출은 작은 서버 모듈로 격리한다.

**Tech Stack:** React Router 8, React 19, Cloudflare Workers/D1, Drizzle ORM, Web Crypto, NAVER Maps JavaScript API, Resend REST API, Vitest, Playwright.

## Global Constraints

- 보조 카테고리는 신규 승인에서 생성하지 않는다.
- 공개 상태이면서 대표 카테고리인 장소만 회원 화면에 노출한다.
- 비밀번호 원문과 계정 토큰 원문은 저장하거나 로그에 남기지 않는다.
- 본문 폰트는 400–500, 제목·핵심 버튼은 최대 600을 기본으로 한다.
- 모든 개발은 `feature/member-category-experience`에서 PR로 main에 병합한다.

---

### Task 1: 계정 스키마와 암호화

**Files:**
- Create: `drizzle/0003_member_accounts.sql`
- Modify: `app/db/schema.ts`
- Create: `app/features/auth/password.server.ts`
- Test: `tests/unit/password.test.ts`

**Interfaces:**
- Produces: `hashPassword(password): Promise<{hash:string;salt:string}>`, `verifyPassword(password, hash, salt): Promise<boolean>`.

- [ ] 실패 테스트에 같은 비밀번호 검증 성공, 다른 비밀번호 실패, salt별 다른 hash를 작성한다.
- [ ] `pnpm test -- tests/unit/password.test.ts`에서 export 부재 실패를 확인한다.
- [ ] PBKDF2-SHA-256 210,000회와 16바이트 random salt를 Web Crypto로 구현한다.
- [ ] users 계정 컬럼과 account_tokens 테이블 migration/schema를 작성한다.
- [ ] 단위 테스트와 `pnpm run typecheck`를 통과시킨다.

### Task 2: Resend와 가입·인증·재설정 서비스

**Files:**
- Create: `app/features/auth/email.server.ts`
- Create: `app/features/auth/account.server.ts`
- Modify: `app/routes/login.tsx`
- Create: `app/routes/signup.tsx`
- Create: `app/routes/verify-email.tsx`
- Create: `app/routes/forgot-password.tsx`
- Create: `app/routes/reset-password.tsx`
- Modify: `app/routes.ts`
- Test: `tests/unit/resend-email.test.ts`
- Test: `tests/integration/account.server.test.ts`

**Interfaces:**
- Produces: `registerAccount`, `verifyEmailToken`, `authenticateAccount`, `requestPasswordReset`, `resetPassword`, `sendAccountEmail`.

- [ ] Resend POST 요청과 가입→인증→로그인→재설정 단회 토큰 실패 테스트를 작성한다.
- [ ] 대상 테스트가 새 모듈 부재로 실패하는지 확인한다.
- [ ] 토큰 SHA-256 저장, 30분 만료, 소비 시각 검증과 동일 응답 문구를 구현한다.
- [ ] 이메일·비밀번호 로그인 폼과 가입/인증/재설정 route action을 연결한다.
- [ ] 단위·통합·타입 테스트를 통과시킨다.

### Task 3: 전역 세션 헤더와 내 취향

**Files:**
- Modify: `app/root.tsx`
- Modify: `app/features/auth/session.server.ts`
- Create: `app/features/members/member.server.ts`
- Create: `app/routes/me.tsx`
- Create: `app/routes/logout.tsx`
- Modify: `app/routes.ts`
- Test: `tests/integration/member.server.test.ts`
- Test: `tests/integration/login.server.test.ts`

**Interfaces:**
- Produces: `listMemberTaste(db,userId)`, `destroyUserSession(request)`, `/me`, `/logout`.

- [ ] 다른 회원·비공개 장소 제외와 로그아웃 쿠키 만료 실패 테스트를 작성한다.
- [ ] 테스트 실패를 확인하고 회원별 저장·현재 평가 조회를 구현한다.
- [ ] root loader 기반 로그인/관리자 헤더와 POST 로그아웃을 연결한다.
- [ ] 내 취향 저장 해제 action과 목록·빈 상태 UI를 구현한다.
- [ ] 통합·타입 테스트를 통과시킨다.

### Task 4: 위치 기반 지도 홈과 장소 목록

**Files:**
- Modify: `app/routes/home.tsx`
- Create: `app/routes/place-list.tsx`
- Create: `app/components/map/HomeMap.tsx`
- Modify: `app/features/places/place.server.ts`
- Modify: `app/routes.ts`
- Test: `tests/integration/place.server.test.ts`
- Test: `tests/unit/map-state.test.ts`

**Interfaces:**
- Produces: `listPublicCategoryGroups(db)`, bbox/category 필터 지도 홈, `/places` 목록.

- [ ] 활성·공개·대표 카테고리 집계와 URL 상태 보존 실패 테스트를 작성한다.
- [ ] 테스트 실패를 확인하고 카테고리별 공개 장소 수 조회를 구현한다.
- [ ] 현재 위치 요청, 거부 시 광주 fallback, 지도 위 대/소분류 필터를 구현한다.
- [ ] 동일 URL 조건을 사용하는 장소 목록과 지도 복귀 링크를 구현한다.
- [ ] 단위·통합·타입 테스트를 통과시킨다.

### Task 5: 어드민 대표 자동 분류와 승인 QA

**Files:**
- Modify: `app/routes/admin-candidates.tsx`
- Modify: `app/features/candidates/candidate.server.ts`
- Create: `tests/e2e/admin-candidate-review.spec.ts`
- Modify: `tests/e2e/admin-places.spec.ts`
- Modify: `tests/e2e/browse.spec.ts`

**Interfaces:**
- Consumes: `classifyCandidate`, `approveCandidate`, `bulkApproveCandidates`.
- Produces: 자동 대표 선택·신뢰도 표시, 보조 분류 없는 승인, 최신 네이버 지도 E2E.

- [ ] 영업/폐업/좌표 누락/중복/HIGH/LOW/CONFLICT fixture와 실패 E2E를 작성한다.
- [ ] 대표 카테고리 defaultValue, 신뢰도·근거, 자동 동네를 연결하고 보조 UI/action을 삭제한다.
- [ ] 개별·일괄 승인 뒤 공개 지도 포함, 폐업·불안전 후보 제외를 브라우저에서 검증한다.
- [ ] 기존 카카오 지도·과거 제목 기반 E2E 기대값을 현재 UI에 맞게 수정한다.
- [ ] `pnpm test`, `pnpm run test:integration`, `pnpm run test:e2e`, `pnpm run typecheck`, `pnpm run build`를 모두 통과시킨다.

### Task 6: PR, 운영 설정과 배포

**Files:**
- Modify: `app/cloudflare-env.d.ts`
- Modify: `README.md`

**Interfaces:**
- Requires: `RESEND_API_KEY`, `RESEND_FROM_EMAIL`, `APP_BASE_URL`, `NAVER_MAPS_CLIENT_ID`, `ADMIN_EMAIL`.

- [ ] 환경 변수 문서와 Cloudflare binding 타입을 추가한다.
- [ ] secret 값이 git diff/build 산출물에 포함되지 않았는지 검사한다.
- [ ] 변경을 날짜 포함 메시지로 커밋하고 feature branch를 push한다.
- [ ] PR diff와 checks를 확인해 squash merge하고 remote branch를 삭제한다.
- [ ] main에서 배포하고 홈, 목록, 로그인, 가입, 내 취향, 어드민 route 응답을 확인한다.
