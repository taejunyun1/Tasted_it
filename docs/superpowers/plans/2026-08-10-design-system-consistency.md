# Re:Taste 디자인 시스템 정합성 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 사용자 핵심 화면과 어드민 화면의 컨테이너, 여백, 카드, 버튼, 배지 규칙을 통일하고 이후 화면 제작에 사용할 디자인 가이드를 제공한다.

**Architecture:** 기존 `app/app.css`를 대규모 재작성하지 않고, 새 `app/styles/design-system.css`를 마지막에 불러와 토큰과 정합성 레이어를 제공한다. 기능 마크업은 유지하고 CSS 토큰·공통 클래스·현재 페이지 클래스의 제한된 덮어쓰기로 회귀 위험을 줄인다.

**Tech Stack:** React Router 8 Framework Mode, React 19, CSS, Vitest, Playwright

## Global Constraints

- 최대 콘텐츠 폭은 `1280px`이다.
- 데스크톱 거터는 `20px`, 모바일 거터는 `14px`이다.
- 사용자 화면 페이지 시작은 데스크톱 `64px`, 모바일 `32px`이다.
- 어드민 화면 페이지 시작은 데스크톱 `48px`, 모바일 `28px`이다.
- 사용자 주요 섹션 간격은 데스크톱 `80px`, 모바일 `56px`이다.
- 기능, 데이터, 추천 알고리즘, 인증, DB 스키마는 변경하지 않는다.
- 외부 의존성과 lockfile은 변경하지 않는다.
- 디자인 가이드의 토큰명은 실제 CSS 변수명과 일치해야 한다.

---

### Task 1: 디자인 토큰과 로드 계약

**Files:**
- Create: `app/styles/design-system.css`
- Modify: `app/root.tsx`
- Create: `tests/unit/design-system-contract.test.ts`

**Interfaces:**
- Consumes: 기존 `app/app.css`의 페이지 클래스
- Produces: `--layout-*`, `--space-*`, `--radius-*` 전역 토큰과 마지막 순서로 로드되는 정합성 스타일시트

- [ ] **Step 1: 실패하는 계약 테스트 작성**

```ts
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const css = readFileSync("app/styles/design-system.css", "utf8");
const root = readFileSync("app/root.tsx", "utf8");

describe("Re:Taste design system", () => {
  it("공통 레이아웃·간격·모서리 토큰을 제공한다", () => {
    ["--layout-max:1280px", "--layout-gutter:20px", "--layout-gutter-mobile:14px", "--space-20:80px", "--radius-card:20px"].forEach((token) => expect(css).toContain(token));
  });

  it("기존 스타일 다음에 디자인 시스템을 불러온다", () => {
    expect(root.indexOf('import "./app.css"')).toBeLessThan(root.indexOf('import "./styles/design-system.css"'));
  });
});
```

- [ ] **Step 2: 테스트가 파일 부재로 실패하는지 확인**

Run: `../../node_modules/.bin/vitest run tests/unit/design-system-contract.test.ts`
Expected: FAIL with `ENOENT app/styles/design-system.css`

- [ ] **Step 3: 최소 토큰과 스타일 로드 구현**

`app/styles/design-system.css`에 설계 문서의 컨테이너, 간격, 모서리, 색상 별칭을 선언하고 `app/root.tsx`에서 `app.css` 다음에 import한다.

- [ ] **Step 4: 계약 테스트 통과 확인**

Run: `../../node_modules/.bin/vitest run tests/unit/design-system-contract.test.ts`
Expected: 2 tests PASS

- [ ] **Step 5: 커밋**

```bash
git add app/styles/design-system.css app/root.tsx tests/unit/design-system-contract.test.ts
git commit -m "2026-08-10 디자인 시스템 토큰 기반 추가"
```

### Task 2: 사용자 핵심 화면 공간 정합성

**Files:**
- Modify: `app/styles/design-system.css`
- Modify: `tests/unit/design-system-contract.test.ts`

