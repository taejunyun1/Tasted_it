# x-algorithm 패턴 참조 추천 계층 정리 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

- **상태:** `ACCEPTED` — 계획 PR 병합 후 별도 구현 브랜치에서 1단계 마이그레이션을 수행했다.
- **작성일:** 2026-08-14
- **담당자:** jay
- **추적 이슈:** [#106](https://github.com/taejunyun1/Tasted_it/issues/106)
- **기준선:** `origin/main@9fe0d8d`
- **참조:** [xai-org/x-algorithm](https://github.com/xai-org/x-algorithm) Apache 2.0, commit `a389166` (2026-08-13 For You 공개분)
- **이번 PR 범위:** 승인된 계획의 1단계 구현. 제품 결과 순서, migration, 환경 변수, 배포 설정 변경 없음.

**목표:** X For You 코드를 이식하지 않고, 홈 큐레이션과 장소 목록 추천에 점수와 노출 자격 분리, 행동별 가치 표, 취향 일치 vs 탐색 할인을 이름 있는 계층으로 고정한다. 1단계는 현재 추천 결과를 바꾸지 않는다.

**구조:** SQL 후보 조회는 그대로 두고, 애플리케이션 적격성(eligibility)과 행동 가치(action value)만 순수 모듈로 추출한다. 홈 `MODE_WEIGHTS`와 목록 `rankPersonalDiscovery` 공식은 병합하지 않는다. 두 표면은 적격성 코드와 행동 가치 상수만 공유한다.

**기술 스택:** React Router 8, TypeScript, Cloudflare Workers, D1/Drizzle, Vitest. 신규 런타임, 모델, 패키지, 테이블 없음.

---

## 0. 판정

[x-algorithm](https://github.com/xai-org/x-algorithm)은 X For You 피드의 투명성용 소스다. 라이브러리가 아니며 tastedit 런타임에 올라가지 않는다.

| 항목 | x-algorithm | tastedit |
|---|---|---|
| 대상 | 게시물, 팔로우 그래프, 48시간 신선도 | Place, 취향 배지, 3/5/8km, 평가 스냅샷 |
| 점수 | Phoenix transformer가 행동 확률 예측 후 가중 합 | 결정론 특성 × 모드 가중치 + MMR |
| 런타임 | Rust home-mixer, JAX, Thunder, Kafka, GPU | Cloudflare Workers + D1 |
| 설명 | Under the Hood 라벨 통계 | 실제 점수 기여 상위 2개 이유, LLM 금지 |

라이선스(Apache 2.0)는 참조를 허용한다. 코드 복사, 인프라 import, 가중치 숫자 복사는 하지 않는다.

---

## 1. 가져오는 패턴과 가져오지 않는 것

### 1.1 가져오는 패턴

1. **점수와 노출 자격 분리.** ranking은 순서만 정하고, 보여줄 수 있는지는 별도 규칙이 결정한다.
2. **행동 가치 표.** 저장·추천·비추천 이유·이미 방문을 한 점수로 섞지 않고, 코드에 공개된 상수로 남긴다.
3. **취향 일치 vs 탐색 할인.** 직접 취향이 아닌 후보에 이름 있는 계수를 곱한다. 팔로우 그래프가 아니라 `DIRECT` / `ADJACENT` / `EXPLORATION`으로 정의한다.
4. **후보 독립 점수.** 장소별 특성 점수는 다른 후보에 의존하지 않는다. 상호 의존은 MMR 선택 단계에서만 허용한다.

### 1.2 이미 있는 대응

- `MODE_WEIGHTS`와 `algorithmVersion: "home-curation-v2"`
- 체인점·비음식점 공개 제외, liveness `recommendation_excluded`, 품질 바닥, 현재 비추천 제외
- 카테고리·메뉴·500m·이유·리뷰어 MMR
- 세션 `freshness`와 최근 1위 페널티
- 추천 이유는 점수 기여 상위 2개, LLM 금지

### 1.3 가져오지 않는 것

- Phoenix 학습·서빙, 벡터 retrieval, Thunder, SimClusters, VMRanker DPP
- grox / CLIP / NSFW / 스팸 visibility / user-cred PageRank
- Ads blender, Who to Follow. 업주는 추천 결과와 배지를 구매할 수 없다.
- `productEvents`의 `RECOMMENDATION_DETAIL_OPENED`를 랭킹 입력으로 사용
- 코스·주차 추천 공식 변경
- 신규 migration, 환경 변수, 외부 API, Workers AI, Queue, 벡터 인덱스, 두 번째 DB

`docs/decisions/2026-08-10-tech-stack-governance.md`의 300 CCU 전 HOLD를 우회하지 않는다.

---

## 2. 전역 제약

- [x] 구현은 이 계획 PR이 병합되어 `ACCEPTED`가 된 뒤 최신 `origin/main`의 새 브랜치 `codex/recommendation-action-layers`와 독립 worktree에서 시작한다. 이 문서 브랜치를 구현 기준으로 쓰지 않는다.
- [x] Issue #106 또는 구현 PR에 담당자, 아래 소유 파일, migration 없음, 운영 호출 없음을 기록한다.
- [x] 1단계 구현은 홈 5곳과 목록 personal/trusted/golden 순서를 바꾸지 않는다. 같은 fixture에서 장소 ID 순서가 같아야 한다.
- [x] 점수 공식을 바꾸면 `algorithmVersion`을 올리고 별도 PR로 분리한다. 1단계는 `home-curation-v2`를 유지한다.
- [x] 추천 이유는 실제 점수 기여 상위 2개만 사용한다. LLM 문구를 추가하지 않는다.
- [x] SQL 적격성(공개, 비음식점, liveness)을 애플리케이션으로 옮기지 않는다. 제외된 장소를 먼저 읽은 뒤 JS에서 걸러 회귀를 만들지 않는다.
- [ ] 각 Task는 RED → 최소 GREEN → 관련 회귀 → `git diff --check` → 자체 검수 → 한국어 커밋 순서로 수행한다.

---

## 3. 현재 적격성 인벤토리

구현 전에 옮기지 말고, 계층만 이름 붙인다.

| 계층 | 규칙 | 현재 위치 | 1단계 조치 |
|---|---|---|---|
| SQL | `places.status = PUBLISHED` | `place.server.ts` `publicConditions` | 유지 |
| SQL | 비음식점 상호·원천 업태 제외, 관리자 override | `publicVenueVisibilityCondition` | 유지 |
| SQL | `place_liveness_states.recommendation_excluded = 1` 제외 | `recommendationLivenessCondition` | 유지 |
| SQL | bbox, 카테고리, 최대 500곳 | `listRecommendationCandidates` | 유지 |
| App | 표본 8 이상이고 공개 점수 55 미만 제외 | `passesHomeQuality` | 적격성 모듈로 이동, 동작 동일 |
| App | `current_votes.value = -1` 제외 | `loadRecommendationCandidateContext` | 적격성 모듈로 판정, 조회는 유지 |
| App | 반경 3/5/8km 밀도 | `home-curation.server.ts` | 적격성이 아니라 후보 창. 유지 |
| 학습 | 비추천 `MENU` 또는 이유 없음만 FOOD 감점 0.18 | `taste-learning.server.ts` | 행동 가치 상수로 추출 |
| 학습 | `DISTANCE` / `PRICE` / `ATMOSPHERE` / `ALREADY_VISITED`는 취향 감점 없음 | 동일 | 행동 가치 표에 명시 |
| 수집만 | `RECOMMENDATION_DETAIL_OPENED` 등 `productEvents` | `onboarding-events.server.ts` | 랭킹 입력 금지. 표에 `rankingInput: false` |

---

## 4. 공개 계약

1단계 신규 export. 기존 `HomeCurationPage` JSON 계약은 바꾸지 않는다.

```ts
export type RecommendationEligibilityReason =
  | "UNPUBLISHED"
  | "VENUE_POLICY"
  | "LIVENESS_EXCLUDED"
  | "QUALITY_FLOOR"
  | "CURRENT_DISLIKE";

export type RecommendationEligibility =
  | { decision: "ALLOW" }
  | { decision: "DROP"; reason: RecommendationEligibilityReason };

export type RecommendationMatchKind = "DIRECT" | "ADJACENT" | "EXPLORATION";

export type RecommendationActionName =
  | "SAVE"
  | "LIKE"
  | "DISLIKE_MENU"
  | "DISLIKE_DISTANCE"
  | "DISLIKE_PRICE"
  | "DISLIKE_ATMOSPHERE"
  | "ALREADY_VISITED"
  | "DETAIL_OPENED";

export type RecommendationActionValue = {
  action: RecommendationActionName;
  rankingInput: boolean;
  tastePenalty: number;
  notes: string;
};
```

행동 가치 기본값. X `param.rs` 숫자를 복사하지 않는다. 아래는 현재 tastedit 동작을 이름 붙인 값이다.

| action | rankingInput | tastePenalty | 현재 동작 |
|---|---|---:|---|
| `SAVE` | 간접 | 0 | 저장이 INFERRED 취향에 들어감 |
| `LIKE` | 간접 | 0 | 추천(+1)이 INFERRED 취향에 들어감 |
| `DISLIKE_MENU` | 예 | 0.18 | 해당 FOOD 배지 감점, 장소는 후보 제외 |
| `DISLIKE_DISTANCE` | 예(제외만) | 0 | 취향 감점 없음, 장소는 후보 제외 |
| `DISLIKE_PRICE` | 예(제외만) | 0 | 동일 |
| `DISLIKE_ATMOSPHERE` | 예(제외만) | 0 | 동일 |
| `ALREADY_VISITED` | 예(제외만) | 0 | 취향 감점 없음, 장소는 후보 제외 |
| `DETAIL_OPENED` | 아니오 | 0 | 이벤트만 기록 |

`tasteMatchFactor`:

| kind | 홈 `discoveryScore` 대응 | 목록 `personalizationBoost` 대응 |
|---|---|---|
| `DIRECT` | 직접 취향 높으면 discovery 0.2~0.35 | `0.35 * tasteStrength` |
| `ADJACENT` | 0.65 | `0.22 * tasteStrength` |
| `EXPLORATION` | 0.8, 명시적 새로움이면 1 | `0.08` + 선택 시 +0.12 |

1단계는 이 숫자를 새 공식으로 다시 계산하지 않는다. 기존 함수가 같은 값을 내도록 별칭과 상수만 둔다.

---

## 5. 파일 지도

구현 PR 소유 파일. 이 계획 PR은 문서를 제외하고 수정하지 않는다.

- Create: `app/features/places/recommendation-eligibility.ts`
- Create: `app/features/places/recommendation-action-values.ts`
- Create: `tests/unit/recommendation-eligibility.test.ts`
- Create: `tests/unit/recommendation-action-values.test.ts`
- Modify: `app/features/places/home-curation.ts`
- Modify: `app/features/places/home-curation.server.ts`
- Modify: `app/features/places/home-curation-features.ts`
- Modify: `app/features/places/home-curation-ranking.ts`
- Modify: `app/features/places/place-discovery.ts`
- Modify: `app/features/places/recommendation-candidates.server.ts`
- Modify: `app/features/members/taste-learning.server.ts`
- Modify: `tests/unit/home-curation-features.test.ts`
- Modify: `tests/unit/home-curation-ranking.test.ts`
- Modify: `tests/unit/home-curation.test.ts`
- Modify: `tests/integration/home-curation.server.test.ts`
- Modify: `tests/integration/place-recommendation.server.test.ts`
- Modify: `tests/unit/recommendation-candidates-server.test.ts`

코스·주차·온보딩 이벤트 수집 코드는 소유 범위 밖이다.

---

## Task 1. 적격성 모듈과 품질 바닥 이동

**소유 파일**

- Create: `app/features/places/recommendation-eligibility.ts`
- Create: `tests/unit/recommendation-eligibility.test.ts`
- Modify: `app/features/places/home-curation.ts`
- Modify: `tests/unit/home-curation.test.ts`

### 1.1 RED

- [x] `passesHomeQuality`와 동일한 입력을 적격성 함수로 검증하는 테스트를 먼저 작성한다.

```ts
it("표본 8 미만은 점수가 낮아도 ALLOW다", () => {
  expect(evaluateAppEligibility({
    sampleCount: 3,
    visibleScore: 40,
    currentlyDisliked: false,
  })).toEqual({ decision: "ALLOW" });
});

it("표본 8 이상이고 공개 점수 55 미만은 QUALITY_FLOOR로 DROP한다", () => {
  expect(evaluateAppEligibility({
    sampleCount: 8,
    visibleScore: 54,
    currentlyDisliked: false,
  })).toEqual({ decision: "DROP", reason: "QUALITY_FLOOR" });
});

it("현재 비추천은 CURRENT_DISLIKE로 DROP한다", () => {
  expect(evaluateAppEligibility({
    sampleCount: 0,
    visibleScore: 90,
    currentlyDisliked: true,
  })).toEqual({ decision: "DROP", reason: "CURRENT_DISLIKE" });
});
```

```bash
pnpm vitest run tests/unit/recommendation-eligibility.test.ts tests/unit/home-curation.test.ts
```

예상: 신규 모듈 부재로 FAIL.

### 1.2 GREEN

- [x] `evaluateAppEligibility`를 순수 함수로 추가한다. SQL 이유 코드(`UNPUBLISHED`, `VENUE_POLICY`, `LIVENESS_EXCLUDED`)는 문서와 타입에만 두고, 1단계에서 호출하지 않는다.
- [x] `passesHomeQuality(place)`는 `evaluateAppEligibility`를 호출하는 얇은 래퍼로 남기거나, 호출부를 적격성 함수로 교체한다. 공개 점수 계산은 기존 `calculateRating` 경로를 재사용한다.
- [x] `rankHomeCuration`의 품질 필터가 같은 DROP 집합을 쓰게 한다.

### 1.3 검증

```bash
pnpm vitest run tests/unit/recommendation-eligibility.test.ts tests/unit/home-curation.test.ts tests/unit/home-curation-ranking.test.ts
```

예상: PASS. 기존 홈 fixture의 5곳 ID 순서가 같다.

---

## Task 2. 후보 조회에 적격성 판정 연결

**소유 파일**

- Modify: `app/features/places/recommendation-candidates.server.ts`
- Modify: `app/features/places/home-curation.server.ts`
- Modify: `tests/unit/recommendation-candidates-server.test.ts`
- Modify: `tests/integration/home-curation.server.test.ts`

### 2.1 RED

- [x] 비추천 장소가 `dislikedPlaceIds`에 남고 후보 배열에서는 빠지는 기존 테스트를 유지한다.
- [x] 후보를 걸러낸 이유가 `CURRENT_DISLIKE`임을 단언하는 assertion을 추가한다. 공개 필드에 이유를 노출하지 않는다.

```ts
expect(context.dislikedPlaceIds).toEqual([dislikedPlaceId]);
expect(context.candidates.map((place) => place.id)).not.toContain(dislikedPlaceId);
```

```bash
pnpm vitest run tests/unit/recommendation-candidates-server.test.ts tests/integration/home-curation.server.test.ts --config vitest.workers.config.ts
```

예상: 이유 연결 부재 또는 기존 PASS. 실패하면 조회 필터를 바꾸지 말고 판정 함수만 끼운다.

### 2.2 GREEN

- [x] `loadDislikedPlaceIds` 조회는 유지한다. 필터는 `evaluateAppEligibility({ currentlyDisliked: true })`가 DROP인 장소만 제거한다.
- [x] SQL liveness·공개 조건을 애플리케이션으로 옮기지 않는다.
- [x] `getHomeCurationPage`는 품질 필터를 적격성 모듈과 중복 구현하지 않는다.

### 2.3 검증

```bash
pnpm vitest run tests/unit/recommendation-candidates-server.test.ts tests/integration/home-curation.server.test.ts tests/integration/place-recommendation.server.test.ts --config vitest.workers.config.ts
```

예상: PASS. 홈·목록 후보 ID 집합이 기준선과 같다.

---

## Task 3. 행동 가치 표와 취향 감점 상수

**소유 파일**

- Create: `app/features/places/recommendation-action-values.ts`
- Create: `tests/unit/recommendation-action-values.test.ts`
- Modify: `app/features/members/taste-learning.server.ts`

### 3.1 RED

```ts
it("MENU 또는 이유 없는 비추천만 FOOD 감점 0.18을 쓴다", () => {
  expect(tastePenaltyForFeedback({ value: -1, reason: "MENU" })).toBe(0.18);
  expect(tastePenaltyForFeedback({ value: -1, reason: null })).toBe(0.18);
  expect(tastePenaltyForFeedback({ value: -1, reason: "DISTANCE" })).toBe(0);
  expect(tastePenaltyForFeedback({ value: -1, reason: "ALREADY_VISITED" })).toBe(0);
  expect(tastePenaltyForFeedback({ value: 1, reason: null })).toBe(0);
});

it("상세 열림은 랭킹 입력이 아니다", () => {
  expect(actionValue("DETAIL_OPENED").rankingInput).toBe(false);
});
```

```bash
pnpm vitest run tests/unit/recommendation-action-values.test.ts
```

예상: FAIL.

### 3.2 GREEN

- [x] `RECOMMENDATION_ACTION_VALUES` 배열과 `tastePenaltyForFeedback`, `actionValue`를 추가한다.
- [x] `refreshInferredTasteSignals`의 `0.18` 리터럴을 `tastePenaltyForFeedback`으로 교체한다. 감점 대상은 기존과 같이 `MENU` 또는 이유 없음의 FOOD 배지만.
- [x] `productEvents`를 읽거나 랭킹에 연결하지 않는다.

### 3.3 검증

```bash
pnpm vitest run tests/unit/recommendation-action-values.test.ts tests/integration/taste-learning.server.test.ts --config vitest.workers.config.ts
```

예상: PASS. INFERRED 배지 점수가 기존 테스트와 같다.

---

## Task 4. 취향 일치 종류를 이름 있는 계수로 고정

**소유 파일**

- Modify: `app/features/places/home-curation-features.ts`
- Modify: `app/features/places/place-discovery.ts`
- Modify: `app/features/places/recommendation-action-values.ts` 또는 같은 모듈에 `tasteMatchFactor` 별칭
- Modify: `tests/unit/home-curation-features.test.ts`
- Modify: `tests/unit/place-recommendation-options.test.ts` 또는 discovery 단위 테스트

### 4.1 RED

- [x] 기존 `discoveryScore`와 `personalizationBoostForDiscovery` 테스트를 유지한다.
- [x] 같은 입력이 `RecommendationMatchKind`를 거쳐도 숫자가 같은지 단언을 추가한다.

```ts
expect(discoveryScore({
  directTaste: 0,
  adjacentTaste: 0,
  explicitNew: false,
})).toBe(0.8);

expect(personalizationBoostForDiscovery({
  mode: "EXPLORATION",
  tasteStrength: 1,
  directionBoost: 0,
})).toBe(0.08);
```

### 4.2 GREEN

- [x] `DIRECT` / `ADJACENT` / `EXPLORATION`을 공통 타입으로 올린다. 홈 `TasteMatch.match`와 목록 `discoveryMode`가 같은 세 값을 쓰게 한다. `FAMILIAR`는 `DIRECT`의 별칭으로만 남기거나 호출부를 `DIRECT`로 바꾼다.
- [x] 숫자 공식을 재작성하지 않는다. 기존 함수 시그니처를 유지한 채 종류 이름만 공유한다.
- [x] 추천 이유 문구를 바꾸지 않는다.

### 4.3 검증

```bash
pnpm vitest run tests/unit/home-curation-features.test.ts tests/unit/home-curation-ranking.test.ts tests/unit/home-curation.test.ts
```

예상: PASS. 홈 5곳 ID·이유 문자열이 기준선과 같다.

---

## Task 5. 홈·목록 회귀와 문서 상태

**소유 파일**

- Modify: `tests/integration/home-curation.server.test.ts`
- Modify: `tests/integration/place-recommendation.server.test.ts`
- Modify: 이 문서 상태 표기 (구현 PR에서 `ACCEPTED` 계획의 Task 체크)

### 5.1 RED → GREEN

- [x] 홈 now/taste/time/discovery/golden fixture의 장소 ID 순서와 `algorithmVersion`이 `home-curation-v2`인지 확인한다.
- [x] 목록 personal/trusted/golden 레일 ID 순서가 같은지 확인한다.
- [x] 신규 공개 JSON 필드가 없는지 확인한다.

```bash
pnpm vitest run tests/unit/home-curation-features.test.ts tests/unit/home-curation-ranking.test.ts tests/unit/home-curation.test.ts tests/unit/recommendation-eligibility.test.ts tests/unit/recommendation-action-values.test.ts
pnpm vitest run tests/integration/home-curation.server.test.ts tests/integration/place-recommendation.server.test.ts tests/integration/taste-learning.server.test.ts --config vitest.workers.config.ts
pnpm exec tsc --noEmit
git diff --check
```

예상: PASS.

---

## 6. 1단계 완료 조건

아래가 모두 참일 때만 구현 PR을 연다.

- 적격성 순수 모듈이 품질 바닥과 현재 비추천을 판정한다.
- 행동 가치 표가 `0.18`과 `DETAIL_OPENED` 금지를 테스트로 고정한다.
- 취향 일치 종류가 홈·목록에서 같은 세 값을 쓴다.
- 홈 5곳과 목록 세 레일 순서가 기준선과 같다.
- `algorithmVersion`은 `home-curation-v2`다.
- migration, 환경 변수, 외부 호출, Workers AI가 없다.

---

## 7. 후속 HOLD

아래는 이 계획의 구현 승인이 아니다. 별도 설계와 점수 버전 범프가 필요하다.

| 항목 | 이유 |
|---|---|
| `ALREADY_VISITED`를 제외 대신 freshness 감점으로 완화 | 결과 순서가 바뀜 |
| `RECOMMENDATION_DETAIL_OPENED`를 점수에 반영 | 암시 참여, 설명 가능한 이유 규칙과 충돌 |
| 홈과 목록 점수 공식 병합 | 목적 함수가 다름. 홈은 모드 가중치, 목록은 레일 분리 |
| Phoenix / 벡터 / SimClusters | 스택 HOLD, 데이터·GPU 없음 |
| 광고를 추천 슬롯에 섞기 | 제품 원칙 위반 |
| 코스·주차에 같은 계층 적용 | 다른 목적 함수. 별도 이슈 |

---

## 8. 운영·승인 범위

이번 계획 PR과 1단계 구현 PR 모두 아래를 따른다.

- **대상 환경:** 저장소 문서와 로컬 테스트. 운영 D1, preview 배포, 유료 API 없음
- **실행 명령:** 구현 PR에서 위 Vitest·`tsc`만. `pnpm run deploy` 없음
- **비용·개인정보:** 신규 수집 없음. 세션 이력은 기존처럼 `sessionStorage`의 장소 ID만
- **검증:** 단위·통합 테스트와 홈/목록 ID 순서 비교
- **rollback:** 문서 PR은 revert. 구현 PR은 순수 모듈 제거와 호출부 원복. migration 없음
- **실행 담당자:** 구현 PR 작성자. 병합은 승인이지 배포 완료가 아님
