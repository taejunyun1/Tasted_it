# Re:Taste 홈 추천 알고리즘 v2 Phase 1·2 설계

## 1. 문서 목적

이 문서는 Re:Taste 홈 큐레이션 추천의 Phase 1·2 개선 범위를 정의한다. 현재 알고리즘은 평가, Golden Pick, 취향 신호가 부족할 때 다수 후보가 같은 점수를 받고 거리와 상호명 정렬이 사실상 순위를 결정한다. 그 결과 같은 장소가 1순위에 반복 노출되고, 추천 모드를 바꿔도 결과가 거의 달라지지 않으며, Golden Pick이 없는 지역에서는 Golden Pick 모드가 일반 근거리 추천처럼 동작한다.

이번 개선은 다음 결과를 목표로 한다.

- 데이터가 부족해도 같은 장소가 계속 1순위에 고정되지 않는다.
- 가까운 장소를 우대하되 작은 거리 차이가 순위를 지배하지 않는다.
- Golden Pick 모드는 활성 Golden Pick 또는 리뷰어 근거가 있는 fallback만 사용한다.
- 1순위는 모드 목적 적합성을 우선하고, 2~5순위는 다양성과 발견성을 확보한다.
- 같은 브라우저 세션에서는 결과가 안정적이고, 날짜나 새 세션에서는 동점권이 일부 순환한다.
- 후보가 충분하면 추천 모드 변경 시 최소 두 장소가 달라진다.

관련 작업은 GitHub Issue #82가 소유한다.

## 2. 범위

### 2.1 포함 범위

- 신뢰도 점수 개선
- 거리 점수 구간화
- 상호명 가나다순 tie-break 제거
- 결정적 변동값(deterministic variation) 추가
- 브라우저 세션 최근 노출 및 최근 1순위 감점
- Golden Pick primary/fallback 후보 분리
- 다중 직접·인접 취향 신호 합산
- 3km, 5km, 8km 단계별 후보 풀 확보
- 1순위 적합도 선정과 2~5순위 MMR 다양화
- 모드 변경 최소 변화량 보정
- 실제 점수 기여도 기반 추천 이유
- Golden Pick 부재 안내 문구
- 로그인 사용자의 현재 비추천 장소 제외

### 2.2 제외 범위

- 추천 노출 이력의 DB 영속화
- 로그인 사용자와 비회원 이력의 장기 병합
- dataRichness 기반 sparse/normal/rich 동적 가중치
- 영업시간 데이터 모델 또는 외부 영업 여부 API
- DB migration
- 환경 변수 추가
- Workers AI, 외부 추천 API 또는 유료 서비스 호출

제외 범위는 Phase 3에서 별도 설계한다.

## 3. 기존 문제의 원인

기존 구현은 평가 표본이 8개 미만인 장소의 신뢰 점수를 모두 0.2로 설정한다. 취향은 처음 발견된 신호 하나만 반영하고, 시간대는 일치 1.0과 불일치·정보 없음 0.25로 단순화한다. Golden Pick이 없거나 신뢰 후보가 없으면 해당 슬롯은 일반 후보 전체로 fallback한다. 동점은 상호명 가나다순으로 해소한다.

따라서 평가와 취향 데이터가 적은 지역에서는 신뢰, 취향, 시간대 점수가 같은 후보가 많아진다. 이때 거리와 상호명만 후보를 구분하므로 입력이 같은 한 1순위도 고정된다. 추천 모드마다 슬롯 이름은 달라도 최종 후보가 반복될 가능성이 높다.

## 4. 전체 구조

추천 파이프라인은 후보 확보, feature 계산, 1순위 선정, 2~5순위 다양화, 세션 기록 갱신으로 분리한다.

```text
현재 지도 중심 기준 8km bbox에서 후보 최대 500개 로드
→ 공개·검수·품질 필터 적용
→ 실제 거리 계산
→ 3km/5km/8km 중 적합 후보 20개를 처음 확보하는 반경 선택
→ 장소별 feature 계산
→ 모드별 base score 계산
→ 세션 반복 감점과 결정적 변동값 적용
→ Golden primary/fallback 후보 구성
→ 모드 목적에 맞는 1순위 선정
→ MMR로 2~5순위 선정
→ 이전 모드 결과와 중복 검사 및 필요 시 재선정
→ 실제 기여도 기반 추천 이유 생성
→ 브라우저 sessionStorage에 최근 결과 기록
```

