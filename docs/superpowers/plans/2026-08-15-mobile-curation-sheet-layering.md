# 모바일 추천 지도 레이어링 A안 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 모바일 추천 지도의 첫 화면은 70% 높이의 추천 시트로 열고, 추천 행을 선택하면 112px 위치 확인 시트와 선택 장소 지도 포커스로 전환한다.

**Architecture:** 선택 장소는 기존 `selected` URL 검색 파라미터를 계속 단일 기준 원본(SSOT)으로 사용한다. `home.tsx`가 일시적 시트 스냅을 제어하고, `HomeCurationSheet`가 행 클릭 때 이를 `peek`으로 바꾼 뒤 기존 URL 선택을 호출한다. 따라서 URL 이동으로 시트가 재마운트돼도 지도 확인 상태가 유지되고, 기존 `PlaceMap` 효과가 선택 장소를 지도 중심·강조 마커로 바꾼다. CSS는 모바일 미디어쿼리 안의 세 스냅 높이만 조정하며 데스크톱 분할 패널은 건드리지 않는다.

**Tech Stack:** React 19, React Router Framework Mode, TypeScript, CSS, Vitest, Playwright

## Global Constraints

- 선택 장소는 기존 `selected` URL 검색 파라미터를 계속 사용한다.
- 모바일 기본 `half` 스냅은 지도 컨테이너의 70%, `peek`은 112px, `full`은 상단 16px을 남긴다.
- 추천 행 선택은 새 추천 API 요청을 만들지 않는다.
- 데스크톱 `.home-curation-panel` 및 외부 API·데이터베이스·migration·의존성은 변경하지 않는다.
- `prefers-reduced-motion`, native button 키보드 실행, `aria-pressed`, 안전 영역을 보존한다.
- 테스트는 구현 전에 RED를 확인하고, 커밋 메시지는 날짜와 변경 핵심을 포함한다.

---

## 파일 구조

- `app/components/map/HomeCurationSheet.tsx`: 모바일 시트의 선택 이벤트·제어형 스냅 표시만 담당한다.
- `app/routes/home.tsx`: URL 이동을 지나 보존되는 일시적 모바일 시트 스냅을 담당한다.
- `app/styles/design-system.css`: 모바일 세 스냅 높이·안전 영역·시각 전환을 담당한다.
- `tests/unit/home-curation-components.test.ts`: 순수 스냅 상태 전이와 SSR 마크업 계약을 검증한다.
- `tests/unit/home-curation-design.test.ts`: 모바일 CSS 수치와 접근성·모션 계약을 검증한다.
- `tests/e2e/home-curation.spec.ts`: 실제 모바일 탭에서 URL, 시트, QA 지도 마커가 같은 장소로 전환되는지 검증한다.

### Task 1: 장소 선택 스냅 상태 전이

**Files:**
- Modify: `tests/unit/home-curation-components.test.ts:8-15, 123-134`
- Modify: `app/components/map/HomeCurationSheet.tsx:9-34, 67-76`
- Modify: `app/routes/home.tsx:451-495`

**Interfaces:**
- Produces: `homeSheetSnapAfterPlaceSelect(): HomeSheetSnap`, `HomeCurationSheet`의 `snap`/`onSnapChange` props
- Consumes: `HomeCurationPresentationProps.onSelect(placeId: string)`

- [ ] **Step 1: 장소 선택 뒤 `peek`을 요구하는 실패 테스트를 작성한다.**

```ts
import {
  homeSheetSnapAfterDrag,
  homeSheetSnapAfterPlaceSelect,
  HomeCurationSheet,
} from "../../app/components/map/HomeCurationSheet";

it("추천 행을 선택하면 지도 확인용 peek 상태로 접는다", () => {
  expect(homeSheetSnapAfterPlaceSelect()).toBe("peek");
});
```

기존 `homeSheetSnapForSelection("peek", "place-1") === "half"` 테스트는 삭제한다. 그 규칙은 선택 후 시트를 다시 펼쳐 A안을 깨기 때문이다.

- [ ] **Step 2: 실패를 확인한다.**

