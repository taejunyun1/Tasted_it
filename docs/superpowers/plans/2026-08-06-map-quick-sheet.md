# Map Quick Sheet Implementation Plan

> **For Codex:** Execute inline with TDD and verify desktop/mobile behavior.

**Goal:** Preserve browsing context while exposing selected-place information in a visual bottom sheet.

**Architecture:** Keep `MapExplorerPanel` list-only and render selected-place detail as an overlay inside the map section. URL selection remains the single source of truth.

**Tech Stack:** React 19, React Router 8, CSS, Playwright, Vitest.

---

### Task 1: Behavior contract

- [x] Update E2E expectations for persistent list, bottom sheet, close action, and rating progress bar.
- [x] Confirm the changed test fails before implementation.

### Task 2: Component and visual system

- [x] Keep the explorer panel mounted while a place is selected.
- [x] Render the selected place sheet over the map.
- [x] Add visible/insufficient recommendation bars and accessible progress values.
- [x] Reduce full-detail action emphasis and add sheet close behavior.
- [x] Add responsive layout, entrance animation, and reduced-motion support.

### Task 3: Verification and release

- [x] Run unit, typecheck, build, and targeted map E2E on desktop/mobile.
- [ ] Review diff, commit, push, PR, merge, and deploy merged main.