## 5. 후보군 생성

### 5.1 데이터 로드

추천 요청의 지도 중심을 기준으로 8km를 포함하는 검색 bbox를 서버에서 계산한다. 해당 bbox 안의 공개 추천 후보를 최대 500개 불러온다. 화면에 보이는 bbox가 8km보다 크더라도 추천은 중심 기준 최대 8km로 제한하고, 화면 bbox가 더 작더라도 후보 확보를 위해 서버 검색 bbox를 8km까지 확장한다.

추천 후보에는 최신 비 stale 평가 스냅샷과 다음 정보를 결합한다.

- 전체 평가 점수와 표본 수
- 사용자 평가 점수와 표본 수
- 리뷰어 평가 점수와 표본 수
- 활성 Golden Pick
- 과거 Golden Pick과 철회·만료 상태
- 로그인 사용자 또는 온보딩 비회원의 취향 신호
- 로그인 사용자의 현재 비추천 장소 ID

Golden 이벤트는 전체 테이블을 매 요청마다 메모리에 적재하지 않는다. 선택된 후보 place ID를 D1 바인딩 제한에 맞게 chunk로 나누어 관련 이벤트만 조회하고, 해당 이벤트 집합에서 활성·만료·철회 상태를 계산한다.

### 5.2 품질 필터

다음 조건은 유지한다.

- 평가 표본이 8개 이상이고 공개 평가 점수가 55점 미만이면 제외한다.
- 폐업, 비활성, 미공개, 운영 정책 제외 장소는 기존 공개 후보 쿼리에서 제외한다.
- 평가가 부족한 장소는 제외하지 않는다.
- 로그인 사용자가 현재 비추천(-1)한 장소는 후보에서 제외한다. 비회원 또는 사용자 평가 정보가 없는 경우에는 적용하지 않는다.
- 영업시간 데이터가 신뢰 가능한 구조로 제공되기 전에는 영업 여부로 강제 제외하지 않는다.

### 5.3 반경 선택

품질 필터를 통과한 후보를 실제 거리로 나누고 다음 순서로 반경을 결정한다.

1. 3km 내 후보가 20개 이상이면 3km를 사용한다.
2. 부족하면 5km 내 후보를 사용한다.
3. 다시 부족하면 8km 내 후보를 사용한다.
4. 8km에서도 20개 미만이면 확보된 후보 전체를 사용한다.

최종 결과는 최대 5개이며, 후보가 5개 미만이면 가능한 수만 반환한다.

## 6. Feature 계산

모든 feature는 0~1 범위로 정규화한다.

### 6.1 취향 점수

직접 취향과 인접 취향을 모두 합산한다. 동일 취향 배지가 여러 검색어에 걸리더라도 `배지 ID × 장소` 기준으로 한 번만 계산한다.

```text
directMatches = Σ 직접 일치 취향 강도
adjacentMatches = Σ 인접 일치 취향 강도 × 0.6

tasteScore = clamp(1 - exp(-(directMatches + adjacentMatches)), 0, 1)
```

사용자 직접 선택 신호는 1.0, NAVER와 Google 신호는 0.9, 추론 신호는 0.75의 기존 source 강도를 유지한다. 인접 취향은 기존 Taste Adjacency Graph를 사용한다.

### 6.2 거리 점수

작은 거리 차이가 순위를 과도하게 바꾸지 않도록 다음 구간 값을 사용한다.

| 거리 | 점수 |
|---|---:|
| 0~500m | 1.00 |
| 500m 초과~1km | 0.95 |
| 1km 초과~2km | 0.85 |
| 2km 초과~3km | 0.72 |
| 3km 초과~5km | 0.55 |
| 5km 초과~8km | 0.35 |
| 8km 초과 | 0.15 |

추천 반경 밖 장소는 후보에서 제외하므로 8km 초과 점수는 순수 함수의 방어값으로만 둔다.

### 6.3 시간대 점수

현재 장소 데이터에는 검증 가능한 영업시간이 없으므로 영업 여부 강제 필터는 사용하지 않는다.

| 상태 | 점수 |
|---|---:|
| 구체 음식 키워드 강한 일치 | 1.00 |
| 대표 카테고리 약한 일치 | 0.70 |
| 판단할 정보 없음 | 0.50 |
| 명확한 불일치 | 0.20 |

