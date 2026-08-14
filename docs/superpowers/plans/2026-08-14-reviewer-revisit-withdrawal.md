# 리뷰 최초 1회·90일 재방문·철회·프로필 정리 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**목표:** 동일 리뷰어·장소의 점수 반영 리뷰를 최초 1회로 제한하고, 90일 후 기록은 점수 0의 재방문 확인으로 저장하며, 실제 철회와 프로필 상태 UX를 데이터베이스까지 일관되게 구현한다.

**구조:** 기존 `reviewer_visit_reviews`를 최초 리뷰와 재방문 확인의 공통 append-only 기록으로 확장한다. 부분 고유 인덱스와 idempotency key가 중복 발행을 막고, 철회는 상태 변경·현재 vote event 조건부 제거·Golden Pick 철회·사진 비공개·재계산 예약을 하나의 D1 경계에서 처리한다. 화면은 서버가 계산한 `ReviewEligibility`에 따라 최초/쿨다운/재방문 모드를 렌더링한다.

**기술 스택:** React 19, React Router 8, TypeScript strict, Zod, Drizzle ORM, Cloudflare D1/R2, Vitest, Workers integration, Playwright

## 전역 제약

- [ ] 구현은 이 설계 PR이 병합되어 `ACCEPTED`가 된 뒤 최신 `origin/main`의 새 feature branch/worktree에서 시작한다.
- [ ] Issue #97 또는 구현 PR에 담당자와 아래 소유 파일, migration, 운영 대상, rollback을 기록한다.
- [ ] 리뷰 재방문 PR과 사진 큐레이션 PR을 분리한다. 이 계획이 먼저 병합된다.
- [ ] 기존 0027 이하 migration을 수정하지 않고 다음 순번 migration을 추가한다.
- [ ] migration 전에 운영과 동일한 local snapshot/fixture로 중복 최초 리뷰 사전 감사를 실행한다.
- [ ] 90일·상태·현재 vote 조건은 애플리케이션 사전 조회가 아니라 D1 제약과 조건부 mutation이 최종 방어선이다.
- [ ] withdrawn row를 삭제하지 않는다. 감사 목적의 최소 데이터는 보존하고 public query에서 제외한다.
- [ ] 각 Task마다 RED → GREEN → mutation proof → typecheck/diff-check → 자체 검수 → 한국어 커밋 순서를 지킨다.

---

## Task 1. migration 사전 감사와 리뷰 상태 스키마

**소유 파일**

- Create: `scripts/audit-reviewer-revisit-readiness.sql`
- Create: `drizzle/0028_reviewer_revisit_withdrawal.sql`
- Modify: `app/db/schema.ts`
- Modify: `tests/unit/schema-contract.test.ts`
- Create: `tests/integration/reviewer-revisit-migration.test.ts`

### 1.1 RED — 기존 데이터 준비도 감사

- [ ] 다음 사전 감사 SQL을 먼저 작성한다.

```sql
SELECT reviewer_user_id, place_id, COUNT(*) AS review_count
FROM reviewer_visit_reviews
GROUP BY reviewer_user_id, place_id
HAVING COUNT(*) > 1;
```

- [ ] duplicate group, orphan golden event, photo_count 불일치, 존재하지 않는 current vote reference를 함께 출력한다.
- [ ] 스크립트는 read-only SELECT만 포함하고 DELETE/UPDATE를 포함하지 않는 contract test를 작성한다.
- [ ] 운영 migration 승인 조건은 최초 리뷰 중복 0건이다. 중복이 있으면 자동 삭제하지 않고 별도 데이터 정정 PR로 분리한다.

### 1.2 RED — schema 계약

- [ ] schema unit에 다음 column/index 기대를 먼저 작성한다.
  - `reviewKind`: `PRIMARY | REVISIT`
  - `status`: `PUBLISHED | WITHDRAWN`
  - `rootReviewId`, `previousReviewId`
  - `publishRequestKey`
  - `voteEventId`
  - `revisitVerdict`: `SAME | CHANGED | PLACE_CHANGED | null`
  - `withdrawnAt`, `withdrawnBy`, `withdrawReason`
  - PRIMARY 부분 고유 index
  - previousReviewId 부분 고유 index
  - reviewer + publishRequestKey 고유 index