Run: `pnpm test -- tests/unit/home-curation-components.test.ts`  
Expected: `homeSheetSnapAfterPlaceSelect is not exported`로 FAIL.

- [ ] **Step 3: 최소 구현을 작성한다.**

```tsx
export function homeSheetSnapAfterPlaceSelect(): HomeSheetSnap {
  return "peek";
}

export function HomeCurationSheet(props: HomeCurationPresentationProps & {
  snap: HomeSheetSnap;
  onSnapChange: (snap: HomeSheetSnap) => void;
}) {
  const handlePlaceSelect = (placeId: string) => {
    props.onSnapChange(homeSheetSnapAfterPlaceSelect());
    props.onSelect(placeId);
  };

  return <aside className="home-curation-sheet" data-snap={snap} aria-label="홈 맛집 추천">
    <HomeCurationCards {...props} onSelect={handlePlaceSelect} />
  </aside>;
}
```

`useEffect`와 `homeSheetSnapForSelection`을 제거한다. `home.tsx`에서 `const [sheetSnap, setSheetSnap] = useState<HomeSheetSnap>("half")`를 만들고 `<HomeCurationSheet {...presentationProps} snap={sheetSnap} onSnapChange={setSheetSnap} />`로 전달한다. `returnToCuration`은 `setSheetSnap("half")` 후 기존 URL 전환을 수행한다. URL의 초기 `selected` 값은 시트를 접는 사용자 동작이 아니므로, 초기 상태를 바꾸면 안 된다.

- [ ] **Step 4: GREEN을 확인한다.**

Run: `pnpm test -- tests/unit/home-curation-components.test.ts`  
Expected: PASS.

- [ ] **Step 5: 커밋한다.**

```bash
git add app/components/map/HomeCurationSheet.tsx app/routes/home.tsx tests/unit/home-curation-components.test.ts
git commit -m "2026-08-15 모바일 장소 선택 시트 전환"
```

### Task 2: 70% 기본 시트와 안전 영역 스타일

**Files:**
- Modify: `tests/unit/home-curation-design.test.ts:15-33`
- Modify: `app/styles/design-system.css:405-472`

**Interfaces:**
- Consumes: `data-snap="peek" | "half" | "full"` from `HomeCurationSheet`.
- Produces: mobile A안 CSS contract.

- [ ] **Step 1: A안의 실패 CSS 계약을 작성한다.**

```ts
it("모바일 기본 추천 시트는 70%이고 장소 확인 시트는 112px이다", () => {
  expect(css).toMatch(/\.home-curation-sheet\[data-snap="half"\]\{[\s\S]*--sheet-height:70%/);
  expect(css).toMatch(/\.home-curation-sheet\[data-snap="peek"\]\{[\s\S]*--sheet-height:112px/);
  expect(css).toMatch(/\.home-curation-sheet__body\{[\s\S]*env\(safe-area-inset-bottom\)/);
});
```

- [ ] **Step 2: 실패를 확인한다.**

Run: `pnpm test -- tests/unit/home-curation-design.test.ts`  
Expected: `52%`와 `118px` 현재 값 때문에 FAIL.

- [ ] **Step 3: 최소 CSS를 작성한다.**

```css
@media(max-width:760px){
  .home-curation-sheet{ --sheet-height:70%; }
  .home-curation-sheet[data-snap="peek"]{ --sheet-height:112px; }
  .home-curation-sheet[data-snap="half"]{ --sheet-height:70%; }
  .home-curation-sheet__body{
    padding:0 var(--space-3) calc(var(--space-4) + env(safe-area-inset-bottom));
  }
}
```

`full`의 `calc(100% - var(--space-4))`, 기존 종이 카드 스타일과 `prefers-reduced-motion` 규칙은 유지한다.

- [ ] **Step 4: GREEN을 확인한다.**

Run: `pnpm test -- tests/unit/home-curation-design.test.ts`  
Expected: PASS.

- [ ] **Step 5: 커밋한다.**

```bash
git add app/styles/design-system.css tests/unit/home-curation-design.test.ts
git commit -m "2026-08-15 모바일 추천 시트 높이 보정"
```