명확한 불일치는 현재 시간대 전용 키워드와 반대되는 구체 신호가 있을 때만 적용한다. 근거가 없으면 0.50을 사용한다.

### 6.4 신뢰도 점수

평가 점수와 표본 신뢰도를 분리한다.

```text
sampleConfidence = min(1, log(1 + ratingCount) / log(31))

평가가 존재할 때:
confidenceScore = ratingNormalized × (0.45 + 0.55 × sampleConfidence)

평가가 0개일 때:
confidenceScore = 0.35
```

평가 점수는 최신 rating snapshot을 우선하고, snapshot이 없으면 기존 Beta(2,2) 공개 평가 계산을 사용한다.

### 6.5 발견성 점수

직접 취향 일치 여부를 단순 0으로 만들지 않는다.

| 상태 | 점수 |
|---|---:|
| 강한 직접 일치 | 0.20 |
| 약한 직접 일치 | 0.35 |
| 인접 취향 | 0.65 |
| 취향 정보 없음 | 0.80 |
| 명확한 새로운 취향 | 1.00 |

강한 직접 일치는 direct 합이 0.75 이상인 경우, 약한 직접 일치는 0 초과 0.75 미만인 경우다. 명확한 새로운 취향은 사용자의 직접 취향과 인접 그래프에 모두 없으면서 최근 세션 노출에도 없는 카테고리다.

### 6.6 Golden 점수

| 상태 | 점수 |
|---|---:|
| 현재 유효 Golden Pick | 1.00 |
| 14일 이내 만료 예정 | 0.80 |
| 철회되지 않은 과거 Golden Pick | 0.40 |
| Golden Pick 아님 또는 철회됨 | 0.00 |

활성 Golden Pick의 primary pool 선정에서는 만료 임박 여부와 무관하게 활성 상태를 유지한다. 0.80 값은 활성 후보 간 보조 정렬에만 사용한다.

### 6.7 신선도 점수와 반복 감점

브라우저 세션 최근 10회 노출을 사용한다.

| 최근 노출 횟수 | freshnessScore |
|---|---:|
| 0회 | 1.00 |
| 1회 | 0.80 |
| 2회 | 0.55 |
| 3회 이상 | 0.30 |

최근 1순위 이력은 별도 감점한다.

| 상태 | 감점 |
|---|---:|
| 직전 추천의 1순위 | -0.12 |
| 최근 3회 중 2회 1순위 | -0.18 |
| 최근 3회 모두 1순위 | -0.30 |

조건이 여러 개에 해당하면 가장 큰 감점 하나만 적용한다. 장소를 완전히 제외하지 않으므로 모드 적합성이 압도적이면 다시 1순위가 될 수 있다.

## 7. 모드별 base score

| 모드 | 취향 | 거리 | 시간 | 신뢰 | 발견 | 신선도 | Golden |
|---|---:|---:|---:|---:|---:|---:|---:|
| 지금 갈 만한 곳 | 0.25 | 0.20 | 0.25 | 0.15 | 0.10 | 0.05 | 0 |
| 내 취향 | 0.45 | 0.12 | 0.08 | 0.15 | 0.12 | 0.08 | 0 |
| 시간대 추천 | 0.18 | 0.17 | 0.40 | 0.10 | 0.08 | 0.07 | 0 |
| Golden Pick | 0.10 | 0.07 | 0.03 | 0.18 | 0 | 0.07 | 0.55 |
| 새로운 발견 | 0.10 | 0.12 | 0.05 | 0.15 | 0.40 | 0.18 | 0 |

각 행의 합은 1이다. Phase 1·2에서는 고정 가중치를 사용하고 dataRichness 기반 동적 변경은 하지 않는다.

## 8. 결정적 변동값과 tie-break

완전 랜덤은 사용하지 않는다. 다음 값을 연결한 stable hash로 후보별 변동값을 만든다.

```text
sessionSeed + YYYY-MM-DD + mode + 500m 단위로 반올림한 지도 중심 + placeId
```

변동값 범위는 0~0.05다. 같은 세션, 날짜, 모드, 지도 중심에서는 결과가 안정적이다. 날짜, 세션 또는 500m 단위 중심이 달라지면 거의 동점인 후보만 일부 바뀐다.

