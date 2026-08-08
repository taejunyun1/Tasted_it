# 코스 추천 페이지와 주차 통합 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 사용자가 한 끼와 카페·디저트 조건을 고르면 검수된 장소 두 곳과 주차 대안을 하나의 반응형 코스로 추천한다.

**Architecture:** 검색 매개변수를 순수 파서로 정규화하고, 서버 서비스가 D1의 공개 장소를 일괄 조회한 뒤 결정적 점수로 장소 쌍을 고른다. React Router 로더가 코스와 주차 서비스를 결합하며 모바일 조건 바텀시트는 URL 기반 GET 폼으로 동작한다.

**Tech Stack:** React 19, React Router 8 Framework Mode, TypeScript, Vitest, Drizzle ORM, CSS

## Global Constraints

- `/courses` 요청 중 외부 API를 호출하지 않는다.
- 조건 없는 첫 진입은 결과를 만들지 않고 모바일 바텀시트를 자동으로 연다.
- 공개 `PUBLISHED` 장소와 활성 대표 세부 카테고리만 사용한다.
- 영업시간을 추측하지 않고 `영업시간 확인 필요`를 표시한다.
- 모든 거리에는 `예상` 표현을 붙이고, 주차 데이터가 없어도 음식 코스는 유지한다.
- SUIT/Pretendard 계열 폰트 스택, 명확한 녹색·라임 포인트, 충분한 R값을 사용한다.

---

### Task 1: 조건 파서와 시간대 컨텍스트

**Files:**
- Create: `app/features/courses/course-options.ts`
- Test: `tests/unit/course-options.test.ts`

**Interfaces:**
- Produces: `parseCourseOptions(search, now): { hasSelection: boolean; options: CourseOptions; context: CourseContext }`, `toCourseSearchParams(options): URLSearchParams`.

- [ ] **Step 1: Write failing tests** for no selection, allowed enums, radius bounds, invalid coordinates, auto time mapping, default 광주시청 location and stable URL serialization.
- [ ] **Step 2: Verify RED** with `pnpm test -- tests/unit/course-options.test.ts`.
- [ ] **Step 3: Implement minimal zod-free parser** with explicit allowlists and no browser globals.
- [ ] **Step 4: Verify GREEN** with the same command.
- [ ] **Step 5: Commit** with `git add app/features/courses/course-options.ts tests/unit/course-options.test.ts && git commit -m "2026-08-08 코스 조건 파서 추가"`.

### Task 2: 음식점 쌍 점수와 배지

**Files:**
- Create: `app/features/courses/course-score.ts`
- Test: `tests/unit/course-score.test.ts`

**Interfaces:**
- Produces: `rankCoursePairs(input): RankedCoursePair[]`, `buildCourseBadges(pair): CourseBadge[]`.

- [ ] **Step 1: Write failing tests** for 30/25/20/20/5 weighting, low-sample neutral rating, 1.5km second-place cap, 3km expansion, cafe versus dessert groups, and place-ID deterministic ties.
- [ ] **Step 2: Verify RED** with `pnpm test -- tests/unit/course-score.test.ts`.
- [ ] **Step 3: Implement bounded pair generation** with a maximum of 50 first and 50 second candidates and top 6 results.
- [ ] **Step 4: Verify GREEN** with the same command.
- [ ] **Step 5: Commit** with `git add app/features/courses/course-score.ts tests/unit/course-score.test.ts && git commit -m "2026-08-08 음식 코스 선별 알고리즘 추가"`.

### Task 3: D1 코스 추천 서비스

**Files:**
- Create: `app/features/courses/course-recommendation.server.ts`
- Test: `tests/integration/course-recommendation.server.test.ts`

**Interfaces:**
- Consumes: `rankCoursePairs`, `recommendParkingForCourse`.
- Produces: `recommendCourses(db, input): Promise<CourseRecommendationResult>` with options, category choices, up to 6 course cards and per-course parking result.

- [ ] **Step 1: Write failing integration tests** for published-only query, active primary terminal category, meal/cafe separation, 3km expansion and food result preservation when parking tables are empty.
- [ ] **Step 2: Verify RED** with `pnpm test:integration -- tests/integration/course-recommendation.server.test.ts`.
- [ ] **Step 3: Implement one joined place/category/vote query**, rank in memory, then request parking only for the top three pairs to bound D1 work.
- [ ] **Step 4: Verify GREEN** with the same command.
- [ ] **Step 5: Commit** with `git add app/features/courses/course-recommendation.server.ts tests/integration/course-recommendation.server.test.ts && git commit -m "2026-08-08 코스 추천 서비스 추가"`.

### Task 4: `/courses` 로더와 반응형 화면

**Files:**
- Create: `app/routes/course-recommendation.tsx`
- Modify: `app/routes.ts`
- Modify: `app/app.css`
- Test: `tests/unit/course-page-policy.test.ts`

**Interfaces:**
- Loader returns `{ hasSelection, options, context, categories, courses }`.
- Page GET form writes the exact search keys from the design spec.

- [ ] **Step 1: Write a failing policy test** for the route registration, accessible labels, selection names, first-entry bottom-sheet marker and result copy contracts.
- [ ] **Step 2: Verify RED** with `pnpm test -- tests/unit/course-page-policy.test.ts`.
- [ ] **Step 3: Add the route loader and component** using generated `Route.*` types, `<Form method="get">`, location button, filter dialog/bottom sheet and empty/error states.
- [ ] **Step 4: Add scoped CSS** for a two-column desktop layout, 360px bottom sheet, rounded badges, route ribbon, parking comparison, visible focus and reduced motion.
- [ ] **Step 5: Verify GREEN** with `pnpm test -- tests/unit/course-page-policy.test.ts && pnpm run typecheck && pnpm run build`.
- [ ] **Step 6: Commit** with `git add app/routes/course-recommendation.tsx app/routes.ts app/app.css tests/unit/course-page-policy.test.ts && git commit -m "2026-08-08 코스·주차 추천 화면 추가"`.

### Task 5: 브라우저 검증과 회귀

**Files:**
- Create: `artifacts/courses-desktop.png`
- Create: `artifacts/courses-mobile.png`

- [ ] **Step 1: Start the local server** with `pnpm run dev` and note the assigned localhost URL.
- [ ] **Step 2: Verify desktop** at 1440×1000: conditions and results visible together, no console error, form changes URL.
- [ ] **Step 3: Verify mobile** at 390×844: first-entry bottom sheet open, keyboard focus visible, apply closes sheet and results fit without horizontal scrolling.
- [ ] **Step 4: Capture desktop and mobile evidence** to `artifacts/` for the PR.
- [ ] **Step 5: Run full gates** with `pnpm test && pnpm test:integration && pnpm run typecheck && pnpm run build && git diff --check`.

