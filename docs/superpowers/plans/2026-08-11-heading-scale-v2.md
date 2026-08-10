# H1·H2 단계형 축소 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** H1을 원본의 75%, H2를 원본의 85%로 조정해 화면 전체의 제목 위계를 일정하게 만든다.

**Architecture:** 기존 CSS 구조와 화면별 selector는 유지하고 `app/app.css` 마지막에 최종 제목 scale override를 둔다. 직접 크기를 지정한 Tailwind 클래스와 이메일 인라인 H1은 원본 기준값으로 바꾸며, 계약 테스트가 모든 최종값을 고정한다.

**Tech Stack:** React Router 8, React 19, CSS, Tailwind 유틸리티 클래스, Vitest, Playwright

## 전역 제약

- H1은 H1 30% 축소 이전 원본 크기의 75%로 설정한다.
- H2는 현재 원본 크기의 85%로 설정한다.
- H3 이하, 본문, 굵기, 행간, 자간, 여백, 정렬은 변경하지 않는다.
- 데스크톱과 모바일 breakpoint에 같은 비율을 적용한다.
- 데이터베이스, API, 인증 동작, 추천 알고리즘을 변경하지 않는다.

---

### 작업 1: 제목 scale 계약 테스트

**Files:**
- Create: `tests/unit/heading-scale-contract.test.ts`
- Reference: `tests/unit/h1-scale-contract.test.ts`

**Interfaces:**
- Consumes: CSS selector와 `font-size` 선언, TSX의 Tailwind class 문자열
- Produces: H1 75%·H2 85% 목표값을 고정하는 회귀 테스트

- [ ] **Step 1: 실패하는 계약 테스트 작성**

  `app/app.css`의 최종 H1 override가 `h1:1.5em`, `.course-hero h1:clamp(36px,4.5vw,64.5px)`, `.discovery-hero h1:clamp(40.5px,5.25vw,69px)` 등을 포함하는지 검사한다. H2는 `h2:1.275em`, `.section-heading h2:clamp(21.25px,2.55vw,34px)`, `.course-empty h2:clamp(28.9px,3.4vw,47.6px)`, `.discovery-recommendations__title h2:clamp(35.7px,5.1vw,64.6px)` 등을 포함하는지 검사한다. 반응형 값과 직접 지정 Tailwind·이메일 값도 검사한다.

- [ ] **Step 2: RED 확인**

  Run: `pnpm vitest run tests/unit/heading-scale-contract.test.ts`

  Expected: 현재 H1 70% 값과 미축소 H2 값 때문에 assertion이 실패한다.

- [ ] **Step 3: 테스트 커밋**

  ```bash
  git add tests/unit/heading-scale-contract.test.ts
  git commit -m "2026-08-11 H1 H2 단계형 축소 계약 테스트"
  ```

### 작업 2: H1 75%와 H2 85% 구현

**Files:**
- Modify: `app/app.css`
- Modify: `app/styles/design-system.css`
- Modify: `app/routes/verify-email.tsx`
- Modify: `app/routes/admin-reviewers.tsx`
- Modify: `app/routes/admin-import.tsx`
- Modify: `app/routes/admin-candidates.tsx`
- Modify: `app/routes/login.tsx`
- Modify: `app/routes/reviewer-apply.tsx`
- Modify: `app/routes/reviewer-profile.tsx`
- Modify: `app/routes/admin-places.tsx`
- Modify: `app/features/auth/email.server.ts`
- Test: `tests/unit/heading-scale-contract.test.ts`

**Interfaces:**
- Consumes: 작업 1의 목표값 계약
- Produces: 화면과 이메일에 적용되는 최종 제목 scale

- [ ] **Step 1: H1 최종값 변경**

  전역 H1을 `1.5em`으로 바꾸고 각 원본값에 0.75를 적용한다. 주요 값은 `.hero h1 clamp(39px,6vw,84px)`, `.course-hero h1 clamp(36px,4.5vw,64.5px)`, `.member-profile__taste h1 clamp(39px,5.25vw,69px)`, `.discovery-hero h1 clamp(40.5px,5.25vw,69px)`다. 온보딩 H1은 `clamp(1.35rem,5.25vw,2.25rem)`로 바꾼다.

- [ ] **Step 2: H2 최종 override 추가**

  전역 H2를 `1.275em`으로 두고 원본값에 0.85를 적용한다. 주요 값은 `.section-heading h2 clamp(21.25px,2.55vw,34px)`, `.course-empty h2 clamp(28.9px,3.4vw,47.6px)`, `.member-section-heading h2 clamp(23.8px,2.55vw,34px)`, `.discovery-controls__heading h2 clamp(28.9px,3.4vw,44.2px)`, `.discovery-recommendations__title h2 clamp(35.7px,5.1vw,64.6px)`다. 최종 selector와 breakpoint가 이전 중복 선언보다 뒤에서 적용되도록 한다.

- [ ] **Step 3: 직접 지정 클래스와 이메일 변경**

  H1은 `text-4xl→text-[27px]`, `text-3xl→text-[22.5px]`, `md:text-5xl→md:text-[36px]`, `md:text-6xl→md:text-[45px]`, 이메일 `24px→18px`를 사용한다. H2는 `text-xl→text-[17px]`, `text-lg→text-[15.3px]`, `text-base→text-[13.6px]`를 사용한다.

- [ ] **Step 4: GREEN 확인**

  Run: `pnpm vitest run tests/unit/heading-scale-contract.test.ts`

  Expected: PASS.

- [ ] **Step 5: 전체 검증**

  Run: `pnpm test`

  Expected: 전체 단위 테스트 PASS.

  Run: `pnpm typecheck`

  Expected: exit 0.

  Run: `pnpm build`

  Expected: client와 SSR build 성공.

- [ ] **Step 6: 구현 커밋**

  ```bash
  git add app tests/unit/heading-scale-contract.test.ts
  git commit -m "2026-08-11 H1 25% H2 15% 축소 적용"
  ```

### 작업 3: 반응형 시각 검수와 PR

**Files:**
- Create: `docs/evidence/2026-08-11-heading-scale-v2-desktop.png`
- Create: `docs/evidence/2026-08-11-heading-scale-v2-mobile.png`

**Interfaces:**
- Consumes: 작업 2의 빌드된 화면
- Produces: PR에 첨부할 데스크톱·모바일 시각 증거

- [ ] **Step 1: 로컬 서버와 Playwright 검수**

  `/places` 또는 온보딩 진입 화면을 1440×1000과 390×844로 확인한다. H1이 H2보다 크고 H2가 본문보다 크며, 제목 줄바꿈과 카드 경계를 침범하지 않아야 한다.

- [ ] **Step 2: 증거 저장**

  두 화면을 `docs/evidence/2026-08-11-heading-scale-v2-desktop.png`, `docs/evidence/2026-08-11-heading-scale-v2-mobile.png`에 저장한다.

- [ ] **Step 3: 증거 커밋**

  ```bash
  git add docs/evidence/2026-08-11-heading-scale-v2-desktop.png docs/evidence/2026-08-11-heading-scale-v2-mobile.png
  git commit -m "2026-08-11 제목 단계 반응형 검수 증거"
  ```

- [ ] **Step 4: 동기화·푸시·PR**

  최신 `origin/main`을 확인하고 기능 브랜치를 push한다. PR에는 Issue #78, 변경 범위, 테스트 결과, 운영 영향, 남은 위험, 두 화면 증거를 기록한다.
