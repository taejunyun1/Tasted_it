# 장소 영업 실재성 자동검증 구현 계획

> **실행 필수 스킬:** `superpowers:subagent-driven-development`(권장) 또는 `superpowers:executing-plans`를 사용해 각 작업을 순서대로 완료한다.

**목표:** 공공데이터 영업 상태, Kakao Local 검색 결과, 최근 내부 활동을 예약 작업에서 교차검증해 운영 의심 장소를 추천에서 안전하게 제외하고 관리자에게 근거를 제공한다.

**구조:** 사용자 요청 경로에서는 외부 API를 호출하지 않는다. 기존 장소 유지보수 예약 작업이 하루 최대 25곳을 임대(claim)하고 Kakao 어댑터를 호출한 뒤, 순수 판정 함수와 D1 상태 전이 서비스가 `place_liveness_states` 스냅샷을 갱신한다. `OBSERVE → RECOMMEND → HIDE` 집행 모드를 분리해 오탐 위험과 롤백 범위를 제한한다.

**기술:** React Router 8, TypeScript, Cloudflare Workers/D1, Drizzle ORM, Zod, Vitest Workers, Playwright. 새 의존성·새 cron·새 Cloudflare binding은 추가하지 않는다.

**추적:** Issue #89. 비음식 업소 및 `라이브카페` 필터는 별도 PR #88에서 처리하고 이 계획에는 섞지 않는다.

---

## Task 1. 스키마와 migration 계약 추가

**파일**

- 수정: `app/db/schema.ts`
- 생성: `drizzle/0025_place_liveness_states.sql`
- 수정: `tests/unit/schema-contract.test.ts`
- 생성: `tests/integration/place-liveness-migration.test.ts`

### 1. RED 테스트

`placeLivenessStates` export와 다음 필드가 존재해야 한다.

```ts
expect(placeLivenessStates.status).toBeDefined();
expect(placeLivenessStates.recommendationExcluded).toBeDefined();
expect(placeLivenessStates.leaseToken).toBeDefined();
expect(placeLivenessStates.leaseExpiresAt).toBeDefined();
```

Migration 계약은 `0025_place_liveness_states.sql`이 빈 D1과 현재 schema 모두에 적용되고 다음 index를 만드는지 검사한다.

```sql
CREATE INDEX place_liveness_due_idx
  ON place_liveness_states(next_check_at, lease_expires_at);
CREATE INDEX place_liveness_status_idx
  ON place_liveness_states(status, recommendation_excluded);
```

실행:

```bash
pnpm test -- tests/unit/schema-contract.test.ts
pnpm run test:integration -- tests/integration/place-liveness-migration.test.ts
```

기대: export/table 부재로 실패.

### 2. GREEN 구현

Drizzle enum은 다음 경계로 고정한다.

```ts
status: text("status", {
  enum: ["VERIFIED", "MONITORING", "SUSPECTED", "HIDDEN"],
}).notNull().default("MONITORING"),
kakaoStatus: text("kakao_status", {
  enum: ["MATCHED", "AMBIGUOUS", "NOT_FOUND", "ERROR", "SKIPPED"],
}).notNull().default("SKIPPED"),
recommendationExcluded: integer("recommendation_excluded", { mode: "boolean" })
  .notNull().default(false),
```

나머지는 `matchedKakaoPlaceId`, `matchScore`, `consecutiveNotFound`, `firstNotFoundAt`, `lastMatchedAt`, `lastCheckedAt`, `nextCheckAt`, `protectedUntil`, `leaseToken`, `leaseExpiresAt`, `evidenceJson`, `updatedAt`이다. `placeId`는 `places.id`를 `ON DELETE CASCADE`로 참조한다. 과거 migration은 수정하지 않는다.

### 3. 검증 및 커밋

```bash
pnpm test -- tests/unit/schema-contract.test.ts
pnpm run test:integration -- tests/integration/place-liveness-migration.test.ts
git diff --check
git add app/db/schema.ts drizzle/0025_place_liveness_states.sql tests/unit/schema-contract.test.ts tests/integration/place-liveness-migration.test.ts
git commit -m "2026-08-12 장소 영업검증 스키마 추가"
```

