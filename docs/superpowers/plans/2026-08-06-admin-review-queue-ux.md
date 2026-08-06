# Admin Review Queue UX Implementation Plan

> **For Codex:** Execute inline with TDD and verify the production queue flow.

**Goal:** Reduce ambiguous controls and make successful AI classification advance candidates out of manual review.

**Architecture:** Separate display queue completion from safe auto-approval eligibility. Exclude previously successful candidates from unselected AI batches at query time.

**Tech Stack:** React Router 8, React 19, Cloudflare D1/Workers AI, Drizzle, Vitest, Playwright.

---

### Task 1: Queue behavior

- [x] Add failing integration tests for completed display state and advancing AI batches.
- [x] Implement successful-AI display state while preserving safe eligibility.
- [x] Exclude prior successful AI candidates from unselected batches.

### Task 2: Action hierarchy

- [x] Update E2E contract for the two core selected actions and simplified header.
- [x] Remove secondary admin navigation and bulk rejection controls.
- [x] Convert page select/clear to one toggle control.
- [x] Rename automatic state to classification complete.

### Task 3: Release

- [x] Run unit, integration, typecheck, build, and targeted E2E.
- [ ] Commit, push, PR, merge, deploy, and verify production.
