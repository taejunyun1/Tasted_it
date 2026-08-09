# 나의 취향 허브 리디자인 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 기존 기능을 보존하면서 `/me`를 취향 신호·학습 상태·저장·평가 기록이 우선 보이는 반응형 개인화 허브로 리디자인한다.

**Architecture:** 취향 뱃지 선택 규칙은 순수 함수로 분리하고, 페이지 섹션은 `app/components/me`의 세 컴포넌트로 나눈다. React Router loader/action은 기존 서버 동작을 유지하며 화면에 필요한 데이터만 컴포넌트에 전달한다.

**Tech Stack:** React 19, React Router 8 Framework Mode, TypeScript, Tailwind CSS 4 + `app/app.css`, Vitest, Playwright

## Global Constraints

- 브랜치와 worktree는 `tj_me-redesign`과 `.worktrees/tj_me-redesign`을 사용한다.
- 색상은 `#FAFAF8`, `#14251C`, `#22543D`, `#E7FF55`, `#EDF4ED`, `#FFFFFF`, `#CDD4CC`를 사용한다.
- 글꼴은 `SUIT`, `Pretendard`, `Apple SD Gothic Neo`, `Noto Sans KR`, system-ui와 `IBM Plex Mono`를 사용한다.
- Flavor Print 값에서 의미를 임의 추론하지 않고 `{key} {value.toFixed(1)}`로 표시한다.
- `VISIBLE` 상태의 상위 3개만 대표 뱃지로 표시하며 첫 번째만 라임색으로 강조한다.
- `LEARNING` 상태에서는 임의 취향 뱃지를 만들지 않는다.
- 기존 저장 해제, 네이버 연결·해제, 리뷰어 신청 링크를 보존한다.
- 아직 구현되지 않은 계정 동작은 버튼이나 링크로 노출하지 않는다.
- 데스크톱 `1440×1000`, 모바일 `390×844`에서 검증한다.

---

### Task 1: 취향 신호 선택 규칙

**Files:**
- Create: `app/features/members/taste-signals.ts`
- Create: `tests/unit/taste-signals.test.ts`

**Interfaces:**
- Consumes: `getMemberTasteGraph`가 반환하는 `status`, `placeCount`, `dimensions`
- Produces: `selectTasteSignals(graph): TasteSignalSummary`

- [ ] **Step 1: 실패하는 단위 테스트 작성**

```ts
import { describe, expect, it } from "vitest";
import { selectTasteSignals } from "../../app/features/members/taste-signals";

describe("selectTasteSignals", () => {
  it("값이 높은 순으로 최대 세 개의 실제 취향 신호를 고른다", () => {
    expect(selectTasteSignals({
      status: "VISIBLE",
      placeCount: 7,
      dimensions: [
        { key: "식감", value: 3.8 },
        { key: "감칠맛", value: 4.42 },
        { key: "향신료", value: 2.9 },
        { key: "국물 농도", value: 4.1 },
      ],
    })).toMatchObject({
      status: "VISIBLE",
      signals: [
        { key: "감칠맛", value: 4.42, label: "감칠맛 4.4" },
        { key: "국물 농도", value: 4.1, label: "국물 농도 4.1" },
        { key: "식감", value: 3.8, label: "식감 3.8" },
      ],
    });
  });

  it("학습 중에는 추정 취향 대신 진행 상태만 반환한다", () => {
    expect(selectTasteSignals({ status: "LEARNING", placeCount: 3, dimensions: [] })).toEqual({
      status: "LEARNING",
      placeCount: 3,
      requiredPlaceCount: 5,
      signals: [],
    });
  });
});
```

- [ ] **Step 2: 테스트가 모듈 부재로 실패하는지 확인**

Run: `pnpm test tests/unit/taste-signals.test.ts`
Expected: FAIL with `Cannot find module '../../app/features/members/taste-signals'`

- [ ] **Step 3: 최소 구현 작성**

