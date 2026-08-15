# 장소 분류 v5와 맥락형 코스 추천 v2 구현 계획

> **실행 방식:** 이 작업은 별도 worktree `tj_algorithm-v5-design`에서 순차 구현한다. 각 단계는 실패 테스트를 먼저 추가하고, 해당 단계의 검증이 끝난 뒤에만 다음 단계로 진행한다.

**목표:** 근거 없는 세부 음식 카테고리 자동 부여를 중단하고, 음식점 여부·카테고리·업장 속성·영업 가능성을 분리한 `place-category-v5`와 `course-context-v2`를 만든다.

**아키텍처:** 기존 v4 분류와 공개 장소는 유지한다. v5 분류 프로필은 D1에 병행 저장하고, NAVER와 Workers AI는 검증자 역할만 한다. 코스 v2는 사전 계산된 v5 프로필과 관리자 확인 영업시간만 읽어 가볍게 재순위한다. 외부 응답 원문·AI 원문은 저장하지 않는다.

**기술 스택:** TypeScript 7, React Router 8, Cloudflare Workers, D1/Drizzle, Zod, Workers AI(기존 binding), Vitest Workers pool, Playwright. 새 의존성·새 외부 공급자는 추가하지 않는다.

**전역 제약:**

- `place-category-v5`와 `course-context-v2`는 feature flag가 꺼지면 v4·`course-parking-v1` 동작으로 즉시 돌아가야 한다.
- 기존 공개 카테고리는 이번 PR에서 자동 변경하지 않는다. 관리자 dry-run과 감사 레코드만 만든다.
- NAVER와 AI 호출은 서버 adapter 안에서만 수행하고, mock/fake가 기본 테스트 경로다.
- 영업시간은 관리자 확인 데이터만 `OPEN`으로 취급한다. 그 외에는 `UNKNOWN`이며 자동으로 열려 있다고 추정하지 않는다.
- 새 테이블은 0031 이후의 add-only migration으로 추가한다. 원시 외부 API 응답·AI 응답·정확한 개인 위치는 저장하지 않는다.
- 배포 전에는 API 플래그를 `SHADOW`로 유지한다. 전체 공개 장소 일괄 적용은 별도 activate PR에서 100건 이상 표본 검수 후에만 한다.

---

## 작업 1: v5 도메인 계약과 카테고리 taxonomy 확장

**소유 파일:**

- 새 파일 `app/features/candidates/category-v5.types.ts`
- 새 파일 `app/features/candidates/category-v5-taxonomy.ts`
- 수정 `app/features/candidates/category-taxonomy.ts`
- 새 파일 `tests/unit/category-v5-taxonomy.test.ts`

**구현 단계:**

1. `PlaceCategoryProfileV5`, `FoodPlaceAssessment`, `VerificationState`, `ClassificationDecision`, `PlaceTrait`, `OperatingAvailability` 타입을 정의한다.
2. taxon 후보를 `primarySlug`, `secondarySlugs`(최대 4), traits로 표현하고, 동일 slug 중복을 타입 경계에서 제거한다.
3. 음식 긍정·사람/생활형 모호·비음식·제외 신호와 Level 1~4 사전을 분리한다.
4. 한식·일식·중식·양식·세계음식의 일반 fallback을 상세 메뉴와 다른 slug로 정의한다. `한식→백반·가정식`, `경양식→돈카스`의 암묵 fallback은 제거한다.

**TDD 및 검증:**

1. `한식`, `경양식`, `식육(숯불구이)`, `정종/대포집/소주방`, `라이브카페`, `PC방`, `CU` fixture를 추가하고 존재하지 않는 generic 결과를 기대해 RED를 확인한다.
2. taxonomy/types 최소 구현 후 같은 단위 테스트를 GREEN으로 만든다.
3. `pnpm test -- tests/unit/category-v5-taxonomy.test.ts` 및 `pnpm run typecheck`를 실행한다.

## 작업 2: v5 규칙 분류기와 음식점 점수

**소유 파일:**

- 새 파일 `app/features/candidates/category-v5.ts`
- 새 파일 `app/features/candidates/food-place-score.ts`
- 수정 `app/features/candidates/food-venue-policy.ts`
- 새 파일 `tests/unit/category-v5.test.ts`
- 새 파일 `tests/unit/food-place-score.test.ts`

**구현 단계:**

