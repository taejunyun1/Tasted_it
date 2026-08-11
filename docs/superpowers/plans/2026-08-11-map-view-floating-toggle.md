# 지도 보기 전환 플로팅 버튼 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 추천 지도와 전체 지도 사이의 전환 버튼을 지도 중앙 상단의 하나의 공통 플로팅 버튼으로 통일한다.

**Architecture:** `home.tsx`가 현재 보기 상태에 따라 공통 버튼의 문구와 핸들러를 선택한다. 추천 패널과 모바일 시트는 추천 내용만 담당하도록 전환 책임을 제거하고, 공통 CSS 클래스가 데스크톱·모바일의 위치와 표현을 함께 제어한다.

**Tech Stack:** React 19, React Router 8 Framework Mode, TypeScript, CSS, Vitest, Playwright

## Global Constraints

- 추천 지도에서는 지도 중앙 상단에 `전체 지도` 버튼을 표시한다.
- 전체 지도에서는 같은 위치와 스타일로 `추천 지도` 버튼을 표시한다.
- 추천 패널과 모바일 추천 시트 내부의 기존 `전체 지도` 버튼은 제거한다.
- 지도 위에는 보기 전환 버튼을 한 개만 표시한다.
- 기존 URL 상태 보존 규칙, 추천 알고리즘, D1 스키마, 환경 변수는 변경하지 않는다.
- 지도 재추천 버튼과 보기 전환 버튼은 서로 겹치지 않는다.
- GitHub Issue #81의 소유 파일 외에는 수정하지 않는다.

---

### Task 1: 공통 지도 전환 버튼 계약과 라우트 연결

**Files:**
- Modify: `tests/unit/home-curation-components.test.ts`
- Modify: `tests/unit/home-curation-route.test.ts`
- Modify: `app/components/map/HomeCurationCards.tsx`
- Modify: `app/components/map/HomeCurationPanel.tsx`
- Modify: `app/components/map/HomeCurationSheet.tsx`
- Modify: `app/routes/home.tsx`

**Interfaces:**
- Consumes: 기존 `browseAll(): void`, `returnToCuration(): void`, `isCurated: boolean`
- Produces: 지도 영역 안의 단일 `.home-curation-view-toggle` 버튼. 문구는 `isCurated ? "전체 지도" : "추천 지도"`이고 핸들러는 `isCurated ? browseAll : returnToCuration`이다.

- [ ] **Step 1: 패널·시트 중복 버튼 제거를 요구하는 실패 테스트 작성**

`tests/unit/home-curation-components.test.ts`의 공통 계약 테스트를 다음처럼 바꾼다.

```tsx
it("데스크톱 패널과 모바일 시트는 추천 내용만 공유하고 지도 전환 버튼을 갖지 않는다", () => {
  const panel = renderToStaticMarkup(createElement(HomeCurationPanel, props));
  const sheet = renderToStaticMarkup(createElement(HomeCurationSheet, props));

  expect(panel).toContain("지금 갈 만한 5곳");
  expect(sheet).toContain("지금 갈 만한 5곳");
  expect(panel).toContain("내 취향");
  expect(panel).not.toContain("전체 지도");
  expect(sheet).not.toContain("전체 지도");
  expect(sheet).toContain('data-snap="half"');
});
```

- [ ] **Step 2: 라우트의 단일 양방향 버튼을 요구하는 실패 테스트 작성**

`tests/unit/home-curation-route.test.ts`의 소스 계약에 아래 검증을 추가한다.

```ts
expect(source).toContain('className="home-curation-view-toggle"');
expect(source).toContain('isCurated ? "전체 지도" : "추천 지도"');
expect(source).toContain("isCurated ? browseAll : returnToCuration");
expect(source.match(/home-curation-view-toggle/g)).toHaveLength(1);
```

- [ ] **Step 3: 테스트를 실행해 현재 구조에서 실패하는지 확인**

Run:

```bash
pnpm exec vitest run tests/unit/home-curation-components.test.ts tests/unit/home-curation-route.test.ts
```

Expected: 패널·시트에 `전체 지도`가 남아 있고 공통 클래스가 없어 FAIL.

- [ ] **Step 4: 추천 프레젠테이션에서 전환 책임 제거**

`app/components/map/HomeCurationCards.tsx`의 타입에서 아래 필드를 제거한다.

```ts
onBrowse: () => void;
```