### Task 3: 실제 모바일 선택·지도 포커스 QA

**Files:**
- Modify: `tests/e2e/home-curation.spec.ts:120-210`

**Interfaces:**
- Consumes: `.home-curation-sheet[data-snap]`, `.home-curation-card[data-place-id]`, `.map-canvas[data-focused-place]`, `selected` URL 검색 파라미터.
- Produces: A안의 실제 상호작용 회귀 방지.

- [ ] **Step 1: 모바일에서 두 번째 장소를 탭하는 실패 E2E를 추가한다.**

```ts
test("모바일 추천 행 선택은 시트를 접고 같은 장소를 지도 중심으로 삼는다", async ({ page }, testInfo) => {
  test.skip(!isMobileProject(testInfo.project.name), "모바일 전용 레이어링");
  await page.goto("/?qa=1");
  const sheet = page.locator(".home-curation-sheet");
  const secondCard = sheet.locator(".home-curation-card").nth(1);
  const placeId = await secondCard.getAttribute("data-place-id");
  expect(placeId).toBeTruthy();
  await expect(sheet).toHaveAttribute("data-snap", "half");
  await secondCard.click();
  await expect(sheet).toHaveAttribute("data-snap", "peek");
  await expect(page).toHaveURL(new RegExp(`selected=${placeId}`));
  await expect(page.locator(".map-canvas")).toHaveAttribute("data-focused-place", placeId!);
});
```

- [ ] **Step 2: RED를 확인한다.**

Run: `pnpm exec playwright test tests/e2e/home-curation.spec.ts --project=mobile-chromium`  
Expected: 현재 선택 뒤 `data-snap="half"`가 남아 FAIL.

- [ ] **Step 3: Task 1·2 구현이 실제 E2E를 만족하는지 확인하고 필요한 최소 선택자 안정화만 한다.**

`HomeCurationSheet`의 `props.onSelect(placeId)`는 `home.tsx`의 `setSearch({ selected: id })`로 연결되고, `PlaceMap`은 `data-focused-place={selected}`를 렌더하므로 별도 데이터 요청·라우트 변경을 추가하지 않는다.

- [ ] **Step 4: GREEN을 확인한다.**

Run: `pnpm exec playwright test tests/e2e/home-curation.spec.ts --project=chromium --project=mobile-chromium`  
Expected: desktop·mobile 모두 PASS; desktop은 기존 좌측 패널을 계속 사용한다.

- [ ] **Step 5: 시각 증거와 최종 검증을 남긴다.**

Run:

```bash
pnpm test -- tests/unit/home-curation-components.test.ts tests/unit/home-curation-design.test.ts
pnpm run typecheck
pnpm exec playwright test tests/e2e/home-curation.spec.ts --project=chromium --project=mobile-chromium
git diff --check
```

Expected: 모두 PASS. `HOME_CURATION_EVIDENCE=1`로 데스크톱·모바일 스크린샷을 생성해 PR에 첨부한다.

- [ ] **Step 6: 커밋한다.**

```bash
git add tests/e2e/home-curation.spec.ts docs/evidence/2026-08-15-mobile-curation-sheet-*.png
git commit -m "2026-08-15 모바일 추천 지도 선택 QA"
```

### Task 4: PR·배포 준비

**Files:**
- Modify: 없음 (GitHub PR 본문)

- [ ] **Step 1: 최신 `origin/main`을 반영했는지 확인한다.**

Run: `git fetch origin && git log --oneline HEAD..origin/main`  
Expected: 출력이 없거나 새 main 커밋을 안전히 병합한 상태.

- [ ] **Step 2: 브랜치를 push하고 PR을 만든다.**

```bash
git push origin codex/mobile-curation-sheet
gh pr create --base main --head codex/mobile-curation-sheet --title "2026-08-15 모바일 추천 지도 레이어링 A안"
```

PR 본문에는 이슈 #124, 변경 파일, 모바일/데스크톱 검증, 운영 영향 없음, 개인정보·비용 영향 없음, PR revert 롤백, 스크린샷 증거를 명시한다.

- [ ] **Step 3: PR 체크와 diff를 검토한다.**