동점 처리 순서는 다음과 같다.

1. 반복 감점과 변동값을 반영한 최종 score
2. freshnessScore
3. 모드 핵심 feature
4. 결정적 변동값
5. placeId stable hash

상호명은 랭킹 tie-break로 사용하지 않는다.

## 9. Golden Pick primary와 fallback

### 9.1 활성 Golden Pick이 있는 경우

활성 Golden Pick만 primary pool로 사용한다. 최대 5개를 먼저 선택한다. 5개 미만이면 부족한 슬롯만 fallback pool에서 채운다.

### 9.2 활성 Golden Pick이 없는 경우

일반 후보 전체로 fallback하지 않는다. 다음 근거 중 하나 이상이 있는 장소만 Golden fallback pool에 포함한다.

1. 철회되지 않은 과거 Golden Pick
2. 리뷰어 평가 점수와 리뷰어 표본이 존재하는 장소
3. 전체 평가 표본이 8개 이상인 신뢰 장소

fallback 점수는 다음과 같이 계산한다.

```text
pastGoldenScore × 0.35
+ reviewerConfidence × 0.35
+ confidenceScore × 0.20
+ freshnessScore × 0.10
```

reviewerConfidence는 리뷰어 점수와 reviewerSampleCount에 신뢰도 공식을 적용한다. fallback pool이 5개보다 적으면 가능한 수만 반환하며, 근거 없는 일반 후보로 수를 채우지 않는다.

응답에는 `goldenFallback: true`와 다음 notice를 포함한다.

> 현재 주변 Golden Pick이 없어 과거 선정 이력과 평가 기록을 바탕으로 추천합니다.

## 10. 1순위와 2~5순위 선정

### 10.1 1순위

1순위는 모드 base score에 최근 1순위 감점과 결정적 변동값을 적용한 최상위 후보로 선정한다. Golden 모드는 Golden primary 또는 전용 fallback pool에서만 선정한다.

### 10.2 2~5순위 MMR

1순위 선택 후 나머지 후보는 다음 selection score로 순차 선택한다.

```text
selectionScore = relevanceScore
- categoryPenalty
- detailTypePenalty
- proximityPenalty
- reasonPenalty
- reviewerPenalty
+ freshnessScore × 0.05
```

| 중복 상태 | 감점 |
|---|---:|
| 동일 대표 카테고리 | -0.12 |
| 동일 세부 음식 유형 | -0.10 |
| 선택된 장소 중 하나와 500m 이내 | -0.08 |
| 동일 핵심 추천 이유 | -0.08 |
| 동일 Golden Pick 리뷰어 | -0.08 |

동일 후보를 중복 선택하지 않는다. 감점은 이미 선택된 장소 중 해당 조건이 하나라도 있으면 조건별 한 번만 적용한다.

`detailTypeKey`는 장소에 일치한 취향 신호 중 강도가 가장 높은 직접 배지 ID, 그다음 인접 배지 ID, 마지막으로 대표 카테고리 slug 순으로 결정한다. 동률이면 배지 ID stable hash 순서를 사용한다. 따라서 ‘동일 세부 음식 유형’은 화면 문구가 아니라 동일한 `detailTypeKey`인지로 판정한다.

### 10.3 모드 변경 최소 변화량

직전 요청과 현재 요청의 모드가 실제로 다르고, 이전 결과와 새 결과가 5곳 중 4곳 이상 겹치며 현재 후보가 8곳 이상이면 보정을 적용한다. 1순위는 유지하고, 2~5순위 MMR에서 이전 결과 중복 후보에 추가 -0.12를 적용해 최소 두 장소가 달라지도록 다시 선택한다. 같은 모드의 재렌더나 재시도에는 최소 변화량을 강제하지 않는다.

후보가 7곳 이하이거나 Golden primary/fallback pool이 부족하면 최소 변화량을 강제하지 않는다. 낮은 근거의 장소를 억지로 노출하지 않기 위해 Golden 모드에서는 pool 경계를 넘지 않는다.

## 11. 브라우저 세션 기록

`sessionStorage`에 다음 데이터를 저장한다.

```ts
type HomeRecommendationSession = {
  sessionId: string;
  recentRecommendations: Array<{
    mode: HomeCurationMode;
    placeIds: string[];
    firstPlaceId: string | null;
    shownAt: string;
  }>;
  previousMode: HomeCurationMode | null;
  previousPlaceIds: string[];
};
```

