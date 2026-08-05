# Re:Taste Rating Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 추천율 공개 기준, 역할별 가중 집계, 리뷰어 신뢰도·유사도 감쇠, 재현 가능한 스냅샷, 배지·Flavor Print, 조작 검토를 운영 가능한 첫 평가 릴리스로 만든다.

**Architecture:** 기존 `vote_events`와 `current_votes`는 불변 원본으로 유지하고 순수 TypeScript `rating-v2` 엔진이 버전된 입력을 결정론적으로 계산한다. D1에는 설정·스냅샷·재계산 작업·배지·Flavor Print·무효화·조작 사건을 별도 저장하며, React Router loader/action은 도메인 서비스만 호출한다. 투표 요청은 원시 이벤트 저장과 재계산 작업 등록까지만 수행하고, 예약 작업과 관리자 action이 작은 배치로 스냅샷을 갱신한다.

**Tech Stack:** React Router 8 Framework Mode, TypeScript 5.9, Cloudflare Workers, D1, Drizzle ORM, Vitest Workers integration, Playwright.

## Global Constraints

- 공개 최소 표본은 활성 투표 8개이며 하위 집단도 각각 8개부터 숫자를 공개한다.
- Beta prior는 `alpha0=2`, `beta0=2`다.
- 일반 회원 투표 가중치는 1이고 리뷰어 유효 가중치는 결합 가중치의 최대 30%다.
- 리뷰어 신뢰 가중치는 5개 미만 비교 시 1.00, 이후 `clamp(0.60, 1.40, 0.60 + 0.80 × posteriorAccuracy)`다.
- 유사 군집은 공통 10곳 이상·방향 일치율 80% 이상이며 군집 크기 `k`에 `1 / sqrt(k)`를 적용한다.
- 평가 결과와 배지는 결제·광고·캠페인 데이터를 읽지 않는다.
- 관리자는 원시 투표를 수정하지 않고 무효화 레코드와 감사 로그를 남긴다.
- 새 UI는 기존 Noto Sans KR 체계와 400~600 중심 weight를 사용한다.

---

### Task 1: Rating v2 pure engine

**Files:**
- Create: `app/features/ratings/rating-v2.ts`
- Create: `app/features/ratings/reviewer-similarity.ts`
- Create: `app/features/ratings/rating-badges.ts`
- Test: `tests/unit/rating-v2.test.ts`
- Test: `tests/unit/reviewer-similarity.test.ts`
- Test: `tests/unit/rating-badges.test.ts`

**Interfaces:**
- Produces: `calculateRatingV2(input): RatingV2Result`, `buildReviewerClusters(votes): ReviewerCluster[]`, `evaluateHiddenGem(input)`, `evaluateHotTake(input)`.
- Consumes: plain serializable values only; no D1 or React dependencies.

- [ ] **Step 1: Write failing boundary tests** for 7/8 total votes, independent subgroup visibility, Beta(2,2), reviewer 30% cap, CALIBRATING trust, mature trust clamp, deterministic similarity clusters, square-root damping, Hidden Gem and Hot Take thresholds.
- [ ] **Step 2: Run** `npm test -- tests/unit/rating-v2.test.ts tests/unit/reviewer-similarity.test.ts tests/unit/rating-badges.test.ts` and verify failures are missing exports.
- [ ] **Step 3: Implement minimal pure functions** with explicit `rating-v2.0` result types, stable sorting before cluster construction, finite-number guards, and serialized calculation reasons.
- [ ] **Step 4: Run the three unit files** and confirm all boundary cases pass.
- [ ] **Step 5: Commit** `2026-08-06 평가 v2 순수 계산 엔진`.

### Task 2: Versioned D1 schema

**Files:**
- Modify: `app/db/schema.ts`
- Create: `drizzle/0005_rating_foundation.sql`
- Modify: `tests/unit/schema-contract.test.ts`
- Modify: `tests/integration/apply-migrations.ts`