`app/components/map/HomeCurationPanel.tsx`의 footer는 반경 정보만 표시한다.

```tsx
<footer className="home-curation-footer">
  <span>{props.page.radiusMeters / 1_000}km 안에서 추천</span>
</footer>
```

`app/components/map/HomeCurationSheet.tsx`에서 아래 버튼을 삭제한다.

```tsx
<button type="button" className="home-curation-browse" onClick={props.onBrowse}>전체 지도</button>
```

테스트 fixture `props`에서도 `onBrowse`를 제거한다.

- [ ] **Step 5: 지도 영역에 공통 전환 버튼 하나 연결**

`app/routes/home.tsx`의 `presentationProps`에서 `onBrowse: browseAll`을 제거한다. 지도 영역의 기존 조건부 `추천 지도` 버튼을 다음 단일 버튼으로 교체한다.

```tsx
<button
  type="button"
  className="home-curation-view-toggle"
  onClick={isCurated ? browseAll : returnToCuration}
>
  {isCurated ? "전체 지도" : "추천 지도"}
</button>
```

- [ ] **Step 6: 집중 단위 테스트와 타입 검사 실행**

Run:

```bash
pnpm exec vitest run tests/unit/home-curation-components.test.ts tests/unit/home-curation-route.test.ts
pnpm run typecheck
```

Expected: 두 테스트 파일과 타입 검사 PASS.

- [ ] **Step 7: Task 1 커밋**

```bash
git add app/components/map/HomeCurationCards.tsx app/components/map/HomeCurationPanel.tsx app/components/map/HomeCurationSheet.tsx app/routes/home.tsx tests/unit/home-curation-components.test.ts tests/unit/home-curation-route.test.ts
git commit -m "2026-08-11 지도 보기 전환 버튼 공통화"
```

---

### Task 2: 공통 플로팅 스타일과 양방향 브라우저 검증

**Files:**
- Modify: `tests/unit/home-curation-design.test.ts`
- Modify: `app/styles/design-system.css`
- Modify: `tests/e2e/home-curation.spec.ts`
- Modify: `tests/e2e/browse.spec.ts`

**Interfaces:**
- Consumes: Task 1의 `.home-curation-view-toggle` 버튼과 기존 `.home-curation-reload-area`
- Produces: 데스크톱·모바일 공통 중앙 상단 배치와 `전체 지도 → 추천 지도 → 전체 지도` 브라우저 계약

- [ ] **Step 1: 공통 스타일과 겹침 방지를 요구하는 실패 테스트 작성**

`tests/unit/home-curation-design.test.ts`에 아래 테스트를 추가한다.

```ts
it("보기 전환 버튼은 공통 플로팅 스타일을 쓰고 재추천 버튼과 겹치지 않는다", () => {
  expect(css).toContain(".home-curation-view-toggle");
  expect(css).toMatch(/\.home-curation-view-toggle\{[\s\S]*position:absolute[\s\S]*left:50%/);
  expect(css).toMatch(/\.home-curation-reload-area\{[\s\S]*top:calc\(/);
  expect(css).not.toContain(".home-curation-browse");
  expect(css).not.toContain(".home-curation-return");
});
```

- [ ] **Step 2: 디자인 테스트를 실행해 실패 확인**

Run:

```bash
pnpm exec vitest run tests/unit/home-curation-design.test.ts
```

Expected: `.home-curation-view-toggle`이 없어 FAIL.

- [ ] **Step 3: CSS를 공통 클래스 중심으로 정리**

`app/styles/design-system.css`에서 `.home-curation-browse`, `.home-curation-return` 선택자를 제거하고 공통 버튼을 기본 버튼 그룹에 포함한다.

```css
.home-curation-locate,
.home-curation-footer button,
.home-curation-reload-area,
.home-curation-view-toggle{
  min-height:var(--control-height);
  border:1px solid var(--color-accent);
  border-radius:var(--radius-pill);
  color:var(--color-accent);
  background:var(--surface-card);
  font-weight:750;
}

.home-curation-view-toggle{
  position:absolute;
  z-index:7;
  top:var(--space-4);
  left:50%;
  padding:0 var(--space-5);
  box-shadow:0 8px 24px rgba(23,34,28,.16);
  transform:translateX(-50%);
}

.home-curation-reload-area{
  position:absolute;
  z-index:7;
  top:calc(var(--space-4) + var(--control-height) + var(--space-2));
  left:50%;
  padding:0 var(--space-5);
  box-shadow:0 8px 24px rgba(23,34,28,.16);
  transform:translateX(-50%);
}
```