1. 기존 `food-venue-policy`의 강제 제외/OVERRIDDEN 동작을 유지하며 라이브카페·PC방·공예방·편의점을 정확한 단어 경계로 보강한다.
2. 이름/원천 업태만으로 `foodPlaceScore(0..100)`를 계산한다. 구체 음식·조리·업장 신호는 가산하고, 사람·감성·비음식 신호는 감점한다.
3. Level 1~4 후보를 점수화한다. Level 1/2/3은 넓은 원천 업태보다 우선하고, 같은 권역 보조 근거만 제한적으로 합산한다.
4. 최대 후보 gap, 후보 수, foodPlaceScore로 `GREEN/YELLOW/ORANGE/RED`와 `AUTO/MANUAL/EXCLUDE`를 결정한다. RED는 자동 공개 변경을 허용하지 않는다.

**TDD 및 검증:**

1. `신 돼지세끼+식육(숯불구이)→grill`, `인생역전+정종/대포집/소주방→pub`, 넓은 업태 fallback, 배제/OVERRIDDEN, 동점 conflict를 먼저 RED로 만든다.
2. 최소 규칙 구현 후 GREEN으로 만든다.
3. 기존 `category-suggestion` 회귀 테스트를 함께 실행해 v4 공개 동작이 바뀌지 않음을 확인한다.

## 작업 3: v5 병행 저장 스키마와 감사 가능한 shadow run

**소유 파일:**

- 수정 `app/db/schema.ts`
- 새 migration `drizzle/0031_place_category_v5_profiles.sql`
- 새 파일 `app/features/candidates/category-v5-profile.server.ts`
- 새 파일 `tests/integration/category-v5-profile.server.test.ts`

**구현 단계:**

1. `place_category_v5_profiles`와 `place_category_v5_runs`를 add-only로 생성한다. profile은 파생 category/traits/state/version/근거 코드와 마지막 검증 시각만, run은 제한된 요약 count/error code만 저장한다.
2. `(place_id, algorithm_version)` unique, 상태·최근 run·manual queue 조회 인덱스를 둔다.
3. profile upsert는 `SHADOW`에서 기존 `place_categories`를 변경하지 않고, `APPLY_VERIFIED`도 명시된 verified 근거가 있는 한 건만 forward-fix한다.
4. 원시 NAVER/AI 응답, 주소 전체, 사용자 식별자는 profile/run JSON에 쓰지 않는다.

**TDD 및 검증:**

1. migration fresh apply, idempotent upsert, shadow 비변경, verified apply, 동일 profile 재실행의 감사 summary를 Workers/D1 integration RED로 만든다.
2. service/migration 최소 구현 후 GREEN으로 만든다.
3. `pnpm run test:integration -- tests/integration/category-v5-profile.server.test.ts`와 migration isolation 명령을 실행한다.

## 작업 4: NAVER category v2 검증 adapter

**소유 파일:**

- 새 파일 `app/features/candidates/naver-local-category-v2.ts`
- 새 파일 `app/features/candidates/naver-category-v2.server.ts`
- 수정 `app/features/candidates/naver-local-category.ts`
- 새 파일 `tests/unit/naver-local-category-v2.test.ts`
- 새 파일 `tests/integration/naver-category-v2.server.test.ts`

**구현 단계:**

1. 기존 NAVER adapter를 재사용하되 `placeType`, `categoryVerification`, `matchKind`, `distanceMeters`, 제한된 evidence code만 v2 계약으로 변환한다.
2. 상호+주소 일치 또는 100m 이내 좌표 일치가 없으면 검증 실패로 둔다. 넓은 NAVER 카테고리는 상세 카테고리를 자동 확정하지 못한다.
3. 요청은 RED/ORANGE/YELLOW와 stale profile을 우선하며, 1 run 최대 100개, cache TTL 90일, timeout/1회 제한 재시도/kill switch를 적용한다.
4. 키가 없거나 quota/timeout이면 `UNAVAILABLE`을 반환하고 rule-only shadow 결과로 degraded 처리한다.

**TDD 및 검증:**

1. exact-name/address, 100m match, 넓은 카테고리, 101m mismatch, region mismatch, quota unavailable fixture를 RED로 만든다.
2. fake adapter와 v2 service로 GREEN을 만든다.
3. 실제 NAVER 호출은 하지 않고, bound·cache·redaction을 integration test로 확인한다.

## 작업 5: Workers AI 적대적 verifier

**소유 파일:**

- 새 파일 `app/features/candidates/ai-category-verifier-v2.ts`
- 새 파일 `app/features/candidates/ai-category-verifier-v2.server.ts`
- 수정 `app/features/candidates/ai-classification-policy.ts`
- 새 파일 `tests/unit/ai-category-verifier-v2.test.ts`
- 새 파일 `tests/integration/ai-category-verifier-v2.server.test.ts`

**구현 단계:**