- [ ] migration integration을 RED로 작성한다.
  - 0000→0028 순차 적용
  - 기존 row가 `PRIMARY/PUBLISHED`로 읽힘
  - 같은 reviewer/place PRIMARY 두 건 거부
  - 같은 previous review에 REVISIT 두 건 거부
  - 다른 reviewer의 같은 request key는 허용, 같은 reviewer replay는 거부

### 1.3 GREEN — 0028 migration

- [ ] 다음 column을 additive migration으로 추가한다.

```sql
ALTER TABLE reviewer_visit_reviews ADD COLUMN review_kind TEXT NOT NULL DEFAULT 'PRIMARY'
  CHECK (review_kind IN ('PRIMARY', 'REVISIT'));
ALTER TABLE reviewer_visit_reviews ADD COLUMN status TEXT NOT NULL DEFAULT 'PUBLISHED'
  CHECK (status IN ('PUBLISHED', 'WITHDRAWN'));
ALTER TABLE reviewer_visit_reviews ADD COLUMN root_review_id TEXT REFERENCES reviewer_visit_reviews(id) ON DELETE RESTRICT;
ALTER TABLE reviewer_visit_reviews ADD COLUMN previous_review_id TEXT REFERENCES reviewer_visit_reviews(id) ON DELETE RESTRICT;
ALTER TABLE reviewer_visit_reviews ADD COLUMN publish_request_key TEXT;
ALTER TABLE reviewer_visit_reviews ADD COLUMN vote_event_id TEXT REFERENCES vote_events(id) ON DELETE RESTRICT;
ALTER TABLE reviewer_visit_reviews ADD COLUMN revisit_verdict TEXT
  CHECK (revisit_verdict IS NULL OR revisit_verdict IN ('SAME', 'CHANGED', 'PLACE_CHANGED'));
ALTER TABLE reviewer_visit_reviews ADD COLUMN withdrawn_at TEXT;
ALTER TABLE reviewer_visit_reviews ADD COLUMN withdrawn_by TEXT REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE reviewer_visit_reviews ADD COLUMN withdraw_reason TEXT;
```

- [ ] index를 추가한다.

```sql
CREATE UNIQUE INDEX reviewer_visit_reviews_primary_once_uidx
ON reviewer_visit_reviews(reviewer_user_id, place_id)
WHERE review_kind = 'PRIMARY';

CREATE UNIQUE INDEX reviewer_visit_reviews_previous_once_uidx
ON reviewer_visit_reviews(previous_review_id)
WHERE previous_review_id IS NOT NULL;

CREATE UNIQUE INDEX reviewer_visit_reviews_request_uidx
ON reviewer_visit_reviews(reviewer_user_id, publish_request_key)
WHERE publish_request_key IS NOT NULL;

CREATE INDEX reviewer_visit_reviews_place_status_published_idx
ON reviewer_visit_reviews(place_id, status, published_at DESC);
```

- [ ] 기존 row에는 migration default를 사용한다. 임의 `publish_request_key`를 backfill하지 않는다.
- [ ] Drizzle schema에서 self-reference inference가 막히면 명시적 `AnySQLiteColumn` callback을 사용하고 `any`로 우회하지 않는다.

### 1.4 검증·커밋

```bash
pnpm test -- tests/unit/schema-contract.test.ts
pnpm run test:integration -- tests/integration/reviewer-revisit-migration.test.ts
pnpm run typecheck
git diff --check
```

- [ ] migration down SQL은 만들지 않고 rollback은 code flag off + forward repair migration으로 문서화한다.
- [ ] 커밋한다.

```bash
git add scripts/audit-reviewer-revisit-readiness.sql drizzle/0028_reviewer_revisit_withdrawal.sql app/db/schema.ts tests/unit/schema-contract.test.ts tests/integration/reviewer-revisit-migration.test.ts
git commit -m "2026-08-14 리뷰 재방문과 철회 스키마"
```

---

## Task 2. 90일 자격 계산과 발행 요청번호

**소유 파일**

