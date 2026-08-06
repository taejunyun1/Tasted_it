# Map Region Clusters Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Group public map places by district and neighborhood at wide zoom levels, keep the explorer list synchronized with the same groups, and preserve individual-marker selection at close zoom.

**Architecture:** A pure `region-cluster-policy.ts` module extracts stable administrative keys and creates cluster view models. `home.tsx` owns transient zoom and cluster-focus state, passes the same grouped result to `PlaceMap` and `MapExplorerPanel`, and keeps URL filters unchanged. `PlaceMap` renders either region markers or place markers and performs motion-aware focus transitions.

**Tech Stack:** React 19, React Router 8.3, TypeScript 7.0.2, Naver Maps JavaScript API, Vitest, Playwright, Cloudflare Workers.

## Global Constraints

- Zoom `0~12` renders district clusters, `13~14` renders neighborhood clusters, and `15+` renders individual places.
- District means a Gwangju autonomous district or a Jeonnam city/county.
- Missing administrative names use coordinate fallback clusters and never guessed names.
- No D1 migration, geocoding API, boundary polygon dataset, or rating algorithm change.
- Region marker copy uses no font weight above `600`.
- Reduced-motion users receive immediate map movement.
- Existing search, category, bbox, place selection, and mobile quick-sheet behavior must remain compatible.

---

### Task 1: Pure administrative clustering policy

**Files:**
- Create: `app/features/maps/region-cluster-policy.ts`
- Create: `tests/unit/region-cluster-policy.test.ts`

**Interfaces:**
- Consumes: `PlaceSummary[]` from `app/features/places/place.types.ts`.
- Produces: `RegionClusterLevel`, `RegionCluster`, `RegionGroup`, `getRegionClusterLevel(zoom)`, `extractDistrict(address)`, `extractNeighborhood(place)`, `buildRegionClusters(places, zoom)`, and `buildRegionGroups(places, zoom)`.

- [ ] **Step 1: Write failing zoom and address tests**

```ts
expect(getRegionClusterLevel(12)).toBe("DISTRICT");
expect(getRegionClusterLevel(13)).toBe("NEIGHBORHOOD");
expect(getRegionClusterLevel(14)).toBe("NEIGHBORHOOD");
expect(getRegionClusterLevel(15)).toBe("PLACE");
expect(extractDistrict("광주광역시 북구 용봉로 1")).toBe("북구");
expect(extractDistrict("전라남도 담양군 담양읍 중앙로 1")).toBe("담양군");
```

- [ ] **Step 2: Run the focused unit test and confirm missing-module failure**

Run: `corepack pnpm exec vitest run tests/unit/region-cluster-policy.test.ts`
Expected: FAIL because `region-cluster-policy.ts` does not exist.

- [ ] **Step 3: Implement level selection and administrative extraction**

Use normalized Korean address tokens. Prefer the existing `place.neighborhood`, then a parenthesized legal neighborhood, then the last address token ending in `동|읍|면|리`. District IDs include region type and normalized label.

- [ ] **Step 4: Add failing cluster aggregation tests**

Assert stable IDs, place counts, arithmetic center, bounds, district separation, neighborhood separation, single-place clusters, and coordinate fallback labels.

- [ ] **Step 5: Implement deterministic cluster and list group builders**

Coordinate fallback cells use approximately 8km at district level and 1.5km at neighborhood level. Region groups sort by Korean label and preserve original place order inside each group.

- [ ] **Step 6: Run unit tests and commit**

Run: `corepack pnpm exec vitest run tests/unit/region-cluster-policy.test.ts`
Expected: PASS.

Commit: `2026-08-06 행정구역 지도 클러스터 계산 추가`.

---

### Task 2: Shared zoom and region-focus state

**Files:**
- Modify: `app/routes/home.tsx`
- Modify: `app/components/map/MapExplorerPanel.tsx`
- Modify: `app/components/map/MapPlaceList.tsx`
- Modify: `tests/e2e/map-explorer-panel.spec.ts`

**Interfaces:**
- Consumes: Task 1 `buildRegionClusters` and `buildRegionGroups`.
- Produces: `PlaceMap` props `zoom`, `clusters`, `focusCluster`, `onZoom`; `MapExplorerPanel` props `level`, `groups`, `onGroupSelect`.

- [ ] **Step 1: Add failing explorer-list E2E assertions**