모바일 규칙은 두 플로팅 버튼에 같은 축소 여백을 적용한다.

```css
@media(max-width:760px){
  .home-curation-view-toggle{
    top:var(--space-3);
    min-height:var(--control-height);
  }

  .home-curation-reload-area{
    top:calc(var(--space-3) + var(--control-height) + var(--space-2));
    min-height:var(--control-height);
  }
}
```

- [ ] **Step 4: 브라우저 테스트를 지도 플로팅 버튼 기준으로 변경**

`tests/e2e/home-curation.spec.ts`에서 패널 내부 버튼 탐색을 페이지 전역 공통 버튼으로 바꾸고 왕복을 검증한다.

```ts
await page.getByRole("button", { name: "전체 지도", exact: true }).click();
await expect(page.getByRole("button", { name: "추천 지도", exact: true })).toBeVisible();
await expect(page.locator(".map-explorer-panel")).toBeVisible();

await page.getByRole("button", { name: "추천 지도", exact: true }).click();
await expect(page.getByRole("button", { name: "전체 지도", exact: true })).toBeVisible();
await expect(presentation).toBeVisible();
await expect(presentation.getByRole("button", { name: "내 취향" })).toHaveAttribute("aria-pressed", "true");
```

`tests/e2e/browse.spec.ts`도 첫 전환을 페이지 전역 버튼으로 변경한다.

```ts
await page.getByRole("button", { name: "전체 지도", exact: true }).click();
```

- [ ] **Step 5: 집중 테스트와 브라우저 테스트 실행**

Run:

```bash
pnpm exec vitest run tests/unit/home-curation-design.test.ts tests/unit/home-curation-components.test.ts tests/unit/home-curation-route.test.ts
pnpm exec playwright test tests/e2e/home-curation.spec.ts tests/e2e/browse.spec.ts
```

Expected: Vitest PASS. Playwright desktop/mobile PASS.

- [ ] **Step 6: 전체 검증 실행**

Run:

```bash
pnpm test
pnpm run test:integration
pnpm run typecheck
pnpm run build
git diff --check origin/main...HEAD
```

Expected: 단위·통합·타입·빌드·차이 검사 PASS. 전체 E2E에서 기존 기준선 지도 줌 2건 외 새 실패 없음.

- [ ] **Step 7: Task 2 커밋**

```bash
git add app/styles/design-system.css tests/unit/home-curation-design.test.ts tests/e2e/home-curation.spec.ts tests/e2e/browse.spec.ts
git commit -m "2026-08-11 지도 전환 플로팅 디자인 통일"
```

---

### Task 3: 시각 증거와 Pull Request 준비

**Files:**
- No source changes expected
- Generate: Playwright desktop/mobile screenshots under `test-results/` (ignored artifacts)

**Interfaces:**
- Consumes: Task 2의 양방향 전환 UI
- Produces: Issue #81과 PR에 첨부할 데스크톱·모바일 검증 결과

- [ ] **Step 1: 화면 증거 생성**

Run:

```bash
HOME_CURATION_EVIDENCE=1 pnpm exec playwright test tests/e2e/home-curation.spec.ts
```

Expected: 데스크톱과 모바일 스크린샷 생성, 테스트 PASS.

- [ ] **Step 2: 작업 상태와 변경 범위 확인**

Run:

```bash
git status --short
git diff --stat origin/main...HEAD
git log --oneline origin/main..HEAD
```

Expected: 추적되지 않은 소스 변경 없음. 설계·구현·테스트 커밋만 표시.

- [ ] **Step 3: 브랜치 푸시와 PR 본문 준비**

PR 본문에 다음을 기록한다.

```markdown
## 변경 범위
- 추천 지도와 전체 지도의 전환 버튼을 지도 중앙 상단 공통 플로팅 버튼으로 통일
- 패널·모바일 시트 내부 중복 버튼 제거

## 검증
- 단위·통합·타입·빌드 통과
- 데스크톱·모바일 양방향 전환 통과

## 운영 영향
- DB·migration·환경 변수 변경 없음

## 남은 위험
- 기존 main 기준 지도 줌 E2E 2건은 별도 기준선 이슈
```