- 최근 추천 10회만 유지한다.
- placeIds는 결과 최대 5개만 저장한다.
- 탭을 닫으면 브라우저가 기록을 제거한다.
- 로그인 여부와 무관하게 동작한다.
- DB, 쿠키 또는 개인정보를 저장하지 않는다.

서버 요청에는 전체 이벤트 대신 다음 요약을 base64url JSON으로 전달한다.

```ts
type HomeRecommendationHistorySummary = {
  sessionSeed: string;
  recentFirstPlaceIds: string[]; // 최대 3
  recentShown: Array<{ placeId: string; count: number }>; // 최대 30
  previousMode: HomeCurationMode | null;
  previousPlaceIds: string[]; // 최대 5
};
```

허용 모드, 배열 길이, count 범위, placeId 길이와 전체 인코딩 길이를 검증한다. 잘못된 이력은 권한이나 데이터 변경에 영향을 주지 않으므로 요청 실패 대신 빈 이력으로 무시한다.

## 12. 요청과 화면 흐름

첫 SSR 진입에서는 서버가 세션 기록 없이 추천을 생성하고 즉시 화면에 표시한다. hydration 직후 자동 재요청하지 않는다.

다음 사용자 행동에서만 sessionStorage 요약을 포함해 새 추천을 요청한다.

- 추천 모드 변경
- 내 위치 사용
- 이 지역 다시 추천
- 추천 재시도

성공 응답을 받은 뒤 현재 결과를 sessionStorage에 기록한다. 요청 실패 시 기존 결과와 기존 세션 기록을 유지한다.

응답은 다음 메타데이터를 포함한다.

```ts
type HomeCurationPageV2 = {
  algorithmVersion: "home-curation-v2";
  status: "READY" | "EMPTY";
  places: HomeCuratedPlace[];
  mode: HomeCurationMode;
  timeSlot: HomeTimeSlot;
  radiusMeters: 3_000 | 5_000 | 8_000;
  candidateCount: number;
  goldenFallback: boolean;
  notice: string | null;
};
```

## 13. 위치 기준

추천 기준 위치의 출처를 구분한다.

```ts
type HomeLocationSource = "gps" | "map_center";
```

- 사용자가 `내 위치`를 성공적으로 누르면 `gps`다.
- 최초 지도, 지도 이동 후 다시 추천은 `map_center`다.
- 위치 출처는 홈 URL의 `locationSource`에 유지한다. 전체 지도에서 새 bbox를 확정하면 `map_center`로 갱신하고 추천 지도로 돌아올 때 loader와 리소스 요청이 같은 값을 사용한다.

추천 이유도 위치 출처를 반영한다.

- GPS: `현재 위치에서 가까워요`
- 지도 중심: `현재 보고 있는 지역에서 가까워요`

bbox 중심을 실제 사용자 GPS로 표현하지 않는다.

## 14. 추천 이유

추천 이유는 각 장소의 실제 feature 기여도를 계산하고, 모드별 가중치 적용 후 기여도가 큰 근거 중 사실인 1~2개만 사용한다.

예시:

- `평소 좋아하는 국밥 취향과 잘 맞아요`
- `현재 위치에서 가깝고 점심 메뉴로 잘 맞아요`
- `자주 고르지 않던 중식 카테고리예요`
- `최근 리뷰어 평가 기록이 있어요`
- `주변 Golden Pick 중 평가 신뢰도가 높아요`

실제 feature가 없는 문구는 생성하지 않는다. LLM은 사용하지 않는다.

## 15. 모듈 경계

### `app/features/places/home-curation-features.ts`

- 취향, 거리, 시간, 신뢰도, 발견성, 신선도 계산
- 결정적 hash와 variation 계산
- 외부 상태가 없는 순수 함수 제공

### `app/features/places/home-curation-ranking.ts`

- 모드별 base score
- Golden primary/fallback pool
- 최근 1순위 감점
- 1순위 선정
- MMR 2~5순위 선정
- 모드 차이 보정
- feature contribution 기반 추천 이유

### `app/features/places/home-curation-history.client.ts`

- sessionStorage 읽기, 검증, 갱신
- 최근 10회 유지
- 서버 요청용 이력 요약 생성

### `app/features/places/home-curation.server.ts`

