# 주차 데이터 기반과 거리 우선 추천 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 광주·전남 주차장 스냅샷을 90일마다 안전하게 갱신하고, 두 장소에 대해 거리 우선으로 한 곳 주차와 장소별 주차를 비교한다.

**Architecture:** 외부 응답 파싱, 순수 거리·요금·순위 계산, D1 저장소, 예약 동기화를 분리한다. 추천 요청은 활성 D1 스냅샷만 읽으며 외부 API 장애나 데이터 미존재 시 구조화된 빈 결과를 반환한다.

**Tech Stack:** TypeScript 7, Vitest, Drizzle ORM, Cloudflare Workers, D1, Wrangler

## Global Constraints

- 신규 migration은 `drizzle/0014_parking_foundation.sql` 하나로 추가하고 기존 migration은 수정하지 않는다.
- `DATA_GO_KR_SERVICE_KEY` 값은 코드·로그·테스트 산출물에 기록하지 않는다.
- 실제 외부 API, 원격 D1 migration, 운영 배포는 이 구현·검증 단계에서 실행하지 않는다.
- 대표 추천은 신뢰도 A·B만 사용하고 좌표·공개 이용·운영시간·기준일 게이트를 먼저 통과해야 한다.
- 거리는 하버사인 직선거리 × 1.25를 10m 단위로 반올림한 `예상 도보거리`다.
- 알고리즘 버전은 `parking-course-v1`이다.

---

### Task 1: 순수 거리·요금·운영시간 계산

**Files:**
- Create: `app/features/parking/parking-types.ts`
- Create: `app/features/parking/parking-distance.ts`
- Create: `app/features/parking/parking-fee.ts`
- Create: `app/features/parking/parking-hours.ts`
- Test: `tests/unit/parking-distance.test.ts`
- Test: `tests/unit/parking-fee.test.ts`
- Test: `tests/unit/parking-hours.test.ts`

**Interfaces:**
- Produces: `estimateWalkingMeters(a, b): number`, `calculateEstimatedFee(rule, minutes): number | null`, `isParkingOpenForWindow(schedule, start, end): boolean`.

- [ ] **Step 1: Write failing tests** for 10m rounding, `430/450` balanced distance, unknown fee as `null`, daily fee cap, midnight window and 30-minute exit margin.
- [ ] **Step 2: Verify RED** with `pnpm test -- tests/unit/parking-distance.test.ts tests/unit/parking-fee.test.ts tests/unit/parking-hours.test.ts`; expect missing-module failures.
- [ ] **Step 3: Implement minimal pure functions** with explicit nullable inputs and no database or environment imports.
- [ ] **Step 4: Verify GREEN** with the same command; expect all new tests PASS.
- [ ] **Step 5: Commit** with `git add app/features/parking tests/unit/parking-*.test.ts && git commit -m "2026-08-08 주차 거리·요금 계산 추가"`.

### Task 2: 거리권과 주차 방식 순위

**Files:**
- Create: `app/features/parking/parking-score.ts`
- Test: `tests/unit/parking-score.test.ts`

**Interfaces:**
- Consumes: `estimateWalkingMeters`, `calculateEstimatedFee`.
- Produces: `rankSharedParking(input): RankedParking[]`, `rankSeparateParking(input): SeparateParkingPlan[]`, `compareParkingModes(input): ParkingRecommendation`.

- [ ] **Step 1: Write failing tests** proving 200m private beats 900m public, balanced distances beat an 850m long leg, auxiliary traits only reorder the +150m/+250m cohort, capacity saturates at 300, EV required filters, separate mode includes return walking and 7 minutes, and a score gap under 5 returns `BOTH_SIMILAR`.
- [ ] **Step 2: Verify RED** with `pnpm test -- tests/unit/parking-score.test.ts`; expect missing exports.
- [ ] **Step 3: Implement deterministic ranking** using distance burden `0.65*max + 0.35*mean`, default/rain limits, lexicographic auxiliary comparison, and place/parking IDs as final tie-breakers.
- [ ] **Step 4: Verify GREEN** with the same command.
- [ ] **Step 5: Commit** with `git add app/features/parking/parking-score.ts tests/unit/parking-score.test.ts && git commit -m "2026-08-08 거리 우선 주차 추천 추가"`.

### Task 3: 주차·전기차 공공데이터 정규화

**Files:**
- Create: `app/features/parking/parking-data.ts`
- Create: `app/features/parking/ev-data.ts`
- Test: `tests/unit/parking-data.test.ts`
- Test: `tests/unit/ev-data.test.ts`

**Interfaces:**
- Produces: `buildParkingDataUrl({ serviceKey, page, rows }): URL`, `parseParkingResponse(payload): NormalizedParkingPage`, `parseEvResponse(payload): NormalizedEvPage`.