---

## Task 2. Kakao Local 서버 어댑터 구현

**파일**

- 생성: `app/features/places/kakao-local.server.ts`
- 생성: `tests/unit/kakao-local.server.test.ts`
- 수정: `app/cloudflare-env.d.ts`
- 수정: `.dev.vars.example`

### 1. RED 테스트

mock `fetch`로 정상, 빈 결과, 429, 500, timeout, 잘못된 JSON, 인증 오류를 검증한다. 실제 Kakao API는 호출하지 않는다.

```ts
const result = await searchKakaoPlaces({
  apiKey: "test-key",
  query: "테스트식당 광주광역시 동구 ...",
  longitude: 126.9,
  latitude: 35.1,
  fetchImpl,
});
expect(result.documents).toHaveLength(1);
```

추가 계약:

- `Authorization: KakaoAK <key>` 외 헤더 없음
- `size=5`, `radius<=1000`
- 3초 timeout
- 에러 객체에는 상호·주소·전화·키·원본 URL이 포함되지 않음
- 429/5xx만 `retryable: true`

### 2. GREEN 구현

Zod strict schema로 필요한 공개 필드만 파싱한다.

```ts
export type KakaoPlaceCandidate = {
  id: string;
  name: string;
  categoryGroupCode: "FD6" | "CE7" | string;
  address: string;
  roadAddress: string;
  longitude: number;
  latitude: number;
  phone: string | null;
};
```

어댑터 자체는 한 번의 요청만 담당한다. 429/5xx 한정 재시도와 호출 상한은 scheduler에서 통제한다.

`Env`에는 `KAKAO_REST_API_KEY`, `KAKAO_PLACE_VERIFICATION_ENABLED`, `KAKAO_PLACE_VERIFICATION_MODE`를 추가한다. `.dev.vars.example`에는 실제 값 없이 placeholder와 기본 `false`, `OBSERVE`만 기록한다.

### 3. 검증 및 커밋

```bash
pnpm test -- tests/unit/kakao-local.server.test.ts
pnpm run typecheck
git diff --check
git add app/features/places/kakao-local.server.ts tests/unit/kakao-local.server.test.ts app/cloudflare-env.d.ts .dev.vars.example
git commit -m "2026-08-12 카카오 장소검증 어댑터 추가"
```

---

## Task 3. 일치 점수와 상태 전이 순수 함수 구현

**파일**

- 생성: `app/features/places/place-liveness.ts`
- 생성: `tests/unit/place-liveness.test.ts`
- 수정: `app/features/places/place-duplicate-policy.ts`
- 수정: `tests/unit/place-duplicate-policy.test.ts`

### 1. RED 테스트

다음을 table-driven test로 먼저 작성한다.

- Kakao ID 동일은 즉시 100/MATCHED
- 이름 최대 40 + 주소 최대 30 + 150m 이내 최대 20 + 전화 최대 10
- FD6/CE7이 아니면 70점이어도 MATCHED 불가
- 70 이상 MATCHED, 50~69 AMBIGUOUS, 50 미만 NOT_FOUND
- 비슷한 최고 후보가 둘이면 AMBIGUOUS
- NFKC/공백/괄호·지점명 정규화는 하되 다른 이름은 합치지 않음
- ERROR는 연속 횟수·상태 불변
- 유효 NOT_FOUND는 최소 7일 간격으로만 누적
- 2회는 SUSPECTED, 3회라도 최신 OPEN 또는 최근 활동/보호 기간이면 숨기지 않음
- `OBSERVE`는 `recommendationExcluded=false`, `RECOMMEND/HIDE`는 2회부터 true

공통 거리 계산을 `place-duplicate-policy.ts`에서 export해 중복 구현을 없앤다.

```ts
export function decidePlaceLiveness(input: LivenessDecisionInput): LivenessDecision
```