```ts
export type TasteGraph =
  | { status: "LEARNING"; placeCount: number; dimensions: Array<{ key: string; value: number }> }
  | { status: "VISIBLE"; placeCount: number; dimensions: Array<{ key: string; value: number }> };

export function selectTasteSignals(graph: TasteGraph) {
  if (graph.status === "LEARNING") {
    return { status: "LEARNING" as const, placeCount: graph.placeCount, requiredPlaceCount: 5, signals: [] };
  }
  return {
    status: "VISIBLE" as const,
    placeCount: graph.placeCount,
    signals: [...graph.dimensions]
      .sort((left, right) => right.value - left.value || left.key.localeCompare(right.key, "ko"))
      .slice(0, 3)
      .map(({ key, value }) => ({ key, value, label: `${key} ${value.toFixed(1)}` })),
  };
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `pnpm test tests/unit/taste-signals.test.ts`
Expected: 2 tests passed

- [ ] **Step 5: 커밋**

```bash
git add app/features/members/taste-signals.ts tests/unit/taste-signals.test.ts
git commit -m "2026-08-09 나의 취향 신호 선택 규칙 추가"
```

---

### Task 2: 취향 신호와 활동 카드 컴포넌트

**Files:**
- Create: `app/components/me/TasteSignals.tsx`
- Create: `app/components/me/ActivityCollection.tsx`
- Create: `app/components/me/AccountConnections.tsx`
- Create: `tests/unit/me-components.test.tsx`

**Interfaces:**
- Consumes: `TasteGraph`, 장소 ReactNode, 네이버 연결 상태
- Produces: `TasteSignals`, `ActivityCollection`, `AccountConnections`

- [ ] **Step 1: 실패하는 렌더링 테스트 작성**

```tsx
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { TasteSignals } from "../../app/components/me/TasteSignals";
import { ActivityCollection } from "../../app/components/me/ActivityCollection";

describe("me components", () => {
  it("대표 취향은 목록과 첫 번째 강조 상태로 렌더링한다", () => {
    const html = renderToStaticMarkup(<TasteSignals graph={{
      status: "VISIBLE", placeCount: 6,
      dimensions: [{ key: "감칠맛", value: 4.4 }, { key: "식감", value: 4.1 }],
    }} />);
    expect(html).toContain("나의 취향 신호");
    expect(html).toContain("감칠맛 4.4");
    expect(html).toContain('data-primary="true"');
    expect(html).toContain("meter");
  });

  it("학습 중에는 진행도와 다음 행동을 렌더링한다", () => {
    const html = renderToStaticMarkup(<TasteSignals graph={{ status: "LEARNING", placeCount: 2, dimensions: [] }} />);
    expect(html).toContain("취향 학습 중 2/5");
    expect(html).toContain("맛집 둘러보기");
    expect(html).not.toContain("data-primary");
  });

  it("활동이 없으면 개수와 다음 행동을 함께 안내한다", () => {
    const html = renderToStaticMarkup(<ActivityCollection title="저장한 장소" count={0} emptyText="다시 보고 싶은 장소를 저장해 보세요." emptyHref="/places">{null}</ActivityCollection>);
    expect(html).toContain("저장한 장소");
    expect(html).toContain("0곳");
    expect(html).toContain('href="/places"');
  });
});
```

- [ ] **Step 2: 컴포넌트 부재로 실패하는지 확인**

Run: `pnpm test tests/unit/me-components.test.tsx`
Expected: FAIL with missing `app/components/me` modules

- [ ] **Step 3: 접근 가능한 컴포넌트 최소 구현**

Implementation requirements:

```tsx
// TasteSignals.tsx 핵심 구조
<section className="member-signals" aria-labelledby="taste-signals-title">
  <header><p className="eyebrow">MY TASTE SIGNALS</p><h2 id="taste-signals-title">나의 취향 신호</h2></header>
  {summary.status === "VISIBLE" ? <>
    <ul className="member-signal-list">{summary.signals.map((signal, index) => <li data-primary={index === 0 || undefined} key={signal.key}>{signal.label}</li>)}</ul>
    <div className="member-taste-meters">{graph.dimensions.map((dimension) => <div key={dimension.key}><span>{dimension.key}</span><meter aria-label={`${dimension.key} 취향 값`} min="1" max="5" value={dimension.value} /><strong>{dimension.value.toFixed(1)}</strong></div>)}</div>
  </> : <div className="member-learning"><strong>취향 학습 중 {summary.placeCount}/5</strong><progress aria-label="취향 학습 진행도" max="5" value={summary.placeCount} /><p>장소를 평가할수록 코스 추천이 더 선명해져요.</p><Link to="/places">맛집 둘러보기</Link></div>}
