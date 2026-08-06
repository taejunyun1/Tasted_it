# Admin AI Quota Implementation Plan

> **For Codex:** Execute this plan inline with TDD and verify each checkpoint before the next task.

**Goal:** Keep Cloudflare Workers AI classification inside 90% of the daily free allocation while making bulk review reliable and compact.

**Architecture:** Persist token-derived estimated Neurons on each classification run, aggregate them by UTC day, and enforce the same quota policy in both loader UI and server action. Process at most ten candidates per action and retry only malformed JSON once.

**Tech Stack:** React Router 8, Cloudflare Workers/Workers AI, D1, Drizzle ORM, Vitest, Playwright.

---

### Task 1: Usage policy and persistence

- [x] Add failing quota boundary and Neuron estimation unit tests.
- [x] Add D1 migration and Drizzle columns.
- [x] Implement pure quota policy and daily aggregate query.
- [x] Run unit and integration schema tests.

### Task 2: Reliable AI execution

- [x] Add failing tests for usage persistence, ten-item cap, JSON retry, and quota blocking.
- [x] Refactor AI execution to ten candidates, partial failure continuation, usage aggregation, and one validation retry.
- [x] Return quota state in the result.
- [x] Run candidate AI integration tests.

### Task 3: Admin review controls

- [x] Add failing selection helper tests.
- [x] Implement current-page select-all/clear with blocked exclusion and 25-item cap.
- [x] Add usage meter, warning, disabled buttons, compact rows, recommended-category default, and action error banner.
- [x] Update targeted Playwright coverage.

### Task 4: Release

- [x] Run migrations locally, full tests, typecheck, build, and targeted E2E.
- [ ] Review diff, commit, push, open PR, wait for checks, and squash merge.
- [ ] Apply production D1 migration and deploy merged main.
- [ ] Verify production admin screen without consuming AI quota.