**Interfaces:**
- Consumes: `.course-page`, `.discovery-page`, `.member-hub`, `.site-head`, `.site-footer`
- Produces: 세 화면의 동일한 컨테이너 기준선과 사용자 페이지 섹션 리듬

- [ ] **Step 1: 사용자 화면 계약 테스트 추가**

```ts
it("사용자 핵심 화면에 공통 페이지 리듬을 적용한다", () => {
  expect(css).toContain(":where(.course-page,.discovery-page,.member-hub)");
  expect(css).toContain("padding-top:var(--page-start-user)");
  expect(css).toContain("--page-section-gap:var(--space-20)");
});
```

- [ ] **Step 2: 테스트가 공통 선택자 부재로 실패하는지 확인**

Run: `../../node_modules/.bin/vitest run tests/unit/design-system-contract.test.ts`
Expected: FAIL at user page rhythm assertion

- [ ] **Step 3: 사용자 화면 정합성 CSS 구현**

다음을 실제 선택자에 적용한다.

```css
:where(.course-page,.discovery-page,.member-hub){
  width:min(var(--layout-max),calc(100% - (var(--layout-gutter) * 2)));
  margin-inline:auto;
  padding-top:var(--page-start-user);
  padding-inline:0;
  --page-section-gap:var(--space-20);
}
```

추가로 히어로, 조건 카드, 추천 제목, 프로필 활동 영역, 카드 패딩과 모서리를 설계 문서의 토큰으로 맞춘다. 각 화면의 고유한 배치와 컬러는 유지한다.

- [ ] **Step 4: 사용자 계약 및 기존 스타일 계약 통과 확인**

Run: `../../node_modules/.bin/vitest run tests/unit/design-system-contract.test.ts tests/unit/course-filter-style-contract.test.ts tests/unit/place-discovery-style-contract.test.ts tests/unit/me-style-contract.test.ts`
Expected: all tests PASS

- [ ] **Step 5: 커밋**

```bash
git add app/styles/design-system.css tests/unit/design-system-contract.test.ts
git commit -m "2026-08-10 사용자 화면 여백 리듬 통일"
```

### Task 3: 어드민 화면 공간 정합성

**Files:**
- Modify: `app/styles/design-system.css`
- Modify: `tests/unit/design-system-contract.test.ts`

**Interfaces:**
- Consumes: `.admin-candidates`, `.admin-rating-shell`, `.admin-place-operations`, `.admin-reviewers`, `.admin-import`
- Produces: 어드민 공통 최대 폭, 페이지 시작, 섹션 간격, 입력·버튼·표 행 높이

- [ ] **Step 1: 어드민 화면 계약 테스트 추가**

```ts
it("어드민 화면에 공통 밀도 토큰을 적용한다", () => {
  expect(css).toContain("--page-start-admin:var(--space-12)");
  expect(css).toContain("--admin-section-gap:var(--space-12)");
  expect(css).toContain("min-height:var(--control-height-compact)");
});
```

- [ ] **Step 2: 테스트가 어드민 규칙 부재로 실패하는지 확인**

Run: `../../node_modules/.bin/vitest run tests/unit/design-system-contract.test.ts`
Expected: FAIL at admin density assertion

- [ ] **Step 3: 어드민 공통 정합성 CSS 구현**

어드민 페이지 셸, 헤더, 필터, 패널, 테이블 행, 상태 메시지에 공통 토큰을 적용한다. 데스크톱 버튼은 최소 `36px`, 모바일 주요 조작은 최소 `44px`를 보장한다. 기존 의미색과 목록 구조는 유지한다.

- [ ] **Step 4: 계약 테스트 통과 확인**

Run: `../../node_modules/.bin/vitest run tests/unit/design-system-contract.test.ts`
Expected: all tests PASS

- [ ] **Step 5: 커밋**

```bash
git add app/styles/design-system.css tests/unit/design-system-contract.test.ts
git commit -m "2026-08-10 어드민 화면 밀도와 간격 통일"
```