</section>
```

`ActivityCollection`은 `section`, 제목 `h2`, 개수 뱃지, children 또는 행동 링크가 포함된 빈 상태를 렌더링한다. `AccountConnections`는 기존 네이버 연결·해제 조건과 문구를 그대로 보존한다.

- [ ] **Step 4: 렌더링 테스트 통과 확인**

Run: `pnpm test tests/unit/me-components.test.tsx`
Expected: 3 tests passed

- [ ] **Step 5: 커밋**

```bash
git add app/components/me tests/unit/me-components.test.tsx
git commit -m "2026-08-09 나의 취향 허브 컴포넌트 추가"
```

---

### Task 3: `/me` 페이지 정보 구조 교체

**Files:**
- Modify: `app/routes/me.tsx`
- Create: `tests/unit/me-page-contract.test.ts`

**Interfaces:**
- Consumes: Task 2 컴포넌트와 기존 loader/action 반환값
- Produces: `.member-hub` 기반 새 `/me` 문서 구조

- [ ] **Step 1: 실패하는 페이지 계약 테스트 작성**

```ts
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync("app/routes/me.tsx", "utf8");

describe("me page contract", () => {
  it("취향 허브 컴포넌트와 활동 요약을 사용한다", () => {
    expect(source).toContain('className="member-hub"');
    expect(source).toContain("<TasteSignals graph={loaderData.tasteGraph}");
    expect(source).toContain("<ActivityCollection");
    expect(source).toContain("<AccountConnections");
    expect(source).toContain("loaderData.saved.length");
    expect(source).toContain("loaderData.rated.length");
  });
});
```

- [ ] **Step 2: 기존 페이지에서 실패하는지 확인**

Run: `pnpm test tests/unit/me-page-contract.test.ts`
Expected: FAIL because `member-hub` and extracted components are absent

- [ ] **Step 3: route component 재구성**

Implementation requirements:

- loader/action 코드는 동작 변경 없이 읽기 쉬운 여러 줄 형식으로 정리한다.
- 최상위는 `<main id="main" className="member-hub">`를 사용한다.
- 프로필 헤더에는 이메일, 저장 수, 평가 수, 학습 장소 수와 리뷰어 링크를 배치한다.
- OAuth 성공은 `role="status"`, 실패는 `role="alert"`를 사용한다.
- `TasteSignals`, `ActivityCollection`, `AccountConnections`를 배치한다.
- 장소 링크, 저장 해제 Form, 추천·비추천 상태 문구를 기존과 동일하게 유지한다.
- 계정 수명주기 2단계 기능은 이 Task에서 노출하지 않는다.

- [ ] **Step 4: 페이지 계약과 전체 단위 테스트 확인**

Run: `pnpm test tests/unit/me-page-contract.test.ts tests/unit/me-components.test.tsx tests/unit/taste-signals.test.ts`
Expected: 6 tests passed

- [ ] **Step 5: 커밋**

```bash
git add app/routes/me.tsx tests/unit/me-page-contract.test.ts
git commit -m "2026-08-09 나의 취향 페이지 정보 구조 개편"
```

---

### Task 4: 코스 화면과 일치하는 반응형 스타일

**Files:**
- Modify: `app/app.css`
- Create: `tests/unit/me-style-contract.test.ts`

**Interfaces:**
- Consumes: Task 3의 `member-*` 클래스
- Produces: 데스크톱·모바일·접근성 스타일

- [ ] **Step 1: 실패하는 스타일 계약 테스트 작성**

```ts
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const css = readFileSync("app/app.css", "utf8");