### 2. GREEN 구현

순수 함수는 DB/API를 알지 않는다. 반환값에는 다음만 포함한다.

```ts
{
  status,
  kakaoStatus,
  consecutiveNotFound,
  recommendationExcluded,
  shouldHide,
  shouldOpenCase,
  nextCheckAt,
  evidence,
}
```

`evidence`는 점수 구성, `recentReviewerActivity`, `recentMemberActivity`, `recentOpenSource` boolean/시각만 포함하고 회원 식별자는 받지 않는다.

### 3. 검증 및 커밋

```bash
pnpm test -- tests/unit/place-liveness.test.ts tests/unit/place-duplicate-policy.test.ts
git diff --check
git add app/features/places/place-liveness.ts tests/unit/place-liveness.test.ts app/features/places/place-duplicate-policy.ts tests/unit/place-duplicate-policy.test.ts
git commit -m "2026-08-12 장소 일치와 영업판정 규칙 구현"
```

---

## Task 4. D1 대상 선점·증거 집계·원자적 상태 저장

**파일**

- 생성: `app/features/places/place-liveness.server.ts`
- 생성: `tests/integration/place-liveness.server.test.ts`
- 수정: `app/db/schema.ts` (필요한 index 조정만)

### 1. RED 통합 테스트

Workers/D1에서 다음을 먼저 실패시킨다.

- 상태 행이 없는 오래된 PUBLISHED 장소를 한 번만 claim
- 동시에 두 claim을 시작해도 같은 `placeId`는 한 호출에만 반환
- 만료 전 lease는 재선점 불가, 만료 뒤 재선점 가능
- 최근 90일 `reviewer_visit_reviews`와 `photo_count>0` 집계
- 최근 90일 `current_votes`, `saved_places` 집계
- 연결 `business_licenses.normalized_status=OPEN`과 `last_seen_at` 집계
- 결과 저장은 lease token 일치 시만 성공
- 2회 미검색 case는 중복 생성하지 않음
- 자동 숨김 시 `places`, `place_revisions`, `admin_audit_logs`, case가 한 D1 batch로 함께 기록
- 중간 실패 시 부분 적용 없음

### 2. GREEN 구현

외부 호출 전 claim은 조건부 update/insert 후 `RETURNING`으로 확보한다. lease는 5분, 다음 정상 검증은 7일 이후로 둔다.

```ts
export async function claimDuePlaceLivenessTargets(
  db: AppDb,
  input: { now: string; limit: number; leaseToken: string },
): Promise<LivenessTarget[]>;

export async function loadPlaceLivenessEvidence(
  db: AppDb,
  input: { placeId: string; now: string },
): Promise<PlaceLivenessEvidence>;

export async function applyPlaceLivenessDecision(
  db: AppDb,
  input: { target: LivenessTarget; decision: LivenessDecision; leaseToken: string; now: string },
): Promise<"APPLIED" | "STALE_LEASE">;
```

`HIDE` 모드에서만 `places.status`를 변경한다. 시스템 actor는 `null`, reason/source type은 고정 문자열로 감사 추적이 가능해야 한다.

### 3. 검증 및 커밋

```bash
pnpm run test:integration -- tests/integration/place-liveness.server.test.ts
pnpm run typecheck
git diff --check
git add app/features/places/place-liveness.server.ts tests/integration/place-liveness.server.test.ts app/db/schema.ts
git commit -m "2026-08-12 장소 영업검증 상태 저장 구현"
```

---

## Task 5. 예약 실행과 장애 격리

**파일**

- 수정: `app/features/places/scheduled-place.server.ts`
- 수정: `tests/integration/place-maintenance-scheduler.test.ts`
- 생성: `tests/unit/place-liveness-scheduler.test.ts`

### 1. RED 테스트