- Create: `app/features/ratings/reviewer-revisit.ts`
- Modify: `app/features/ratings/reviewer-visit.ts`
- Modify: `app/features/ratings/reviewer-visit.server.ts`
- Modify: `app/routes/reviewer-ratings.tsx`
- Create: `tests/unit/reviewer-revisit.test.ts`
- Modify: `tests/integration/reviewer-visit.server.test.ts`

### 2.1 RED — 순수 eligibility

- [ ] 시간대를 암묵적으로 사용하지 않는 table-driven 테스트를 작성한다.
  - 기록 없음 → `PRIMARY_AVAILABLE`
  - 89일 23:59:59 → `COOLDOWN`
  - 정확히 90일 → `REVISIT_AVAILABLE`
  - withdrawn 기록도 cooldown anchor에 포함
  - 마지막 REVISIT부터 다시 90일
  - 미래 시각·invalid timestamp → fail closed

### 2.2 GREEN — 명시적 계약

- [ ] 다음 union을 구현한다.

```ts
export type ReviewEligibility =
  | { kind: "PRIMARY_AVAILABLE"; requestKey: string }
  | { kind: "COOLDOWN"; primaryReviewId: string; lastRecordId: string; nextAvailableAt: string }
  | {
      kind: "REVISIT_AVAILABLE";
      requestKey: string;
      primaryReviewId: string;
      previousReviewId: string;
      previousEvaluation: "RECOMMEND" | "HOLD" | "NOT_RECOMMEND";
      previousBadges: string[];
    };
```

- [ ] `REVISIT_COOLDOWN_DAYS = 90`과 `addUtcDays(iso, days)`를 순수 함수로 둔다.
- [ ] `getReviewerPlaceEligibility(db,{reviewerUserId,placeId,now})`는 withdrawn 포함 모든 기록의 최신 publishedAt을 읽는다.
- [ ] loader가 장소별 eligibility 1차 map을 반환하되 전체 장소 N+1 query를 만들지 않는다. reviewer의 모든 기록을 한 query로 읽고 placeId별 최신 기록을 메모리에서 계산한다.

### 2.3 발행 요청번호

- [ ] 화면 loader 진입 시 무작위 `crypto.randomUUID()` request key를 발급한다.
- [ ] request key는 장소별 eligibility가 확정된 뒤 hidden field로 전달한다.
- [ ] key는 URL, 로그, localStorage에 저장하지 않는다.
- [ ] 같은 화면 재전송은 같은 key를 유지하고, 새로고침은 새 key를 받는다. 서버 idempotency가 기존 성공을 찾아 redirect한다.

### 2.4 검증·커밋

```bash
pnpm test -- tests/unit/reviewer-revisit.test.ts
pnpm run test:integration -- tests/integration/reviewer-visit.server.test.ts
pnpm run typecheck
git diff --check
```

```bash
git add app/features/ratings/reviewer-revisit.ts app/features/ratings/reviewer-visit.ts app/features/ratings/reviewer-visit.server.ts app/routes/reviewer-ratings.tsx tests/unit/reviewer-revisit.test.ts tests/integration/reviewer-visit.server.test.ts
git commit -m "2026-08-14 리뷰 90일 재방문 자격과 요청 식별자"
```

---

## Task 3. 최초 발행 중복 방지와 idempotent publish

**소유 파일**

- Modify: `app/features/ratings/reviewer-visit-publish.server.ts`
- Modify: `app/features/ratings/reviewer-visit.server.ts`
- Modify: `app/components/reviewer-visit-flow.tsx`
- Modify: `tests/integration/reviewer-visit.server.test.ts`
- Modify: `tests/integration/reviewer-ratings-route.test.ts`
- Modify: `tests/e2e/reviewer-photo-upload.spec.ts`

### 3.1 RED — 경쟁·재전송

