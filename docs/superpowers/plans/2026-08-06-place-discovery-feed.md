# Place Discovery Feed Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 장소 목록을 내 주변 추천, Re:Taste 추천, 최근 Golden Pick, 전체 장소 순서의 발견형 피드로 바꾸고 서로 다른 평가 표본의 QA 데이터를 제공한다.

**Architecture:** 순수 추천 정책은 `place-discovery.ts`에 두고 단위 테스트한다. D1 조회는 기존 공개 장소 조회와 활성 Golden Pick 조회를 조합하는 서버 모듈이 담당하며, 라우트는 URL 상태를 전달하고 네 개 화면 구역만 구성한다. QA 투표는 고정 ID를 사용하는 SQL 시드로 만들어 반복 실행 안전성을 유지한다.

**Tech Stack:** React Router 7, React 19, TypeScript, Drizzle ORM, Cloudflare Workers/D1, Vitest, Playwright.

## Global Constraints

- 추천 구역 순서는 내 주변 추천 → Re:Taste 추천 → 최근 Golden Pick → 전체 장소다.
- 검색과 카테고리 조건은 전체 장소 구역에만 배치한다.
- 추천률은 8표 이상에서만 공개하고 8표 미만은 `평가 n/8`로 표시한다.
- 추천 레일에서 중복된 장소는 앞쪽 구역에만 표시한다.
- 폰트 굵기는 700 이상을 새로 사용하지 않는다.
- 실제 사용자 투표를 수정하지 않고 `qa-discovery-*` 데이터만 upsert한다.

---

### Task 1: 추천 정책과 표시 모델

**Files:**
- Create: `app/features/places/place-discovery.ts`
- Create: `tests/unit/place-discovery.test.ts`
- Modify: `app/components/places/PlaceCard.tsx`

**Interfaces:**
- Consumes: `PlaceSummary`의 좌표와 positive/negative 값.
- Produces: `buildDiscoverySections(places, goldenPicks, center)`와 `formatRatingSummary(place)`.

- [ ] **Step 1: Write the failing test**

```ts
expect(formatRatingSummary(placeWith7Votes)).toBe("평가 7/8");
expect(formatRatingSummary(placeWith8Votes)).toBe("추천 75% · 8명 평가");
expect(result.nearby.map((item) => item.id)).toEqual(["near", "far"]);
expect(new Set([...result.nearby, ...result.service, ...result.golden].map((item) => item.id)).size).toBe(totalRailItems);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/unit/place-discovery.test.ts`
Expected: FAIL because `place-discovery` does not exist.

- [ ] **Step 3: Write minimal implementation**

Implement Haversine distance, 8-vote visibility copy, service sorting by score/sample/name, Golden Pick recency sorting, and ordered rail deduplication. Extend `PlaceCard` with optional `distanceMeters`, `goldenPickAt`, and `recommendationLabel` props.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tests/unit/place-discovery.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

Run: `git add app/features/places/place-discovery.ts app/components/places/PlaceCard.tsx tests/unit/place-discovery.test.ts && git commit -m "2026-08-06 장소 추천 정책과 평가 표시"`.

### Task 2: 서버 조회와 발견형 목록 UI

**Files:**
- Create: `app/features/places/place-discovery.server.ts`
- Create: `app/components/places/PlaceDiscoveryRail.tsx`
- Modify: `app/routes/place-list.tsx`
- Modify: `app/app.css`
- Create: `tests/e2e/place-discovery-feed.spec.ts`

**Interfaces:**
- Consumes: `listPlaces`, `listActiveGoldenPicks`, URL의 bbox/category/query.
- Produces: loader의 `nearby`, `service`, `golden`, `places`, `centerLabel`과 발견형 피드 화면.

- [ ] **Step 1: Write the failing E2E test**