- flag off: Kakao fetch 0회, 기존 stale revalidation은 계속 동작
- OBSERVE: 판정 저장, 추천 제외/숨김 없음
- RECOMMEND: 2회부터 recommendation exclusion
- HIDE: 3회 + 모든 보호 조건에서만 숨김
- 429/5xx 한 번만 재시도
- auth error 3회 또는 실행 오류율 50% 이상이면 남은 대상 중단
- 오류 실행 중 자동 숨김 0곳
- 대상 25, 총 호출 50 상한
- Kakao 실패에도 기존 stale revalidation 결과 반환

### 2. GREEN 구현

`runScheduledPlaceMaintenance` 내부에서 기존 stale queue와 신규 verification을 순차·격리 실행한다. `workers/app.ts`의 top-level `Promise.all` 항목은 늘리지 않는다.

```ts
return {
  staleRevalidation,
  liveness: { status: "DISABLED" | "COMPLETED" | "STOPPED", claimed, checked, errors, hidden },
};
```

로그는 count와 비식별 오류 종류만 허용한다. 요청 URL·상호·주소·전화·응답 body는 기록하지 않는다.

### 3. 검증 및 커밋

```bash
pnpm test -- tests/unit/place-liveness-scheduler.test.ts
pnpm run test:integration -- tests/integration/place-maintenance-scheduler.test.ts tests/integration/place-liveness.server.test.ts
pnpm run typecheck
git diff --check
git add app/features/places/scheduled-place.server.ts tests/unit/place-liveness-scheduler.test.ts tests/integration/place-maintenance-scheduler.test.ts
git commit -m "2026-08-12 장소 영업검증 예약작업 연결"
```

---

## Task 6. 추천 후보 제외 연결

**파일**

- 수정: `app/features/places/place.server.ts`
- 수정: `tests/integration/place.server.test.ts`
- 수정: `tests/unit/recommendation-candidates-server.test.ts`

### 1. RED 테스트

- 일반 `listPlaces`와 `getPlaceBySlug`에는 SUSPECTED 장소가 계속 보임
- `listRecommendationCandidates`에서 `recommendation_excluded=1`만 제외
- 상태 행 없음/false는 기존 결과 유지
- HIDDEN은 모든 공개 조회에서 제외
- 홈·코스·/places 추천 서비스가 공통 후보 함수를 통해 동일하게 제외

### 2. GREEN 구현

추천 전용 query에만 correlated `NOT EXISTS`를 추가한다.

```sql
NOT EXISTS (
  SELECT 1 FROM place_liveness_states pls
  WHERE pls.place_id = places.id
    AND pls.recommendation_excluded = 1
)
```

일반 지도/상세/category count/slug redirect에는 이 조건을 넣지 않는다.

### 3. 검증 및 커밋

```bash
pnpm test -- tests/unit/recommendation-candidates-server.test.ts
pnpm run test:integration -- tests/integration/place.server.test.ts
git diff --check
git add app/features/places/place.server.ts tests/unit/recommendation-candidates-server.test.ts tests/integration/place.server.test.ts
git commit -m "2026-08-12 운영 의심 장소 추천 제외 연결"
```

---

## Task 7. 관리자 검수 UI와 보호·롤백 동작

**파일**

- 수정: `app/routes/admin-place-operations.tsx`
- 수정: `app/features/places/place-revalidation.server.ts`
- 수정: `app/styles/app.css`
- 수정: `tests/integration/place-revalidation.server.test.ts`
- 생성: `tests/e2e/admin-place-liveness.spec.ts`

### 1. RED 테스트

- 운영 의심/임시 숨김/공급자 오류 필터
- Kakao 상태, 일치 점수, 연속 미검색, 최신 내부 활동 표시
- `정상 영업`은 90일 `protectedUntil` 및 추천 복구
- `임시 휴업`, `폐업`, `이전`은 근거 필수
- 수동 action마다 audit/revision 기록
- `자동 추천 제외 전체 해제`는 파생 flag만 해제하며 place/review 데이터는 삭제하지 않음
- 모바일에서 카드와 action form이 기존 admin 디자인 토큰으로 정상 배치

### 2. GREEN 구현