- [ ] 실제 D1에서 같은 reviewer/place의 PRIMARY 동시 발행 두 건을 실행하고 리뷰·vote·Golden·photo metadata가 한 세트만 생기는지 작성한다.
- [ ] 같은 `publishRequestKey`를 순차 재전송하면 같은 reviewId redirect를 반환하는지 작성한다.
- [ ] 서로 다른 key의 두 요청 중 DB unique에서 진 요청은 `REVIEW_ALREADY_PUBLISHED` 409와 기존 reviewId를 반환하는지 작성한다.
- [ ] 사진 R2 put 전에 eligibility가 막혀 불필요한 object가 생성되지 않는지 작성한다.

### 3.2 GREEN — 서버 입력과 idempotency

- [ ] `parseReviewerVisitSubmission`에 다음 strict field를 추가한다.

```ts
reviewKind: z.enum(["PRIMARY", "REVISIT"]),
publishRequestKey: z.string().uuid(),
primaryReviewId: z.string().uuid().optional(),
previousReviewId: z.string().uuid().optional(),
revisitVerdict: z.enum(["SAME", "CHANGED", "PLACE_CHANGED"]).optional(),
```

- [ ] publish 시작 직후 `(reviewerUserId,publishRequestKey)` 기존 row를 확인해 동일 사용자의 기존 성공만 반환한다.
- [ ] R2 write 전에 서버가 eligibility를 다시 계산한다.
- [ ] PRIMARY는 `rootReviewId = id`, `previousReviewId = null`, `voteEventId`에 실제 생성 vote event ID를 저장한다.
- [ ] unique conflict catch에서 request key와 reviewer ownership을 다시 확인한다. 다른 사용자의 review 정보를 반환하지 않는다.
- [ ] commit 후 응답 유실은 기존 `readCommittedPhotoPublish`를 새 column까지 엄격 비교해 복구한다.

### 3.3 GREEN — 클라이언트 동기 잠금

- [ ] 현재 fetcher 상태 잠금에 더해 `publishLockRef.current`를 click handler 첫 줄에서 설정한다.
- [ ] 제출 성공 또는 명시적 오류 후에만 해제한다.
- [ ] 발행 중 이전/다음/사진/Golden controls를 모두 비활성화한다.
- [ ] E2E에서 React render 사이 같은 tick 두 click을 주입하고 network request 1회·리뷰 1행을 검증한다.

### 3.4 mutation proof·커밋

- [ ] DB unique index를 임시 제거하면 동시성 테스트가 실패하는지, ref lock 제거 시 E2E request count가 실패하는지 확인한다.

```bash
pnpm run test:integration -- tests/integration/reviewer-visit.server.test.ts tests/integration/reviewer-ratings-route.test.ts
pnpm exec playwright test tests/e2e/reviewer-photo-upload.spec.ts --project=chromium --project=mobile-chromium
pnpm run typecheck
git diff --check
```

```bash
git add app/features/ratings/reviewer-visit-publish.server.ts app/features/ratings/reviewer-visit.server.ts app/components/reviewer-visit-flow.tsx tests/integration/reviewer-visit.server.test.ts tests/integration/reviewer-ratings-route.test.ts tests/e2e/reviewer-photo-upload.spec.ts
git commit -m "2026-08-14 리뷰 발행 중복과 재전송 방어"
```

---

## Task 4. 점수 0의 재방문 확인 발행

**소유 파일**

- Modify: `app/features/ratings/reviewer-visit.server.ts`
- Modify: `app/features/ratings/reviewer-visit-publish.server.ts`
- Modify: `app/components/reviewer-visit-flow.tsx`
- Modify: `app/routes/reviewer-ratings.tsx`
- Modify: `tests/integration/reviewer-visit.server.test.ts`
- Create: `tests/e2e/reviewer-revisit.spec.ts`

### 4.1 RED — 재방문은 파생 점수를 바꾸지 않는다

- [ ] 90일 이후 REVISIT 발행 전후를 비교한다.
  - `vote_events` 증가 0
  - `current_votes` 불변
  - `golden_pick_events` 증가 0
  - `rating_recompute_jobs` 증가 0
  - `flavor_ratings` 불변
  - review row만 `REVISIT/PUBLISHED`로 1행 생성
- [ ] 89일 요청은 `409 REVISIT_COOLDOWN_ACTIVE`와 `nextAvailableAt` 반환.
- [ ] same previousReviewId 동시 요청 하나만 성공.
- [ ] `PLACE_CHANGED`는 `place_revalidation_cases`에 중복 없는 OPEN case를 만든다.

