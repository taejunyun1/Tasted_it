# Map Marker Focus Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make a clicked place marker smoothly center and zoom while expressing rating-sample influence through a restrained Flat marker shadow.

**Architecture:** Add pure marker-presentation policies beside the map SDK helpers so thresholds and zoom behavior are independently testable. `PlaceMap` consumes those policies to render classes and to call Naver Maps `panTo`/conditional `setZoom` before preserving the existing selection callback.

**Tech Stack:** React 19, TypeScript, Naver Maps JavaScript SDK, Vitest, Playwright, CSS.

## Global Constraints

- Emoji size is 12px.
- Influence tiers use total votes: 0–7 base, 8–24 medium, 25+ high.
- Marker body sizes are capped at 30/32/34px; selected is capped at 36px.
- Marker click pans to the place and raises zoom to 16 only when current zoom is below 16.
- List selection must not change map position.
- Font weights remain 600 or below.

---

### Task 1: Marker presentation and focus policies

**Files:**
- Create: `app/features/maps/place-marker-policy.ts`
- Test: `tests/unit/place-marker-policy.test.ts`

**Interfaces:**
- Produces: `getMarkerInfluence(positive: number, negative: number): "base" | "medium" | "high"`
- Produces: `getMarkerFocusZoom(currentZoom: number, targetZoom?: number): number | null`

- [ ] **Step 1: Write failing boundary tests**

```ts
expect(getMarkerInfluence(7, 0)).toBe("base");
expect(getMarkerInfluence(8, 0)).toBe("medium");
expect(getMarkerInfluence(24, 0)).toBe("medium");
expect(getMarkerInfluence(25, 0)).toBe("high");
expect(getMarkerFocusZoom(12)).toBe(16);
expect(getMarkerFocusZoom(16)).toBeNull();
expect(getMarkerFocusZoom(18)).toBeNull();
```

- [ ] **Step 2: Run the test and verify missing-module failure**

Run: `npm test -- tests/unit/place-marker-policy.test.ts`

Expected: FAIL because `place-marker-policy` does not exist.

- [ ] **Step 3: Add the minimal pure functions**

```ts
export function getMarkerInfluence(positive: number, negative: number) {
  const votes = Math.max(0, positive) + Math.max(0, negative);
  return votes >= 25 ? "high" : votes >= 8 ? "medium" : "base";
}

export function getMarkerFocusZoom(currentZoom: number, targetZoom = 16) {
  return currentZoom < targetZoom ? targetZoom : null;
}
```

- [ ] **Step 4: Run the focused unit test and verify it passes**

Run: `npm test -- tests/unit/place-marker-policy.test.ts`

Expected: 7 assertions pass.

### Task 2: Naver marker click behavior and Flat styling

**Files:**
- Modify: `app/components/map/PlaceMap.tsx`
- Modify: `app/types/naver-maps.d.ts`
- Modify: `app/app.css`
- Modify: `tests/e2e/map-experience.spec.ts`

**Interfaces:**
- Consumes: `getMarkerInfluence`, `getMarkerFocusZoom`
- Uses: `Map.panTo(position)`, `Map.getZoom()`

- [ ] **Step 1: Add a failing browser assertion for click focus**

```ts
await page.getByRole("button", { name: /지도 핀/ }).first().click();
await expect(page.locator(".map-pin.is-selected")).toBeVisible();
await expect(page.locator(".map-pin[data-influence]" ).first()).toBeVisible();
```

- [ ] **Step 2: Apply click focus behavior**

```ts
const position = new maps.LatLng(place.latitude, place.longitude);
button.onclick = () => {
  map.panTo(position);
  const zoom = getMarkerFocusZoom(map.getZoom());
  if (zoom !== null) map.setZoom(zoom);
  selectRef.current(place.id);
};
```

- [ ] **Step 3: Apply Flat influence classes and accessible attributes**

```ts
const influence = getMarkerInfluence(place.positive, place.negative);
button.className = `map-pin influence-${influence}${selected === place.id ? " is-selected" : ""}`;
button.dataset.influence = influence;
```

- [ ] **Step 4: Implement restrained CSS tokens**

Use 30/32/34px marker sizes, 12px emoji, translucent white fill, a 1px green border, and progressively broader external shadows. Selected markers use a 36px body, 2px brand-green border, and a low-opacity outline. Do not add gradients.

- [ ] **Step 5: Run full verification**

Run: `npm run typecheck && npm test && npm run test:integration && npm run build && git diff --check`

Expected: all commands exit 0. Then run the relevant Playwright map test locally and repeat the member-map flow against production after deployment.