At the initial QA zoom, assert a district heading such as `남구 1곳` is visible. Selecting the heading must request the same focus behavior as selecting the corresponding map cluster.

- [ ] **Step 2: Run the focused browser test and confirm failure**

Run: `corepack pnpm exec playwright test tests/e2e/map-explorer-panel.spec.ts --project=chromium --grep="region"`
Expected: FAIL because the list has no region headings.

- [ ] **Step 3: Lift transient map state into `home.tsx`**

Initialize zoom to `12`, derive clusters and groups with `useMemo`, and store `focusCluster` by stable ID. Do not place zoom or focus IDs in the URL.

- [ ] **Step 4: Render grouped list sections**

`MapPlaceList` receives `RegionGroup[]`. District and neighborhood headers are buttons with labels like `북구 12곳`; close zoom keeps the existing numbered list. Header selection calls `onGroupSelect`.

- [ ] **Step 5: Run focused E2E and commit**

Expected: list grouping passes without breaking search-history or mobile panel tests.

Commit: `2026-08-06 지도 목록 지역별 그룹화`.

---

### Task 3: Naver map region markers and focus transitions

**Files:**
- Modify: `app/components/map/PlaceMap.tsx`
- Modify: `app/features/maps/place-marker-policy.ts`
- Modify: `app/app.css`
- Modify: `tests/e2e/map-explorer-panel.spec.ts`
- Modify: `tests/e2e/map-zoom.spec.ts`

**Interfaces:**
- Consumes: Task 1 `RegionCluster` and Task 2 transient state.
- Produces: accessible district/neighborhood marker buttons and `onZoom(currentZoom)` notifications.

- [ ] **Step 1: Add failing marker-transition E2E assertions**

Verify initial QA map exposes `남구 음식점 1곳, 확대해서 보기`, district click changes to neighborhood markers, neighborhood click changes to individual place pins, and bbox changes on each focus.

- [ ] **Step 2: Extend the deterministic QA map**

The no-key QA renderer must implement the same three zoom stages and focus callbacks so browser tests do not require an external Naver key.

- [ ] **Step 3: Track Naver zoom and render one marker mode at a time**

Register a zoom listener, call `onZoom`, remove previous markers before creating the new stage, and preserve the current individual influence marker code only for `PLACE` level.

- [ ] **Step 4: Implement cluster focus**

Map marker and list heading selections set the selected cluster. The map fits its bounds, enforces target zoom `13` or `15`, suppresses competing idle bbox updates for 1.5 seconds, and respects reduced motion.

- [ ] **Step 5: Add flat cluster-marker styling**

Use white capsules, dark green borders, subtle background hover/focus, `500` label weight, and `600` count weight. Do not scale shadows by count.

- [ ] **Step 6: Run desktop and mobile map E2E and commit**

Run: `corepack pnpm exec playwright test tests/e2e/map-explorer-panel.spec.ts tests/e2e/map-zoom.spec.ts --project=chromium --project=mobile-chromium`
Expected: all applicable tests pass; platform-gated tests are skipped only on their non-target project.

Commit: `2026-08-06 구동별 지도 마커 전환`.

---

### Task 4: Regression QA and release

**Files:**
- Modify only files required by diagnosed regressions.

**Interfaces:**
- Consumes: completed Tasks 1–3.
- Produces: merged and deployed production release.

- [ ] **Step 1: Run static and unit verification**

```bash
corepack pnpm run typecheck
corepack pnpm test
corepack pnpm run test:integration
```

Expected: TypeScript 7 has zero diagnostics; all unit and integration tests pass.

- [ ] **Step 2: Run complete browser QA**

Run: `corepack pnpm run test:e2e`
Expected: zero failed tests, including desktop and mobile region transitions, search, category filters, login, and quick sheet.

- [ ] **Step 3: Verify production build and Worker package**

```bash
corepack pnpm run build
corepack pnpm exec wrangler deploy --dry-run
```

Expected: production build succeeds and Wrangler reports a valid Worker bundle.

- [ ] **Step 4: Review, push, and merge through PR**

Review `git diff origin/main...HEAD`, push `codex/map-region-clusters`, open a PR to `main`, inspect checks and diff, then squash merge and delete the remote branch.

- [ ] **Step 5: Deploy merged main and smoke test**

Update local `main` from `origin/main`, rerun the release verification appropriate to merged main, deploy with `corepack pnpm run deploy`, and verify public home returns `200` and protected admin routes redirect unauthenticated users.