### 4.2 GREEN — REVISIT 서비스 분기

- [ ] `publishReviewerVisitInternal`을 억지 boolean 분기로 키우지 않고 다음 두 명시적 내부 함수로 나눈다.

```ts
async function publishPrimaryReview(...): Promise<PublishedReview>;
async function publishRevisitConfirmation(...): Promise<PublishedReview>;
```

- [ ] 공통 badge/photo validation은 공유하되 REVISIT는 다음을 강제한다.
  - `golden=false`
  - evaluation은 primary의 기존 evaluation snapshot
  - badges는 기존과 달라진 것만 최대 2개
  - vote/golden/recompute statement 없음
  - `rootReviewId=primary.id`, `previousReviewId=latest.id`
- [ ] `CHANGED`는 공개 신뢰 배지용 상태만 생성하고 기존 점수를 자동 철회하지 않는다.
- [ ] `PLACE_CHANGED`는 개인정보 없는 evidence로 운영 case를 만들고 기존 점수는 그대로 둔다.

### 4.3 GREEN — 재방문 UI

- [ ] 장소 선택 시 eligibility에 따라 흐름을 바꾼다.
  - PRIMARY: 기존 5단계
  - COOLDOWN: 입력 대신 다음 가능일 안내
  - REVISIT: `그대로예요 / 달라졌어요 / 장소 정보가 달라요` 선택 → 변경 배지 → 사진 → 확인
- [ ] 확인 화면에 `점수와 표본 수에는 추가되지 않아요`를 명확히 표시한다.
- [ ] 성공 문구는 `재방문 확인 완료`와 `점수는 늘리지 않고 최근 확인 기록으로 남겼어요`로 분리한다.

### 4.4 검증·커밋

```bash
pnpm test -- tests/unit/reviewer-revisit.test.ts
pnpm run test:integration -- tests/integration/reviewer-visit.server.test.ts
pnpm exec playwright test tests/e2e/reviewer-revisit.spec.ts --project=chromium --project=mobile-chromium
pnpm run typecheck
git diff --check
```

```bash
git add app/features/ratings/reviewer-visit.server.ts app/features/ratings/reviewer-visit-publish.server.ts app/components/reviewer-visit-flow.tsx app/routes/reviewer-ratings.tsx tests/integration/reviewer-visit.server.test.ts tests/e2e/reviewer-revisit.spec.ts
git commit -m "2026-08-14 점수 없는 90일 재방문 확인"
```

---

## Task 5. 실제 리뷰 철회와 조건부 vote 제거

**소유 파일**

- Create: `app/features/ratings/reviewer-review-withdrawal.server.ts`
- Create: `app/routes/reviewer-review-withdraw.ts`
- Modify: `app/routes.ts`
- Modify: `app/features/ratings/reviewer-photo-deletion.server.ts`
- Modify: `app/features/ratings/reviewer-visit.server.ts`
- Create: `tests/integration/reviewer-review-withdrawal.test.ts`

### 5.1 RED — 철회 원자성

- [ ] PRIMARY 철회 후 다음을 검증한다.
  - review `WITHDRAWN`
  - public history/detail/photo query 제외
  - cleanup job exact object keys 존재
  - current vote가 `review.voteEventId`를 가리키면 WITHDRAW event와 함께 제거
  - 이후 사용자가 새 vote를 남겼다면 그 current vote는 보존
  - active Golden Pick이면 WITHDRAW event 생성
  - rating snapshot stale + PLACE recompute job
- [ ] REVISIT 철회는 vote/golden/recompute를 변경하지 않고 해당 기록과 사진만 내린다.
- [ ] trigger로 중간 실패를 만들고 모든 D1 변경이 rollback되는지 작성한다.
- [ ] 동일 withdrawal request replay가 기존 성공을 반환하는지 작성한다.

### 5.2 GREEN — 철회 서비스

- [ ] 공개 계약을 구현한다.