1. 입력은 상호·원천 업태·최대 5개 후보 slug·근거 코드뿐으로 제한한다.
2. 출력은 strict Zod의 `SUPPORTED|WEAK|CONFLICT|NOT_FOOD|UNKNOWN`과 선택 candidate, evidence code만 허용한다.
3. `CONFLICT/NOT_FOOD`는 자동 apply를 막고 manual queue로 보낸다. AI 단독으로 RED를 공개하거나 카테고리를 바꾸지 못한다.
4. 기존 Workers AI model/binding을 유지하고 concurrency 3, run 100개, retry 없음, quota/kill switch를 적용한다.

**TDD 및 검증:**

1. invalid JSON, 후보 외 slug, 근거 없는 claim, conflict/not-food, unavailable fixture를 RED로 만든다.
2. mock AI binding으로 GREEN을 만든다.
3. prompt/version, count-only logs, raw output 미저장을 테스트한다.

## 작업 6: 관리자 dry-run과 verified forward-fix UI

**소유 파일:**

- 수정 `app/features/candidates/category-reclassification.server.ts`
- 수정 `app/routes/admin-candidates.tsx`
- 수정 `app/app.css`
- 새 파일 `tests/integration/category-v5-admin.server.test.ts`
- 새 파일 `tests/e2e/admin-category-v5.spec.ts`

**구현 단계:**

1. 관리자 화면에 v4→v5 comparison, state, food score band, NAVER/AI evidence code와 `shadow`, `verified only apply`, `manual correction`을 분리해 보여 준다.
2. `verified only apply`는 배치 최대 100, 명시적 confirmation, optimistic revision/CAS와 audit event를 요구한다.
3. 자동 분류 confidence가 높아도 관리자는 카테고리를 수정할 수 있어야 하며, manual decision은 이후 자동 실행에서 보존한다.
4. 버튼은 pending 중 비활성화, success/failure toast, 모바일 44px target, cursor/focus 상태를 제공한다.

**TDD 및 검증:**

1. high-confidence manual correction, dry-run public non-change, verified-only change, double click, failed provider toast를 integration/E2E RED로 만든다.
2. service/route/UI 최소 구현 후 desktop/mobile GREEN을 확인한다.
3. screenshot evidence는 PR에 첨부한다.

## 작업 7: 영업시간·업장 속성 context 저장

**소유 파일:**

- 수정 `app/db/schema.ts`
- 새 migration `drizzle/0032_place_course_context.sql`
- 새 파일 `app/features/courses/place-course-context.server.ts`
- 새 파일 `app/features/courses/operating-hours.ts`
- 새 파일 `tests/unit/operating-hours.test.ts`
- 새 파일 `tests/integration/place-course-context.server.test.ts`

**구현 단계:**

1. 관리자 확인 `place_operating_hours`와 profile-derived `place_course_contexts`를 add-only 테이블로 저장한다.
2. hours는 요일·복수 interval·휴무·lastVerifiedAt을 갖고 KST로 `OPEN/CLOSED/UNKNOWN`을 계산한다.
3. traits는 `soloFriendly`, `groupFriendly`, `lateNight`, `family`, `date`, `quickMeal`, `alcoholFriendly`, `dessert`, `parkingFriendly`만 허용하고 분류 근거·관리자 보정 원천을 기록한다.
4. 영업시간이 없으면 UNKNOWN으로 저장하며 운영 중이라고 가정하지 않는다.

**TDD 및 검증:**

1. 자정 통과, 휴무, 복수 interval, KST, unknown fallback, trait merge/manual override를 RED로 만든다.
2. migration/service를 GREEN으로 만든다.
3. D1 schema lifecycle/index query를 integration test에서 확인한다.

## 작업 8: 코스 옵션 v2와 시간대·호환도 규칙

**소유 파일:**

- 수정 `app/features/courses/course-options.ts`
- 새 파일 `app/features/courses/course-context-v2.ts`
- 새 파일 `app/features/courses/course-compatibility-v2.ts`
- 새 파일 `tests/unit/course-context-v2.test.ts`
- 새 파일 `tests/unit/course-compatibility-v2.test.ts`

**구현 단계:**

1. `morning/lunch/afternoon/dinner/night/lateNight` KST six-segment와 기존 URL 값의 호환 parser를 구현한다.
2. `TIME_FIT_SCORE`는 명시 요청 1.0, auto 시간대 max 0.8, OPEN 1, UNKNOWN 0.45, CLOSED 0으로 계산한다.
3. primary/secondary/traits로 compatibility를 exact 100, direct 90, family 70, adjacency 40, unrelated 0으로 계산한다.
4. 새 식사 category는 최대 3개, 내부 중복 category는 제한해 코스가 같은 음식으로 과도하게 채워지지 않도록 한다.