**Interfaces:**
- Produces tables `rating_configs`, `rating_snapshots`, `reviewer_reliability_snapshots`, `reviewer_similarity_edges`, `rating_recompute_jobs`, `golden_pick_events`, `flavor_templates`, `flavor_ratings`, `place_daily_metrics`, `integrity_cases`, `invalidated_vote_events`.
- Preserves existing vote and place foreign-key behavior.

- [ ] **Step 1: Add failing schema contract tests** for every table, primary/unique key, status check, and lookup index.
- [ ] **Step 2: Run** `npm test -- tests/unit/schema-contract.test.ts` and verify missing-table failures.
- [ ] **Step 3: Add Drizzle declarations and idempotent migration** including one active `rating-v2.0` config row and indexes for stale snapshots, queued jobs, active badges, open cases, reviewer/place Flavor ratings.
- [ ] **Step 4: Run schema unit and integration migration tests** with `npm test -- tests/unit/schema-contract.test.ts` and `npm run test:integration -- tests/integration/place.server.test.ts`.
- [ ] **Step 5: Commit** `2026-08-06 평가 기반 D1 스키마`.

### Task 3: Snapshot recomputation service

**Files:**
- Create: `app/features/ratings/rating-config.server.ts`
- Create: `app/features/ratings/recompute.server.ts`
- Create: `tests/integration/rating-recompute.server.test.ts`
- Modify: `app/features/ratings/vote.server.ts`
- Modify: `tests/integration/vote.server.test.ts`

**Interfaces:**
- Produces: `markRatingStale(db, placeId, now)`, `enqueueRatingRecompute(db, input)`, `recomputePlaceRating(db, input)`, `processRatingJobs(db, input)`.
- Consumes Task 1 engine and Task 2 tables.

- [ ] **Step 1: Write failing integration tests** proving a vote creates/updates the current vote and a single queued job, recomputation separates USER/REVIEWER, ignores invalidated events, writes version/input hash/reason JSON, is idempotent, and leaves the last good snapshot on failure.
- [ ] **Step 2: Run** `npm run test:integration -- tests/integration/rating-recompute.server.test.ts tests/integration/vote.server.test.ts` and verify missing-service failures.
- [ ] **Step 3: Implement services** using D1 batches for vote+stale+job writes, stable input hashing through Web Crypto, and bounded job processing.
- [ ] **Step 4: Run the two integration files** and ensure no existing vote behavior regresses.
- [ ] **Step 5: Commit** `2026-08-06 평가 스냅샷 재계산 파이프라인`.

### Task 4: Golden Pick and Flavor Print

**Files:**
- Create: `app/features/ratings/golden-pick.server.ts`
- Create: `app/features/ratings/flavor-print.server.ts`
- Create: `tests/integration/golden-pick.server.test.ts`
- Create: `tests/integration/flavor-print.server.test.ts`

**Interfaces:**
- Produces `grantGoldenPick`, `withdrawGoldenPick`, `expireGoldenPicks`, `saveFlavorTemplate`, `submitFlavorRating`, `getPlaceFlavorPrint`, `getMemberTasteGraph`.
- Requires active REVIEWER profile and server-owned current time.

- [ ] **Step 1: Write failing integration tests** for active reviewer authorization, monthly maximum 3, same-place 90-day rule, expiration/withdrawal, 5–7 template dimensions, 1–5 values, reviewer confidence, 3-rating place visibility, and 5-place member taste visibility.
- [ ] **Step 2: Run both integration files** and verify missing exports.
- [ ] **Step 3: Implement services** with D1 constraints, explicit error codes, median/quartile calculation, and reviewer activity timestamp updates.
- [ ] **Step 4: Run both integration files** and related reviewer tests.
- [ ] **Step 5: Commit** `2026-08-06 Golden Pick과 Flavor Print`.

### Task 5: Integrity cases and invalidation

**Files:**
- Create: `app/features/ratings/integrity.server.ts`
- Create: `tests/integration/integrity.server.test.ts`
- Modify: `app/features/ratings/vote.server.ts`

**Interfaces:**
- Produces `scanVoteIntegrity`, `listIntegrityCases`, `transitionIntegrityCase`, `invalidateVoteEvent`.
- A confirmed case records invalidation and queues recomputation; it never deletes `vote_events`.

