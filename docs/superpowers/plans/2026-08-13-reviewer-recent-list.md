# 리뷰어 최근 발행 리스트 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 리뷰어 최근 발행을 카드 레일이 아닌 간결한 리스트로 제공하고, 장소명은 기존 상세로 연결한다.

**Architecture:** `ReviewerVisitFlow`가 기존 loader의 `history` 데이터를 그대로 리스트 행으로 렌더링한다. 사진이 있는 행만 첫 공개 사진 썸네일을 렌더링하고, `Link`를 통해 기존 장소 상세 경로로 이동한다. 스타일은 기존 리뷰어 토큰 안에서 리스트 밀도와 모바일 한 열 규칙만 정의한다.

**Tech Stack:** React Router Framework Mode, React, TypeScript, CSS, Vitest, Playwright.

## Global Constraints

- DB·R2·환경 변수·외부 서비스·의존성 변경을 하지 않는다.
- 최근 발행 항목 전체를 클릭 가능한 컨트롤로 만들지 않고 장소명 링크만 제공한다.
- 사진 수는 실제 `photos.length`에서 계산한다.
- 테스트를 먼저 작성하고 실패를 확인한 뒤 최소 구현한다.

---

### Task 1: 최근 발행 리스트 렌더링

**Files:**
- Modify: `app/components/reviewer-visit-flow.tsx`
- Modify: `app/features/ratings/reviewer-visit.server.ts`
- Test: `tests/e2e/reviewer-photo-upload.spec.ts`

**Interfaces:**
- Consumes: `ReviewerHistory`의 `placeName`, `placeSlug`, `placeId`, `categoryName`, `evaluation`, `badgesJson`, `photos`, `goldenPickEventId`, `publishedAt`.
- Produces: `.reviewer-history-list`, `.reviewer-history-row`, `.reviewer-history-place-link` DOM 계약.

- [x] **Step 1: 실패하는 E2E 테스트 작성**

```ts
await expect(page.locator(".reviewer-history-list")).toBeVisible();
const row = page.locator(".reviewer-history-row").first();
await expect(row.locator(".reviewer-history-place-link")).toHaveAttribute("href", /^\\/places\\//);
await expect(page.locator(".reviewer-history-rail")).toHaveCount(0);
```

- [x] **Step 2: 테스트가 현재 카드 레일 때문에 실패하는지 확인**

Run: `pnpm exec playwright test tests/e2e/reviewer-photo-upload.spec.ts --project=chromium`

Expected: FAIL because `.reviewer-history-list` is absent.

- [x] **Step 3: 최소 렌더링 구현**

```tsx
<div className="reviewer-history-list">
  {history.map((review) => (
    <article className="reviewer-history-row" key={review.id}>
      <Link className="reviewer-history-place-link" to={`/places/${review.placeSlug}`}>
        {review.placeName}
      </Link>
    </article>
  ))}
</div>
```

`ReviewerHistory`에 loader가 제공할 `placeSlug`을 포함하고, 사진·배지·Golden Pick·날짜를 해당 행의 보조 정보로 출력한다.

- [x] **Step 4: E2E 테스트가 통과하는지 확인**

Run: `pnpm exec playwright test tests/e2e/reviewer-photo-upload.spec.ts --project=chromium`

Expected: PASS.

### Task 2: 리스트 밀도와 모바일 레이아웃

**Files:**
- Modify: `app/app.css`
- Test: `tests/e2e/reviewer-photo-upload.spec.ts`

**Interfaces:**
- Consumes: Task 1의 `.reviewer-history-list`, `.reviewer-history-row`, `.reviewer-history-place-link`.
- Produces: 44px 이상의 링크 터치 영역과 모바일 한 열 레이아웃.

- [x] **Step 1: 실패하는 스타일·키보드 E2E 테스트 작성**

```ts
const placeLink = page.locator(".reviewer-history-place-link").first();
await expect(placeLink).toHaveCSS("cursor", "pointer");
await placeLink.focus();
await page.keyboard.press("Enter");
await expect(page).toHaveURL(/\\/places\\//);
```

- [x] **Step 2: 현재 구현에서 실패하는지 확인**

Run: `pnpm exec playwright test tests/e2e/reviewer-photo-upload.spec.ts --project=Pixel-7`

Expected: FAIL because the list-link selector is absent.

- [x] **Step 3: 최소 CSS 구현**

```css
.reviewer-history-list { display:grid; gap:8px; }
.reviewer-history-row { display:grid; grid-template-columns:auto minmax(0,1fr) auto; }
.reviewer-history-place-link { min-height:44px; display:inline-flex; align-items:center; }
@media (max-width:560px) { .reviewer-history-row { grid-template-columns:minmax(0,1fr) auto; } }
```

사진 썸네일은 44px 정사각형으로 제한하고, 배지·Golden Pick·날짜는 기존 색 토큰으로 조용하게 표시한다.

- [x] **Step 4: 모바일 E2E와 변경 범위 타입 검증**

Run: `pnpm exec playwright test tests/e2e/reviewer-photo-upload.spec.ts --project=Pixel-7 && pnpm run typecheck`

Expected: PASS.

### Task 3: 회귀 검증과 인수인계

**Files:**
- Modify: `docs/superpowers/specs/2026-08-13-reviewer-recent-list-design.md`
- Modify: `docs/superpowers/plans/2026-08-13-reviewer-recent-list.md`

- [x] **Step 1: 전체 관련 테스트 실행**

Run: `pnpm test -- tests/unit/reviewer-photo-client.test.ts && pnpm run test:integration -- tests/integration/reviewer-ratings-route.test.ts && pnpm exec playwright test tests/e2e/reviewer-photo-upload.spec.ts`

Expected: PASS.

- [x] **Step 2: 변경 검토**

Run: `git diff --check && git status --short`

Expected: whitespace error 없음, 의도한 파일만 변경.

- [ ] **Step 3: 커밋과 Pull Request 갱신**

```bash
git add app/components/reviewer-visit-flow.tsx app/app.css tests/e2e/reviewer-photo-upload.spec.ts docs/superpowers
git commit -m "2026-08-13 리뷰어 최근 발행 리스트 개선"
git push
```

Draft PR에 데스크톱·모바일 증거, 검증 결과, 운영 영향 없음과 rollback 방식을 기록한다.

## 자체 검토

- 범위는 리뷰어 발행 UI와 회귀 테스트로 한정돼 있으며 새 데이터·서비스가 없다.
- 모든 요구사항(작은 리스트, 장소 상세 링크, 사진·Golden Pick·날짜 정보, 바텀시트 없음, 모바일)을 Task 1~2가 다룬다.
- `TBD`, `TODO`, 모호한 후속 작업 표기가 없다.