기존 `admin-place-operations`에 liveness state를 join하고 별도 UI 라이브러리 없이 기존 `.ops-*` 패턴을 확장한다. `evidenceJson` 원문 전체 대신 허용 필드를 구조화해 보여준다.

관리자 service API:

```ts
export async function resolvePlaceLivenessCase(db: AppDb, input: {
  caseId: string;
  actorUserId: string;
  resolution: "OPEN" | "TEMPORARILY_CLOSED" | "CLOSED" | "MOVED";
  reason: string;
  now: string;
}): Promise<void>;

export async function clearRecommendationExclusions(db: AppDb, input: {
  actorUserId: string;
  reason: string;
  now: string;
}): Promise<{ updated: number }>;
```

### 3. 검증 및 커밋

```bash
pnpm run test:integration -- tests/integration/place-revalidation.server.test.ts
pnpm run test:e2e -- tests/e2e/admin-place-liveness.spec.ts
pnpm run typecheck
git diff --check
git add app/routes/admin-place-operations.tsx app/features/places/place-revalidation.server.ts app/styles/app.css tests/integration/place-revalidation.server.test.ts tests/e2e/admin-place-liveness.spec.ts
git commit -m "2026-08-12 장소 영업검증 관리자 흐름 추가"
```

---

## Task 8. 운영 문서·관찰 모드·최종 검증

**파일**

- 생성: `docs/operations/place-liveness-verification.md`
- 수정: `.dev.vars.example`
- 수정: Issue #89와 PR 본문

### 1. 문서화

운영 문서에 다음을 명시한다.

- 책임자, Kakao 공식 근거, 월 자체 상한 1,500, timeout/retry
- secret 등록 명령은 키 값 없이 제공
- `ENABLED=false`, `MODE=OBSERVE` 기본값
- 관찰 7일 동안 확인할 오탐 지표
- RECOMMEND/HIDE 전환은 별도 승인
- kill switch와 `추천 제외 전체 해제` 롤백
- 실제 Kakao 1곳 contract smoke는 운영 담당자 별도 승인 전 실행 금지
- 운영 D1 migration/deploy도 별도 승인 전 실행 금지

### 2. 전체 검증

```bash
pnpm test
pnpm run test:integration
pnpm run typecheck
pnpm run build
pnpm run test:e2e -- tests/e2e/admin-place-liveness.spec.ts
git diff --check
git status --short
```

실패는 신규 회귀/기존 baseline을 분리하고 재현 증거를 PR에 기록한다. 실제 공급자와 remote D1은 호출하지 않는다.

### 3. 독립 리뷰와 브랜치 완료

`superpowers:requesting-code-review`로 설계·개인정보·quota·동시성·롤백을 독립 검수한다. 지적사항을 반영한 뒤:

```bash
git add docs/operations/place-liveness-verification.md .dev.vars.example
git commit -m "2026-08-12 장소 영업검증 운영문서 정리"
git push -u origin codex/tj_place-liveness-verification
gh pr create --base main --head codex/tj_place-liveness-verification
```

PR은 migration `0025`, 외부 API 비용·개인정보, feature flags, 관찰 모드, rollback, 실제 contract smoke 미실행을 명시한다. 필수 검사와 사람 리뷰가 끝나기 전 merge/deploy하지 않는다.

---

## 구현 전 최종 점검

- 설계의 4상태, 7일/14일/90일/120일 경계가 모든 테스트에 대응됨
- `OBSERVE/RECOMMEND/HIDE` 타입이 Env, scheduler, decision에서 동일함
- 사용자 요청 경로의 Kakao 호출 없음
- 새 top-level cron Promise, 새 패키지, 새 binding 없음
- lease token과 결과 저장 token이 함께 있어 지연·중복 결과를 차단함
- provider ERROR가 NOT_FOUND로 변환되지 않음
- 추천 제외와 공개 숨김이 별도 필드·모드로 분리됨
- 회원별 개인정보를 evidence/log에 저장하지 않음
- 운영 API·remote D1·배포는 계획 실행 범위에 포함되지 않음