- [ ] **Step 1: Write failing fixture-based tests** for decoded/encoded service keys, XML-like JSON wrappers, 광주·전남 filtering, nullable fee/capacity, valid coordinates, removed chargers and `ONSITE_CONFIRMED` versus `NEARBY_ONLY`.
- [ ] **Step 2: Verify RED** with `pnpm test -- tests/unit/parking-data.test.ts tests/unit/ev-data.test.ts`.
- [ ] **Step 3: Implement defensive parsers** that retain raw payload JSON but never include the service key.
- [ ] **Step 4: Verify GREEN** with the same command.
- [ ] **Step 5: Commit** with `git add app/features/parking tests/unit/parking-data.test.ts tests/unit/ev-data.test.ts && git commit -m "2026-08-08 주차 공공데이터 정규화 추가"`.

### Task 4: D1 스냅샷 스키마와 저장소

**Files:**
- Create: `drizzle/0014_parking_foundation.sql`
- Modify: `app/db/schema.ts`
- Create: `app/features/parking/parking-repository.server.ts`
- Test: `tests/integration/parking-repository.server.test.ts`
- Modify: `tests/unit/schema-contract.test.ts`

**Interfaces:**
- Produces: `listEligibleParking(db, bounds, window): Promise<ParkingFacility[]>`, `getActiveParkingSnapshot(db): Promise<SnapshotMetadata | null>`, `activateParkingSnapshot(db, id): Promise<void>`.

- [ ] **Step 1: Add failing schema-contract and integration tests** for new tables/indexes, ACTIVE-only queries and atomic retirement/activation.
- [ ] **Step 2: Verify RED** with `pnpm test -- tests/unit/schema-contract.test.ts` and `pnpm test:integration -- tests/integration/parking-repository.server.test.ts`.
- [ ] **Step 3: Add migration, matching Drizzle tables and bounded repository queries** without editing migrations 0000–0013.
- [ ] **Step 4: Verify GREEN** with both commands.
- [ ] **Step 5: Commit** with `git add drizzle/0014_parking_foundation.sql app/db/schema.ts app/features/parking/parking-repository.server.ts tests && git commit -m "2026-08-08 주차 스냅샷 저장소 추가"`.

### Task 5: 추천 오케스트레이션과 안전한 빈 결과

**Files:**
- Create: `app/features/parking/parking-recommendation.server.ts`
- Test: `tests/integration/parking-recommendation.server.test.ts`

**Interfaces:**
- Produces: `recommendParkingForCourse(db, input): Promise<ParkingRecommendationResult>` with `algorithmVersion`, snapshot metadata, `shared`, `separate`, `recommendedMode`, and warnings.

- [ ] **Step 1: Write failing integration tests** for ACTIVE A/B-only loading, no snapshot returning `PARKING_DATA_UNAVAILABLE`, no eligible facilities returning `NO_ELIGIBLE_PARKING`, and deterministic result metadata.
- [ ] **Step 2: Verify RED** with `pnpm test:integration -- tests/integration/parking-recommendation.server.test.ts`.
- [ ] **Step 3: Implement one bounded D1 read and pure algorithm composition**; do not call `fetch`.
- [ ] **Step 4: Verify GREEN** with the same command.
- [ ] **Step 5: Commit** with `git add app/features/parking/parking-recommendation.server.ts tests/integration/parking-recommendation.server.test.ts && git commit -m "2026-08-08 주차 추천 서비스 연결"`.

### Task 6: 90일 예약 동기화

**Files:**
- Create: `app/features/parking/parking-sync.server.ts`
- Create: `app/features/parking/scheduled-parking.server.ts`
- Modify: `workers/app.ts`
- Test: `tests/integration/parking-sync.test.ts`
- Test: `tests/integration/parking-scheduler.test.ts`

**Interfaces:**
- Produces: `syncParkingDataBatch(db, options): Promise<SyncBatchResult>`, `runScheduledParkingSync(options?): Promise<ScheduledParkingResult>`.

- [ ] **Step 1: Write failing tests** with mock fetchers for 90-day no-op, three-page cap, resume page, region filtering, quality rejection, and preserving prior ACTIVE snapshot on failure.
- [ ] **Step 2: Verify RED** with `pnpm test:integration -- tests/integration/parking-sync.test.ts tests/integration/parking-scheduler.test.ts`.
- [ ] **Step 3: Implement resumable STAGING sync and add it to the existing Worker `Promise.all` scheduler** with `ctx.waitUntil` handling unchanged.
- [ ] **Step 4: Verify GREEN** with the same command and `pnpm run typecheck`.
- [ ] **Step 5: Commit** with `git add app/features/parking workers/app.ts tests/integration && git commit -m "2026-08-08 주차 90일 동기화 추가"`.

### Task 7: 전체 회귀 검증

**Files:**
- Modify only if a verified defect is found.

- [ ] **Step 1: Run unit tests** with `pnpm test`; expect all tests PASS.
- [ ] **Step 2: Run integration tests** with `pnpm test:integration`; expect all tests PASS.
- [ ] **Step 3: Run type and build checks** with `pnpm run typecheck && pnpm run build`; expect exit code 0.
- [ ] **Step 4: Review** `git diff --check` and ensure no secret or real API response is present.