Run: `gh pr checks <PR번호> --watch && gh pr diff <PR번호>`  
Expected: required checks PASS, CSS가 모바일 범위에만 영향을 준다.

- [ ] **Step 4: 승인된 PR만 squash merge 후 배포한다.**

```bash
gh pr merge <PR번호> --squash --delete-branch
git checkout main && git pull --ff-only origin main
pnpm run deploy
```

Expected: merge와 production deploy가 모두 성공. 배포 뒤 `/`의 모바일·데스크톱 smoke를 다시 확인한다.

### Task 5: URL 선택 뒤에도 시트 스냅 유지

**Files:**
- Modify: `tests/unit/home-curation-components.test.ts:8-15, 82-96, 123-134`
- Modify: `app/components/map/HomeCurationSheet.tsx:9-70`
- Modify: `app/routes/home.tsx:1-30, 420-500`

**Interfaces:**
- Produces: `HomeCurationSheetProps = HomeCurationPresentationProps & { snap: HomeSheetSnap; onSnapChange(snap: HomeSheetSnap): void }`
- Consumes: `HomeSheetSnap` from `HomeCurationSheet` and existing `setSearch({ selected: id })` route callback.

- [ ] **Step 1: 제어형 시트 계약의 실패 단위 테스트를 작성한다.**

```ts
it("시트는 라우트가 전달한 현재 스냅을 렌더한다", () => {
  const html = renderToStaticMarkup(createElement(HomeCurationSheet, {
    ...props,
    snap: "peek",
    onSnapChange: vi.fn(),
  }));
  expect(html).toContain('data-snap="peek"');
});
```

기존 `HomeCurationSheet` 렌더용 fixture에도 `snap: "half"`와 `onSnapChange: vi.fn()`을 넣는다.

- [ ] **Step 2: 실패를 확인한다.**

Run: `node_modules/.bin/vitest run tests/unit/home-curation-components.test.ts`  
Expected: 현재 `HomeCurationSheet` props에 `snap`이 없고, 전달값을 무시하므로 `data-snap="peek"` 계약이 FAIL.

- [ ] **Step 3: 라우트 제어형 최소 구현을 작성한다.**

```tsx
// HomeCurationSheet.tsx
export type HomeCurationSheetProps = HomeCurationPresentationProps & {
  snap: HomeSheetSnap;
  onSnapChange: (snap: HomeSheetSnap) => void;
};

export function HomeCurationSheet({ snap, onSnapChange, ...props }: HomeCurationSheetProps) {
  const handlePlaceSelect = (placeId: string) => {
    onSnapChange(homeSheetSnapAfterPlaceSelect());
    props.onSelect(placeId);
  };
  // 손잡이의 setSnap(...)은 onSnapChange(...)로 바꾼다.
}

// home.tsx
const [homeSheetSnap, setHomeSheetSnap] = useState<HomeSheetSnap>("half");
const returnToCuration = () => {
  setHomeSheetSnap("half");
  // 기존 추천 지도 URL 전환을 이어서 실행한다.
};
// 기존 presentationProps는 데스크톱 패널에 그대로 쓴다.
// 모바일에만 아래 props를 전달한다.
<HomeCurationSheet {...presentationProps} snap={homeSheetSnap} onSnapChange={setHomeSheetSnap} />
```

`HomeCurationSheet`의 로컬 `useState`와 선택 감시 `useEffect`는 제거한다. `home.tsx`의 상태가 URL 파라미터 변경 뒤에도 살아 있으므로, 시트가 재마운트돼도 방금 선택한 `peek`을 유지한다.

- [ ] **Step 4: GREEN을 확인한다.**

Run: `node_modules/.bin/vitest run tests/unit/home-curation-components.test.ts`  
Expected: PASS.

- [ ] **Step 5: 커밋한다.**

```bash
git add app/components/map/HomeCurationSheet.tsx app/routes/home.tsx tests/unit/home-curation-components.test.ts
git commit -m "2026-08-15 모바일 시트 선택 상태 유지"
```

### Task 6: 선택 확인·전환 복원 UX를 보강한다