describe("me style contract", () => {
  it("취향 허브 토큰과 반응형 레이아웃을 정의한다", () => {
    for (const selector of [".member-hub", ".member-profile", ".member-signal-list", ".member-activity-grid", ".member-account-card"]) expect(css).toContain(selector);
    expect(css).toContain("#e7ff55");
    expect(css).toMatch(/@media\(max-width:900px\)[\s\S]*\.member-/);
    expect(css).toMatch(/@media\(max-width:520px\)[\s\S]*\.member-/);
  });
});
```

- [ ] **Step 2: 새 스타일 부재로 실패하는지 확인**

Run: `pnpm test tests/unit/me-style-contract.test.ts`
Expected: FAIL because `.member-hub` is absent

- [ ] **Step 3: `/me` 전용 CSS 작성**

Implementation requirements:

- `.member-hub`에 코스 페이지 글꼴과 `padding:64px 0 110px`을 적용한다.
- `.member-profile`은 데스크톱 2열, 모바일 1열이다.
- `.member-signals`은 `28px` R값, 흰색 배경, 녹색 테두리, 한 번만 사용하는 오프셋 그림자를 가진다.
- `.member-signal-list`는 wrap되는 알약 뱃지이고 `[data-primary]`만 `#E7FF55`이다.
- `meter`, `progress`의 기본 외형을 통일하고 텍스트 값도 함께 유지한다.
- `.member-activity-grid`은 2열에서 1열로 전환한다.
- `.member-account-card`는 `#EDF4ED` 표면을 사용하되 네이버 버튼 `#03C75A`는 브랜드 색상으로 유지한다.
- `900px`, `520px`, `prefers-reduced-motion` 대응을 포함한다.

- [ ] **Step 4: 스타일 계약·타입검사·빌드 확인**

Run: `pnpm test tests/unit/me-style-contract.test.ts && pnpm run typecheck && pnpm run build`
Expected: tests passed, typecheck exit 0, build exit 0

- [ ] **Step 5: 커밋**

```bash
git add app/app.css tests/unit/me-style-contract.test.ts
git commit -m "2026-08-09 나의 취향 허브 반응형 스타일 적용"
```

---

### Task 5: 브라우저 디자인 QA와 PR 증거

**Files:**
- Create: `output/playwright/me-redesign/desktop.png`
- Create: `output/playwright/me-redesign/mobile.png`
- Create: `design-qa.md`

**Interfaces:**
- Consumes: 로컬 QA 계정과 완성된 `/me`
- Produces: 동일 상태의 데스크톱·모바일 시각 증거와 디자인 QA 결과

- [ ] **Step 1: 로컬 DB 준비와 개발 서버 실행**

Run: `pnpm run db:migrate:local && pnpm run db:seed:local && pnpm exec wrangler d1 execute DB --local --file scripts/seed-admin-qa.sql && pnpm dev --host 127.0.0.1`
Expected: local server starts and `/login` responds

- [ ] **Step 2: QA 계정 로그인 후 데스크톱 캡처**

Use Playwright at `1440×1000`; log in with the repository QA fixture, open `/me`, verify header, learning or visible taste state, activity cards, Naver connection and browser console, then save `output/playwright/me-redesign/desktop.png`.

- [ ] **Step 3: 모바일 캡처와 상호작용 확인**

Resize to `390×844`; verify badge wrapping, single-column activity cards, no horizontal overflow, keyboard focus, save action visibility, then save `output/playwright/me-redesign/mobile.png`.

- [ ] **Step 4: 디자인 QA 작성과 수정 반복**

Compare the user-provided `/me` screenshot with both captures. Write `design-qa.md` with P0–P3 findings, fix all P0/P1/P2 issues, recapture, and finish only when it contains `final result: passed`.

- [ ] **Step 5: 전체 검증**

Run: `pnpm test && pnpm run test:integration && pnpm run typecheck && pnpm run build && git diff --check origin/main...HEAD`
Expected: all tests pass, typecheck/build exit 0, no whitespace errors

- [ ] **Step 6: PR 준비 커밋**

```bash
git add design-qa.md
git commit -m "2026-08-09 나의 취향 허브 디자인 검증"
```

`output/playwright` 캡처는 PR 본문에 첨부하되 저장소에는 커밋하지 않는다.