- [ ] **Step 1: Write failing tests** for burst, repeated-change, correlated-cluster, hidden-place signals, deduplicated open cases, valid state transitions, required admin reason, immutable raw events, and queued recomputation.
- [ ] **Step 2: Run** `npm run test:integration -- tests/integration/integrity.server.test.ts` and verify failures.
- [ ] **Step 3: Implement signal scanning and admin transitions** without IP/device collection and with `admin_audit_logs` entries.
- [ ] **Step 4: Run integrity, vote, and recompute integration tests**.
- [ ] **Step 5: Commit** `2026-08-06 평가 조작 검토 사건 관리`.

### Task 6: Member and reviewer rating UI

**Files:**
- Modify: `app/features/places/place.server.ts`
- Modify: `app/routes/place-detail.tsx`
- Modify: `app/routes/me.tsx`
- Create: `app/routes/reviewer-ratings.tsx`
- Modify: `app/routes.ts`
- Modify: `app/app.css`
- Create: `tests/e2e/rating-foundation.spec.ts`

**Interfaces:**
- Place detail consumes latest good snapshot and active badges; reviewer route consumes templates, current rating, Golden Pick quota.
- All mutations use route actions and server role guards.

- [ ] **Step 1: Add failing E2E assertions** for `n/8` copy, 8-vote score, separated subgroup disclosure, stale label, Golden Pick, Hot Take context, Flavor Print, reviewer submission, and member taste learning state.
- [ ] **Step 2: Run the E2E file** against local fixtures and verify missing UI failures.
- [ ] **Step 3: Implement loaders/actions and UI** with existing visual language, accessible labels, weight 400–600, mobile layouts, and no internal integrity details on public pages.
- [ ] **Step 4: Run rating E2E plus existing browse/vote-save tests**.
- [ ] **Step 5: Commit** `2026-08-06 회원·리뷰어 평가 경험`.

### Task 7: Admin rating operations and scheduler

**Files:**
- Create: `app/routes/admin-ratings.tsx`
- Modify: `app/routes.ts`
- Modify: `workers/app.ts`
- Create: `tests/e2e/admin-rating-operations.spec.ts`
- Create: `tests/integration/rating-scheduler.test.ts`

**Interfaces:**
- Admin route lists stale snapshots, failed jobs, open integrity cases, rating version and badge distribution.
- Scheduled handler processes bounded recompute jobs, expires Golden Picks, scans new integrity signals, and preserves existing public-data sync.

- [ ] **Step 1: Write failing scheduler and E2E tests** for bounded processing, retry state, last-good snapshot, admin-only access, manual recompute, case transitions, and audit records.
- [ ] **Step 2: Run targeted tests** and verify missing route/handler failures.
- [ ] **Step 3: Implement route and compose scheduled tasks** with every promise awaited or passed to `ctx.waitUntil`, structured error records, and no mutable request state.
- [ ] **Step 4: Run targeted tests and existing scheduled sync tests**.
- [ ] **Step 5: Commit** `2026-08-06 평가 운영 대시보드와 스케줄러`.

### Task 8: Full verification, migration, PR, and deployment

**Files:**
- Modify: `docs/operations/week1-data-runbook.md`
- Modify: `docs/superpowers/specs/2026-08-05-tastedit-product-direction-v2-design.md`

**Interfaces:**
- Documents operational recompute, integrity review, rollback, and marks rating-foundation items complete.

- [ ] **Step 1: Document** local/remote migration, snapshot rebuild, failed-job recovery, integrity review, and rollback commands.
- [ ] **Step 2: Run** `npm run typecheck`, `npm test`, `npm run test:integration`, `npm run build`, and all relevant Playwright tests.
- [ ] **Step 3: Review** full diff for secrets, destructive SQL, role bypass, unbounded queries, and excessive font weight.
- [ ] **Step 4: Push feature branch, open PR, wait for checks, inspect PR diff, and squash merge.**
- [ ] **Step 5: Export production D1, apply `0005_rating_foundation.sql`, deploy merged `main`, run production smoke/E2E, and record Worker version.**