```ts
export type WithdrawReviewerRecordResult =
  | { outcome: "WITHDRAWN"; reviewId: string }
  | { outcome: "ALREADY_WITHDRAWN"; reviewId: string };

export async function withdrawReviewerRecord(db: AppDb, input: {
  reviewId: string;
  reviewerUserId: string;
  requestKey: string;
  reason: "REVIEWER_REQUEST";
  now: string;
}): Promise<WithdrawReviewerRecordResult>;
```

- [ ] 리뷰 소유자와 PUBLISHED 상태를 조건부로 확인한다.
- [ ] photo object keys를 읽고 cleanup job을 review status 변경과 같은 batch에 넣는다. public route는 status를 보고 즉시 차단하며 R2 delete는 retry 가능하다.
- [ ] current vote delete WHERE에 세 조건을 모두 둔다.

```sql
WHERE place_id = ? AND user_id = ? AND event_id = review.vote_event_id
```

- [ ] vote row가 일치할 때만 새 WITHDRAW vote event를 삽입한다. 일치하지 않으면 사용자의 최신 vote를 보존한다.
- [ ] active Golden Pick의 latest event를 다시 확인해 해당 review grant가 현재 활성일 때만 WITHDRAW를 만든다.
- [ ] rating stale/update와 recompute job insert를 같은 D1 batch에 포함해 stale snapshot이 계속 최신처럼 보이지 않게 한다.

### 5.3 route 보안

- [ ] `POST /reviewer/reviews/:reviewId/withdraw` resource route를 추가한다.
- [ ] REVIEWER role, strict same-origin, Zod UUID, request key를 검증한다.
- [ ] 다른 사용자 review ID는 존재 여부를 노출하지 않고 404로 처리한다.
- [ ] 성공은 JSON으로 반환하고 client history fetcher가 행을 제거한다.

### 5.4 검증·커밋

```bash
pnpm run test:integration -- tests/integration/reviewer-review-withdrawal.test.ts tests/integration/reviewer-photo-route.test.ts
pnpm run typecheck
git diff --check
```

```bash
git add app/features/ratings/reviewer-review-withdrawal.server.ts app/routes/reviewer-review-withdraw.ts app/routes.ts app/features/ratings/reviewer-photo-deletion.server.ts app/features/ratings/reviewer-visit.server.ts tests/integration/reviewer-review-withdrawal.test.ts
git commit -m "2026-08-14 리뷰 철회와 평가 정합성"
```

---

## Task 6. 최근 발행 × 버튼과 철회 UX

**소유 파일**

- Modify: `app/components/reviewer-visit-flow.tsx`
- Modify: `app/app.css`
- Modify: `tests/e2e/reviewer-revisit.spec.ts`
- Modify: `tests/e2e/reviewer-photo-upload.spec.ts`

### 6.1 RED — 실제 사용자 흐름

- [ ] 최근 발행 각 행에 정확히 하나의 44×44 `×` button과 접근 가능한 이름이 있는지 작성한다.
- [ ] × click → dialog → 기본 포커스 취소 → Escape 닫기 → 확인 철회를 검증한다.
- [ ] 철회 pending 동안 연타해 request 1회인지 작성한다.
- [ ] 성공 시 행 제거·toast, 실패 시 행 유지·error toast를 작성한다.
- [ ] 재방문 철회 dialog는 점수 관련 문구를 표시하지 않는지 작성한다.

### 6.2 GREEN — 컴포넌트

- [ ] `ReviewerHistoryRow`와 `WithdrawReviewDialog`를 분리해 5단계 발행 폼의 상태 복잡도를 늘리지 않는다.
- [ ] dialog copy는 loader가 준 `reviewKind`, `nextAvailableAt`만 사용하며 client에서 쿨다운을 재계산하지 않는다.
- [ ] fetcher success 후 history local copy를 갱신하고, failure에서는 그대로 유지한다.
- [ ] 성공·실패 toast는 기존 ReviewerVisitFlow toast pattern을 재사용한다.

### 6.3 스타일·검증·커밋

- [ ] ×는 시각적으로 작게 보이되 hit area 44px, cursor pointer, focus-visible을 유지한다.
- [ ] 모바일에서 장소 링크와 × hit area가 겹치지 않는 screenshot regression을 남긴다.

