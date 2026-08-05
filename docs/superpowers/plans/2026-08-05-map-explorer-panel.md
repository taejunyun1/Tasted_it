# Map Explorer Panel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the member home overlay controls with a left search/list/detail panel that stays synchronized with the Naver map.

**Architecture:** Keep the home route loader and URL search parameters as the source of truth. Extract a presentational `MapExplorerPanel` that derives its list or detail state from the selected place supplied by `Home`; `PlaceMap` remains responsible only for map rendering and events.

**Tech Stack:** React 19, React Router 8 Framework Mode, TypeScript, Tailwind utility classes plus `app/app.css`, Vitest, Playwright.

## Global Constraints

- No database migration or new external API.
- Show only existing `PlaceSummary` fields and existing `calculateRating` output.
- Body weight 400, utility/action weight 500, place name weight 600; never use 700 or heavier.
- Preserve `q`, `category`, and `bbox` when selecting or clearing a place.
- Desktop uses a 380–420px left panel; mobile uses a bottom panel with map/list controls.
- Preserve the existing Naver map zoom regression behavior.

---

### Task 1: Selection state rules

**Files:**
- Create: `app/features/maps/map-selection.ts`
- Create: `tests/unit/map-selection.test.ts`

**Interfaces:**
- Consumes: `PlaceSummary[]`, selected place ID from `MapState.selected`.
- Produces: `findSelectedPlace(places: PlaceSummary[], selectedId: string | null): PlaceSummary | null` and `updateMapSearch(current: URLSearchParams, change: { selected?: string | null; q?: string | null; category?: string | null }): URLSearchParams`.

- [ ] **Step 1: Write the failing selection tests**

```ts
import { describe, expect, it } from "vitest";
import { findSelectedPlace, updateMapSearch } from "../../app/features/maps/map-selection";

describe("map selection", () => {
  it("returns null when the selected place is outside the current results", () => {
    expect(findSelectedPlace([], "missing")).toBeNull();
  });

  it("preserves map filters while clearing a selection", () => {
    const next = updateMapSearch(new URLSearchParams("bbox=1,2,3,4&q=국밥&category=gukbap&selected=p1"), { selected: null });
    expect(next.toString()).toContain("bbox=1%2C2%2C3%2C4");
    expect(next.get("q")).toBe("국밥");
    expect(next.get("category")).toBe("gukbap");
    expect(next.has("selected")).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test and verify RED**

Run: `npm test -- tests/unit/map-selection.test.ts`
Expected: FAIL because `map-selection` does not exist.

- [ ] **Step 3: Implement the minimal helpers**

```ts
export function findSelectedPlace(places: PlaceSummary[], selectedId: string | null) {
  return selectedId ? places.find((place) => place.id === selectedId) ?? null : null;
}

export function updateMapSearch(current: URLSearchParams, change: MapSearchChange) {
  const next = new URLSearchParams(current);
  for (const [key, value] of Object.entries(change)) value ? next.set(key, value) : next.delete(key);
  return next;
}
```

- [ ] **Step 4: Run the focused and full unit suites**

Run: `npm test -- tests/unit/map-selection.test.ts && npm test`
Expected: focused tests and all unit tests PASS.

- [ ] **Step 5: Commit**

```bash
git add app/features/maps/map-selection.ts tests/unit/map-selection.test.ts
git commit -m "2026-08-05 지도 선택 상태 규칙 추가"
```

### Task 2: Left explorer panel

**Files:**
- Create: `app/components/map/MapExplorerPanel.tsx`
- Create: `app/components/map/MapPlaceList.tsx`
- Create: `app/components/map/MapPlaceDetail.tsx`
- Modify: `app/routes/home.tsx`
- Modify: `app/app.css`
- Create: `tests/e2e/map-explorer-panel.spec.ts`

**Interfaces:**
- Consumes: places, category groups, selected place, query/category values, URL update callbacks.
- Produces: accessible list/detail panel; `onSelect(id)`, `onClearSelection()`, `onQuery(query)`, and `onCategory(slug)` events.

- [ ] **Step 1: Write the failing desktop E2E test**

```ts
test("a map pin opens place information in the left explorer panel", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: /지도 핀$/ }).first().click();
  await expect(page).toHaveURL(/selected=/);
  await expect(page.getByRole("button", { name: "목록으로" })).toBeVisible();
  await expect(page.getByRole("link", { name: "상세 보기" })).toBeVisible();
});
```

- [ ] **Step 2: Run E2E against the current app and verify RED**

Run: `npm exec -- playwright test tests/e2e/map-explorer-panel.spec.ts --project=chromium`
Expected: FAIL because the left explorer detail panel and `목록으로` button do not exist.

- [ ] **Step 3: Implement `MapPlaceList`**

Render a semantic ordered list of buttons. Each row shows index, category emoji/name, place name, neighborhood, and rating status from `calculateRating`. The button calls `onSelect(place.id)` and has an accessible name `${place.name} 선택`.

- [ ] **Step 4: Implement `MapPlaceDetail`**

Render `목록으로`, image fallback, category, name, neighborhood/address, rating, vote counts, `/places/${place.slug}` detail link, and a Naver Map search link using `encodeURIComponent(place.address)`.

- [ ] **Step 5: Implement `MapExplorerPanel`**

When `selectedPlace` exists render `MapPlaceDetail`; otherwise render the GET search form, location button, category controls, result count, and `MapPlaceList`. Keep filter controls button-based and send changes through callbacks so `Home` owns URL state.

- [ ] **Step 6: Replace the home overlays with the split layout**

Use `findSelectedPlace(loaderData.places, loaderData.state.selected)`. Render:

```tsx
<main className="map-explorer">
  <MapExplorerPanel ... />
  <section className="map-explorer__map" aria-label="지도 영역">
    <PlaceMap ... />
  </section>