**Files:**
- Modify: `tests/unit/home-curation-components.test.ts`
- Modify: `tests/e2e/home-curation.spec.ts`
- Modify: `app/components/map/HomeCurationSheet.tsx`
- Modify: `app/routes/home.tsx`
- Modify: `app/styles/design-system.css`
- Modify: `docs/superpowers/specs/2026-08-15-mobile-curation-sheet-layering-design.md`
- Modify: `docs/superpowers/plans/2026-08-15-mobile-curation-sheet-layering.md`

- [ ] **Step 1: 실패하는 단위·E2E 계약을 먼저 추가한다.**

모바일 추천 카드를 선택하면 `peek` 시트 안에 선택된 장소의 순위와 상호명이 보이고, 키보드로 선택한 뒤 포커스가 시트 손잡이로 옮겨야 한다. 기존 모바일 동기화 E2E는 카드 선택 뒤 `peek`을 먼저 확인하고, 다시 펼친 뒤 드래그 동작을 검증한다. 지도 마커를 선택해도 현재 `peek` 상태는 바뀌지 않아야 한다.

또한 추천 지도에서 전체 지도로 갔다가 브라우저 전환 또는 추천 지도 복귀로 `curated` 뷰가 되면, 시트는 항상 `half`로 초기화되어야 한다.

- [ ] **Step 2: 실패를 확인한다.**

Run:

```bash
node_modules/.bin/vitest run tests/unit/home-curation-components.test.ts
BASE_URL=http://127.0.0.1:<port> node_modules/.bin/playwright test tests/e2e/home-curation.spec.ts --project=mobile-chromium --grep '모바일'
```

Expected: 현재 `peek`에는 선택 장소 정보가 없고, 카드 선택 뒤 숨겨지는 버튼의 포커스 이전과 오래된 `half` 기대값이 계약을 만족하지 않아 FAIL.

- [ ] **Step 3: 최소 구현을 작성한다.**

`HomeCurationSheet`는 `peek`일 때 선택된 장소의 `rank`와 `name`을 시트 상단에 짧게 보여 주고, 장소 선택 뒤 `requestAnimationFrame`으로 손잡이 버튼에 포커스를 옮긴다. `112px` 시트 높이 안에서 장소 확인 정보가 항상 보이되, 목록 본문은 계속 숨긴다.

`home.tsx`는 이전 뷰를 추적해 `browse → curated` 전환에서도 `homeSheetSnap`을 `half`로 되돌린다. 지도 마커 선택은 선택 URL만 바꾸고 스냅을 강제로 변경하지 않는다.

`home-curation.spec.ts`의 기존 카드·marker 시나리오는 위 계약에 맞게 갱신한다. loopback `BASE_URL`에서 실제 실행되고 외부 URL에서는 계속 skip되어야 한다.

- [ ] **Step 4: GREEN을 확인한다.**

Run:

```bash
node_modules/.bin/vitest run tests/unit/home-curation-components.test.ts tests/unit/home-curation-route.test.ts
BASE_URL=http://127.0.0.1:<port> node_modules/.bin/playwright test tests/e2e/home-curation.spec.ts --project=chromium --project=mobile-chromium --grep '모바일'
pnpm run typecheck
git diff --check
```

Expected: 선택 확인·포커스·전환 복원·마커 상태 보존의 테스트가 통과하고 데스크톱 동작은 바뀌지 않는다.

- [ ] **Step 5: 문서 정합성과 커밋을 확인한다.**

선택 후 `peek`이 단순한 접힘이 아니라 선택 장소를 보여 주는 위치 확인 상태임을 설계 문서에 반영한다. 새 문서의 trailing whitespace를 제거한 뒤 다음 메시지로 커밋한다.

```bash
git add app/components/map/HomeCurationSheet.tsx app/routes/home.tsx app/styles/design-system.css tests/unit/home-curation-components.test.ts tests/e2e/home-curation.spec.ts docs/superpowers/specs/2026-08-15-mobile-curation-sheet-layering-design.md docs/superpowers/plans/2026-08-15-mobile-curation-sheet-layering.md
git commit -m "2026-08-15 모바일 선택 확인 UX 보강"
```