```bash
pnpm exec playwright test tests/e2e/reviewer-revisit.spec.ts tests/e2e/reviewer-photo-upload.spec.ts --project=chromium --project=mobile-chromium
pnpm run typecheck
git diff --check
```

```bash
git add app/components/reviewer-visit-flow.tsx app/app.css tests/e2e/reviewer-revisit.spec.ts tests/e2e/reviewer-photo-upload.spec.ts
git commit -m "2026-08-14 리뷰 최근 발행 철회 UX"
```

---

## Task 7. 공개 신뢰 배지와 모든 query 경계

**소유 파일**

- Modify: `app/features/ratings/reviewer-visit.server.ts`
- Modify: `app/routes/place-detail.tsx`
- Modify: `app/routes/reviewer-photo.ts`
- Modify: `app/routes/reviewer-profile.tsx`
- Modify: `app/features/places/place-liveness.server.ts`
- Create: `tests/integration/reviewer-public-boundary.test.ts`
- Modify: `tests/e2e/reviewer-revisit.spec.ts`

### 7.1 RED — withdrawn은 어느 공개 경로에도 없어야 한다

- [ ] place detail, reviewer public profile, reviewer photo binary route, liveness evidence aggregation에서 WITHDRAWN row와 사진이 제외되는 실제 D1 테스트를 작성한다.
- [ ] REVISIT가 rating sample/vote가 아닌 신뢰 metadata로만 반환되는지 작성한다.
- [ ] `CHANGED`는 `변화 감지 · 재검수 중`, SAME은 `90일 후 재방문 확인`, 횟수와 최근 월이 정확한지 작성한다.

### 7.2 GREEN — 공개 projection

- [ ] 모든 공개 query에 `reviewerVisitReviews.status = 'PUBLISHED'`를 공통 적용한다.
- [ ] `getPlaceRevisitTrustSummary`를 추가한다.

```ts
type PlaceRevisitTrustSummary = {
  revisitCount: number;
  reviewerCount: number;
  latestConfirmedAt: string | null;
  hasPendingChange: boolean;
};
```

- [ ] 동일 reviewer 반복 횟수를 표본 수로 표시하지 않는다. `reviewerCount`와 `revisitCount` 명칭을 구분한다.
- [ ] place detail의 rating breakdown 표본은 기존 snapshot만 사용하고 revisit count를 더하지 않는다.
- [ ] reviewer-photo route가 withdrawn review의 photoId에 404를 반환하고 R2를 호출하지 않는지 보장한다.

### 7.3 검증·커밋

```bash
pnpm run test:integration -- tests/integration/reviewer-public-boundary.test.ts tests/integration/reviewer-photo-route.test.ts tests/integration/place-liveness.server.test.ts
pnpm exec playwright test tests/e2e/reviewer-revisit.spec.ts --project=chromium --project=mobile-chromium
pnpm run typecheck
git diff --check
```

```bash
git add app/features/ratings/reviewer-visit.server.ts app/routes/place-detail.tsx app/routes/reviewer-photo.ts app/routes/reviewer-profile.tsx app/features/places/place-liveness.server.ts tests/integration/reviewer-public-boundary.test.ts tests/e2e/reviewer-revisit.spec.ts
git commit -m "2026-08-14 재방문 신뢰 배지와 공개 경계"
```

---

## Task 8. 나의 취향 프로필 리뷰어 상태 정리

**소유 파일**

- Modify: `app/routes/me.tsx`
- Modify: `app/app.css`
- Modify: `tests/e2e/member-profile.spec.ts`
- Create: `tests/integration/me-reviewer-state.test.ts`

### 8.1 RED — 역할별 화면

- [ ] ACTIVE reviewer: `리뷰어 신청·상태` CTA 없음, `@slug · email · 이메일 확인` compact meta 표시.
- [ ] 일반 회원: 신청 CTA 표시.
- [ ] 심사 중: `리뷰어 심사 중` 상태 표시.
- [ ] SUSPENDED/DORMANT: 신청 CTA 대신 작은 상태 안내.
- [ ] 다른 사용자나 비로그인 사용자가 이메일을 조회할 public 경로가 없는지 확인한다.