</main>
```

Search and category changes clear `selected`; selecting a place preserves all current parameters; `목록으로` removes only `selected`.

- [ ] **Step 7: Add deliberate responsive styling**

Desktop: 400px panel plus flexible map; panel border-right; independent panel scroll. Mobile: full map with a bottom panel, `지도`/`목록` controls, max-height scrolling, 600 weight only for place names and primary action. Use the existing white, emerald and signal palette.

- [ ] **Step 8: Run the focused E2E test and verify GREEN**

Run: `npm exec -- playwright test tests/e2e/map-explorer-panel.spec.ts --project=chromium`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add app/components/map/MapExplorerPanel.tsx app/components/map/MapPlaceList.tsx app/components/map/MapPlaceDetail.tsx app/routes/home.tsx app/app.css tests/e2e/map-explorer-panel.spec.ts
git commit -m "2026-08-05 회원 지도 탐색 패널 구현"
```

### Task 3: Responsive and regression QA

**Files:**
- Modify: `tests/e2e/map-explorer-panel.spec.ts`
- Modify if required by failures: `app/components/map/MapExplorerPanel.tsx`, `app/components/map/MapPlaceList.tsx`, `app/components/map/MapPlaceDetail.tsx`, `app/routes/home.tsx`, `app/app.css`

**Interfaces:**
- Consumes: completed explorer panel and existing `tests/e2e/map-zoom.spec.ts`.
- Produces: desktop/mobile proof for selection, return-to-list and zoom preservation.

- [ ] **Step 1: Add failing return-to-list and mobile assertions**

```ts
test("returning to the list preserves the current map filters", async ({ page }) => {
  await page.goto("/?q=국밥&category=gukbap");
  await page.getByRole("button", { name: /선택$/ }).first().click();
  await page.getByRole("button", { name: "목록으로" }).click();
  await expect(page).toHaveURL(/q=/);
  await expect(page).toHaveURL(/category=gukbap/);
  await expect(page).not.toHaveURL(/selected=/);
});
```

- [ ] **Step 2: Run desktop and mobile explorer tests**

Run: `npm exec -- playwright test tests/e2e/map-explorer-panel.spec.ts`
Expected: new assertions FAIL until responsive/URL edge cases are complete.

- [ ] **Step 3: Make only the changes required by the failures**

Keep URL updates immutable with `new URLSearchParams`, ensure controls remain visible at 412px viewport width, and return invalid selections to the list without throwing.

- [ ] **Step 4: Run complete verification**

Run: `npm run typecheck && npm test && npm run test:integration && npm run build`
Expected: all commands exit 0.

Run: `npm exec -- playwright test tests/e2e/map-explorer-panel.spec.ts tests/e2e/map-zoom.spec.ts`
Expected: desktop and mobile projects PASS.

- [ ] **Step 5: Commit QA adjustments**

```bash
git add tests/e2e/map-explorer-panel.spec.ts app
git commit -m "2026-08-05 지도 탐색 패널 반응형 QA 보강"
```

### Task 4: Pull request, production deployment and live QA

**Files:**
- No additional source files unless production QA finds a reproducible defect.

**Interfaces:**
- Consumes: verified feature branch.
- Produces: merged `main`, Cloudflare production deployment, live desktop/mobile QA evidence.

- [ ] **Step 1: Push and open a PR into `main`**

Run: `git push -u origin codex/map-explorer-panel-spec` and `gh pr create --base main --head codex/map-explorer-panel-spec`.
Expected: PR URL returned.

- [ ] **Step 2: Review PR files and checks, then squash merge**

Run: `gh pr view --json files,mergeable,statusCheckRollup` and `gh pr diff --patch`, then `gh pr merge --squash` when mergeable and required checks pass.
Expected: PR state `MERGED`.

- [ ] **Step 3: Deploy merged main**

Run from the primary worktree: `git pull --ff-only origin main && npm run deploy`.
Expected: Cloudflare returns the production URL and version ID.

- [ ] **Step 4: Run live QA**

Run: `BASE_URL=https://retaste-beta.retaste-beta.workers.dev npm exec -- playwright test tests/e2e/map-explorer-panel.spec.ts tests/e2e/map-zoom.spec.ts`.
Expected: desktop and mobile projects PASS.

- [ ] **Step 5: Remove merged feature worktree and branches**

Delete the remote feature branch, remove the isolated worktree, and delete the local feature branch after confirming `main` is current and clean.