- 8km 검색 bbox 계산
- 후보 데이터 결합
- 3km, 5km, 8km 후보 풀 확정
- 순수 랭킹 함수 호출 및 응답 조립

### 기존 `app/features/places/home-curation.ts`

기존 공개 타입의 호환 진입점으로 유지하거나, 새 모듈의 타입과 함수를 재수출하는 얇은 facade로 축소한다. 소비자가 한 번에 모두 변경되지 않도록 한다.

## 16. 오류 처리

- sessionStorage 접근 실패: 빈 이력으로 추천을 유지한다.
- 세션 이력 파싱 실패: 빈 이력으로 무시한다.
- Golden 이력 조회 실패: 일반 추천으로 조용히 변질시키지 않고 Golden 결과를 빈 상태와 안내로 반환한다.
- 후보가 5곳 미만: 가능한 수만 반환한다.
- 후보가 0곳: 기존 EMPTY 상태를 유지한다.
- 추천 리소스 실패: 현재 화면 결과를 유지하고 재시도 안내를 노출한다.
- 추천 이유 계산 실패: 사실이 검증된 일반 근거 하나만 사용하고 임의 문구를 만들지 않는다.

## 17. 성능

- DB 후보는 최대 500개다.
- feature 계산은 후보 수에 선형이다.
- 1순위 선정은 선형이다.
- MMR은 최대 4회 × 후보 500개 비교로 제한한다.
- 세션 이력은 최대 최근 10회, 요약 장소 최대 30개다.
- Wilson/Beta 평가 계산과 rating snapshot은 기존 계산 결과를 재사용한다.
- embedding, LLM, 외부 트렌드 분석은 사용하지 않는다.

## 18. 검증 전략

### 18.1 단위 테스트

- 거리 경계 500m, 1km, 2km, 3km, 5km, 8km
- 평가 0, 1, 5, 20개 신뢰도
- 다중 직접·인접 취향 합산 및 배지 중복 방지
- 동일 seed 결과 안정성
- 다른 세션·날짜에서 동점권 변화
- 최근 1순위 감점
- 상호명이 tie-break가 아닌 계약
- 활성 Golden 0, 1, 5개와 fallback
- 철회 Golden 제외
- 로그인 사용자의 현재 비추천 장소 제외
- MMR 카테고리·세부 유형·거리·이유·리뷰어 중복 감점
- 모드 변경 시 최소 두 장소 변화
- 세션 저장·복원·10회 제한·손상 데이터 복구

### 18.2 통합 테스트

- 3km, 5km, 8km 후보 확장
- 활성·만료·철회 Golden 이벤트 구분
- reviewerScore와 reviewerSampleCount fallback
- 비 stale 최신 rating snapshot 결합
- 이력 입력의 길이와 형식 검증
- 기존 품질 필터 유지
- Golden 근거가 없을 때 일반 근거리 후보를 반환하지 않는 계약

### 18.3 브라우저 테스트

- 같은 세션·모드 결과 안정성
- 모드 변경 시 후보가 충분하면 최소 두 장소 변화
- 최근 1순위 반복 감점
- Golden 부재 안내 노출
- 내 위치와 지도 중심 추천 이유 구분
- sessionStorage 비활성 또는 손상 시 정상 fallback
- 데스크톱·모바일 동일 동작

### 18.4 전체 검증

- `pnpm test`
- `pnpm run test:integration`
- `pnpm run typecheck`
- `pnpm run build`
- 관련 Playwright 데스크톱·모바일 테스트
- `git diff --check`

## 19. 완료 조건

- 평가가 부족한 후보가 모두 같은 0.2 신뢰 점수를 받지 않는다.
- 직접·인접 취향 여러 개가 누적 반영된다.
- 작은 거리 차이가 유일한 순위 결정자가 되지 않는다.
- 같은 세션에서 결과가 안정적이며 최근 1순위는 감점된다.
- 상호명 가나다순을 랭킹 tie-break로 사용하지 않는다.
- Golden Pick 모드는 근거 없는 일반 후보로 fallback하지 않는다.
- 1순위는 모드 적합성을, 2~5순위는 적합성과 다양성을 함께 반영한다.
- 후보가 8곳 이상일 때 모드 변경 결과에서 최소 두 장소가 달라진다.
- DB migration, 환경 변수, 유료 외부 호출이 없다.