### 8.2 GREEN — loader projection과 배치

- [ ] me loader가 본인 reviewer profile과 latest application status를 함께 조회한다.

```ts
type ReviewerAccountState =
  | { kind: "ACTIVE"; slug: string }
  | { kind: "INACTIVE"; slug: string; status: "DORMANT" | "SUSPENDED" }
  | { kind: "APPLYING" }
  | { kind: "ELIGIBLE" };
```

- [ ] profile hero의 큰 이메일 행을 제거하고 TasteSignals 아래, TASTE LOG 위에 `.member-account-meta`로 배치한다.
- [ ] 내부 UUID는 표시하지 않고 reviewer slug만 `@slug`로 표시한다.
- [ ] ACTIVE reviewer만 CTA를 완전히 숨긴다.

### 8.3 검증·커밋

```bash
pnpm run test:integration -- tests/integration/me-reviewer-state.test.ts
pnpm exec playwright test tests/e2e/member-profile.spec.ts --project=chromium --project=mobile-chromium
pnpm run typecheck
git diff --check
```

```bash
git add app/routes/me.tsx app/app.css tests/e2e/member-profile.spec.ts tests/integration/me-reviewer-state.test.ts
git commit -m "2026-08-14 리뷰어 프로필 계정 정보와 신청 상태 정리"
```

---

## Task 9. 전체 QA·운영·rollout

**소유 파일**

- Create: `docs/operations/reviewer-revisit-withdrawal-runbook.md`
- Modify: `README.md`
- Create: `docs/evidence/2026-08-14-reviewer-revisit-desktop.png`
- Create: `docs/evidence/2026-08-14-reviewer-revisit-mobile.png`
- Create: `docs/evidence/2026-08-14-reviewer-withdraw-dialog.png`

### 9.1 fresh 검증

```bash
pnpm test
pnpm run test:integration
pnpm exec playwright test tests/e2e/reviewer-revisit.spec.ts tests/e2e/reviewer-photo-upload.spec.ts tests/e2e/member-profile.spec.ts --project=chromium --project=mobile-chromium
pnpm run typecheck
pnpm run build
git diff --check
```

- [ ] migration 0000→0028 fresh, existing 0027 data upgrade, 재적용 실패가 예상대로인지 확인한다.
- [ ] temporary mutation으로 status filter, request unique, vote event CAS를 각각 제거했을 때 회귀 테스트가 실패하는지 확인한다.
- [ ] 독립 코드 리뷰에서 Critical/Important 0건을 확인한다.

### 9.2 runbook

- [ ] 배포 순서를 다음으로 고정한다.
  1. migration 사전 감사 결과 0건 확인
  2. remote D1 0028 적용
  3. Worker deploy
  4. flag off smoke
  5. QA reviewer만 flag on
  6. 전체 활성화
- [ ] 관측 항목: primary unique conflict, request replay, cooldown 409, withdrawal 성공/실패, photo cleanup pending, recompute queue.
- [ ] 개인정보: reviewId/requestKey를 사용자 이메일과 함께 로그하지 않음.
- [ ] rollback: flag off → 이전 publish UI 비활성 → forward repair. migration은 되돌리지 않음.

### 9.3 PR 승인 범위

- [ ] PR 본문에 0028 원격 migration, feature flag, R2 cleanup, rating recompute, 운영 대상·명령·rollback을 명시한다.
- [ ] `PROPOSED → ACCEPTED/GO` 상태 변경을 PR에 명시한다.
- [ ] PR merge 전 remote D1, deploy, 운영 데이터 mutation을 실행하지 않는다.
- [ ] checks, UI evidence, diff review 후 ready 전환한다.

```bash
git add docs/operations/reviewer-revisit-withdrawal-runbook.md README.md docs/evidence/2026-08-14-reviewer-revisit-desktop.png docs/evidence/2026-08-14-reviewer-revisit-mobile.png docs/evidence/2026-08-14-reviewer-withdraw-dialog.png
git commit -m "2026-08-14 리뷰 재방문 철회 운영과 QA 문서"
```