### Task 4: 상시 참조 디자인 가이드

**Files:**
- Create: `docs/design-system/retaste-design-guide.md`
- Modify: `tests/unit/design-system-contract.test.ts`

**Interfaces:**
- Consumes: `app/styles/design-system.css`의 실제 토큰명
- Produces: 새 화면 제작자가 사용하는 브랜드·공간·컴포넌트·반응형 체크리스트

- [ ] **Step 1: 문서 일치 계약 테스트 추가**

```ts
it("디자인 가이드가 실제 핵심 토큰을 참조한다", () => {
  const guide = readFileSync("docs/design-system/retaste-design-guide.md", "utf8");
  ["--layout-max", "--space-20", "--radius-card", "--control-height"].forEach((token) => expect(guide).toContain(token));
});
```

- [ ] **Step 2: 문서 부재로 실패하는지 확인**

Run: `../../node_modules/.bin/vitest run tests/unit/design-system-contract.test.ts`
Expected: FAIL with `ENOENT docs/design-system/retaste-design-guide.md`

- [ ] **Step 3: 디자인 가이드 작성**

가이드에는 브랜드 원칙, 실제 색상값, 폰트 역할, 토큰 표, 사용자·어드민 화면 차이, 카드·버튼·입력·배지·상태 패턴, 반응형 기준, 권장·금지 예시, 새 화면 체크리스트를 한국어로 작성한다.

- [ ] **Step 4: 계약 테스트 통과 확인**

Run: `../../node_modules/.bin/vitest run tests/unit/design-system-contract.test.ts`
Expected: all tests PASS

- [ ] **Step 5: 커밋**

```bash
git add docs/design-system/retaste-design-guide.md tests/unit/design-system-contract.test.ts
git commit -m "2026-08-10 ReTaste 디자인 가이드 문서화"
```

### Task 5: 전체 검증과 시각 목업

**Files:**
- Create: `docs/evidence/2026-08-10-design-system-places-desktop.png`
- Create: `docs/evidence/2026-08-10-design-system-courses-desktop.png`
- Create: `docs/evidence/2026-08-10-design-system-me-desktop.png`
- Create: `docs/evidence/2026-08-10-design-system-admin-desktop.png`
- Create: `docs/evidence/2026-08-10-design-system-mobile.png`
- Create: `design-qa.md`

**Interfaces:**
- Consumes: 로컬 개발 서버와 세 사용자 화면·대표 어드민 화면
- Produces: 같은 뷰포트의 구현 증거와 `final result: passed` 디자인 QA 보고서

- [ ] **Step 1: 전체 자동 검증**

Run:

```bash
pnpm test
pnpm test:integration
pnpm run typecheck
pnpm run build
```

Expected: unit, integration, typecheck, build all PASS

- [ ] **Step 2: 로컬 서버 실행**

Run: `pnpm run dev -- --host 127.0.0.1 --port 5173`
Expected: local React Router server available at `http://127.0.0.1:5173`

- [ ] **Step 3: 데스크톱·모바일 캡처**

`/places`, `/courses`, `/me`, 대표 어드민 목록 화면을 1440px 데스크톱에서 캡처하고, 핵심 사용자 화면을 390px 모바일에서 캡처한다. 인증이 필요한 화면은 기존 테스트 사용자 세션이나 로컬 mock 상태를 사용하며 운영 데이터는 변경하지 않는다.

- [ ] **Step 4: 디자인 QA 반복**

원본 스크린샷과 구현 캡처를 같은 비교 입력으로 열어 타이포그래피, 공간 리듬, 색상, 이미지 품질, 카피를 확인한다. P0/P1/P2를 수정하고 재캡처하여 `design-qa.md`의 `final result`가 `passed`가 될 때까지 반복한다.

- [ ] **Step 5: 최종 커밋**

```bash
git add docs/evidence design-qa.md
git commit -m "2026-08-10 디자인 시스템 시각 검수 증거 추가"
```