**TDD 및 검증:**

1. 각 시간대 경계/KST, closed hard reject, unknown penalty, exact/direct/family/adjacent/unrelated, 3개 동일 first cap을 RED로 만든다.
2. config/compatibility 구현 후 GREEN을 만든다.
3. 이전 URL(`lunch`, `late`)이 유지되는 회귀 테스트를 둔다.

## 작업 9: 코스 rank v2와 주차 v1 결합

**소유 파일:**

- 수정 `app/features/courses/course-score.ts`
- 수정 `app/features/courses/course-recommendation.server.ts`
- 수정 `app/features/places/recommendation-candidates.server.ts`
- 새 파일 `tests/unit/course-score-v2.test.ts`
- 새 파일 `tests/integration/course-recommendation-v2.server.test.ts`

**구현 단계:**

1. 후보 pool은 `listRecommendationCandidates`에서 250개 이하로 가져오고, v5 profile/context가 없으면 기존 public fields로 safe fallback한다.
2. first/second score에 food quality 30, rating reliability 20, time fit 20, compatibility 15, distance 10, traits 5를 적용한다. 오래된 personal/Golden/LLM 가중치는 추가하지 않는다.
3. `CLOSED` 후보는 hard reject, `UNKNOWN`은 penalty, pairing 거리·사용자 반경은 기존 guard를 유지한다.
4. parking v1 입력에 선택된 first/second와 시간대만 전달하고, 주차 결과 오류는 코스 자체를 실패시키지 않는다.

**TDD 및 검증:**

1. 같은 거리의 다른 quality/time/compatibility 결과가 v2에서 올바른 순서가 되는 RED fixture를 만든다.
2. unknown/closed, context 없는 v4 fallback, parking failure degraded, capped pool, deterministic tie-break를 GREEN으로 만든다.
3. Workers/D1 integration으로 common recommendation-excluded guard가 계속 유지됨을 확인한다.

## 작업 10: 코스 UI 설명 가능성·flag·QA

**소유 파일:**

- 수정 `app/routes/courses.tsx`
- 수정 `app/components/course-conditions.tsx`
- 수정 `app/components/course-results.tsx`
- 수정 `app/app.css`
- 새 파일 `tests/e2e/course-context-v2.spec.ts`
- 수정 `.dev.vars.example`
- 수정 `README.md`

**구현 단계:**

1. 결과 카드에는 실제 계산 근거에서 나온 최대 2개(`지금 영업 중`, `저녁에 잘 맞음`, `메뉴 조합 좋음`, `혼밥 친화`)만 표시한다.
2. `COURSE_CONTEXT_V2_ENABLED=false`면 old course path와 UI가 유지된다. UI에서 provider/AI raw 내용은 노출하지 않는다.
3. NAVER/AI v5 flags, KST 기준, shadow rollout, manual hours 작성 절차, 비용/timeout/rollback을 README와 `.dev.vars.example`에 기록한다.
4. 데스크톱·모바일에서 시간대 선택·결과·unknown 안내·focus/터치 target을 검증한다.

**TDD 및 검증:**

1. flag off, context v2, unknown, closed exclusion, mobile filters and keyboard path E2E를 RED로 만든다.
2. UI/flag 구현 후 GREEN을 만든다.
3. 전체 변경 범위의 `pnpm test`, `pnpm run test:integration`, `pnpm run typecheck`, `pnpm run build`, scoped Playwright, `git diff --check`를 실행한다.

## 작업 11: PR·운영 롤아웃

**소유 파일:**

- 수정 `README.md`
- 수정 `docs/superpowers/specs/2026-08-15-place-category-v5-course-context-v2-design.md`

**구현 단계:**

1. PR 본문에 소유 범위, new D1 tables/lifecycle, Workers AI/NAVER calls, quota (100/run), costs, privacy, flags, tests, rollback과 C 단계 manual sample 승인 조건을 명시한다.
2. `SHADOW` production rollout은 migration과 flag-off 배포까지만 한다. remote D1 대량 reclassification/NAVER 100건/AI 호출은 PR merge 후 운영자가 dry-run preview를 확인한 경우에만 실행한다.
3. rollback은 flags off와 profile forward-fix이다. public v4 category/old course data는 삭제하지 않는다.

**완료 검증:**

1. 최신 `origin/main` 반영 후 PR diff를 검토한다.
2. CI와 required checks가 통과하면 squash merge한다.
3. 병합된 main에서만 migration/flag-off production deploy를 실행하고 deployment URL 및 runbook 상태를 기록한다.