```ts
await expect(page.getByRole("heading", { name: "내 주변 추천" })).toBeVisible();
await expect(page.getByRole("heading", { name: "Re:Taste 추천" })).toBeVisible();
await expect(page.getByRole("heading", { name: "최근 Golden Pick" })).toBeVisible();
await expect(page.getByRole("heading", { name: "전체 장소" })).toBeVisible();
expect(await page.locator("main h2").allTextContents()).toEqual(["내 주변 추천", "Re:Taste 추천", "최근 Golden Pick", "전체 장소"]);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx playwright test tests/e2e/place-discovery-feed.spec.ts --project=chromium`
Expected: FAIL because the recommendation headings do not exist.

- [ ] **Step 3: Write minimal implementation**

Load up to 100 published places, active Golden Picks, and category groups. Render three horizontal rails before the complete grid. Move the search form beneath the `전체 장소` heading and preserve category, bbox, query, and map return URL. Add responsive rail styles, visible focus states, and empty-state copy.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run typecheck && npm test -- tests/unit/place-discovery.test.ts && npx playwright test tests/e2e/place-discovery-feed.spec.ts --project=chromium`
Expected: PASS.

- [ ] **Step 5: Commit**

Run: `git add app/features/places/place-discovery.server.ts app/components/places/PlaceDiscoveryRail.tsx app/routes/place-list.tsx app/app.css tests/e2e/place-discovery-feed.spec.ts && git commit -m "2026-08-06 발견형 장소 목록 UI"`.

### Task 3: 서로 다른 평가 표본 QA 데이터

**Files:**
- Create: `scripts/seed-discovery-ratings.sql`
- Create: `tests/unit/discovery-rating-seed.test.ts`
- Modify: `docs/operations/week1-data-runbook.md`

**Interfaces:**
- Consumes: 기존 공개 장소와 `current_votes`, `users` 스키마.
- Produces: 0, 3, 7, 8, 12, 25, 50표 이상 분산 데이터와 반복 실행 명령.

- [ ] **Step 1: Write the failing seed contract test**

```ts
expect(sql).toContain("qa-discovery-");
expect(sql).toContain("ON CONFLICT");
expect(expectedSampleCounts).toEqual([0, 3, 7, 8, 12, 25, 50]);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/unit/discovery-rating-seed.test.ts`
Expected: FAIL because the seed file does not exist.

- [ ] **Step 3: Write minimal implementation**

Create deterministic QA users and vote events/current votes for seven published places. Delete and recreate only IDs prefixed with `qa-discovery-`, preserve all other votes, and document local/remote Wrangler execution and verification queries.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tests/unit/discovery-rating-seed.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

Run: `git add scripts/seed-discovery-ratings.sql tests/unit/discovery-rating-seed.test.ts docs/operations/week1-data-runbook.md && git commit -m "2026-08-06 발견 피드 평가 QA 시드"`.

### Task 4: 통합 검증, PR, 병합, 운영 배포

**Files:**
- Modify only files required by verification findings within this feature scope.

**Interfaces:**
- Consumes: Tasks 1–3의 완성 결과.
- Produces: 병합된 `main`, 운영 D1 QA 데이터, Cloudflare 배포 및 운영 브라우저 검증 결과.

- [ ] **Step 1: Run full verification**

Run: `npm run typecheck && npm test && npm run test:integration && npm run build`.
Expected: all commands PASS.

- [ ] **Step 2: Review the diff**

Run: `git diff origin/main...HEAD --check && git diff --stat origin/main...HEAD`.
Expected: no whitespace errors and only scoped files.

- [ ] **Step 3: Push and open PR**

Run: `git push -u origin codex/place-discovery-feed` and open a PR targeting `main`.
Expected: checks pass and diff matches the design.

- [ ] **Step 4: Merge and deploy from main**

Squash merge the approved PR, update local `main`, run `npm run build && ./node_modules/.bin/wrangler deploy`, then execute `scripts/seed-discovery-ratings.sql` against `retaste-production` using Wrangler D1.
Expected: Worker deployment succeeds and the D1 verification query shows distributed sample counts.

- [ ] **Step 5: Production browser QA**

Run the discovery feed Playwright spec with `BASE_URL=https://retaste-beta.retaste-beta.workers.dev`.
Expected: section order, rating boundary copy, search position, card links, and responsive rail behavior pass.

