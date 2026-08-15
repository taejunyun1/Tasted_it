# 장소 분류 v5와 맥락형 코스 추천 v2 설계

- **상태:** ACCEPTED — 2026-08-15 사용자 승인. 구현 PR은 기술·데이터·운영 영향과 rollout 범위를 `GO`로 명시한다.
- **소유:** Codex (`tj_algorithm-v5-design`)
- **범위:** 공공데이터 기반 장소 분류를 `place-category-v5`로 병행 저장하고, 그 결과의 업장 속성을 `course-context-v2`가 재사용한다.
- **비범위:** 새 지도·검색 공급자, 비공식 지도 크롤링, 실시간 LLM 추천, 사용자별 취향·Golden Pick의 코스 점수 반영(v2.1 이후).

## 1. 문제와 원칙

현재 분류기는 넓은 원천 업태와 기본값 때문에 `한식 → 백반·가정식`, `경양식 → 돈가스`처럼 근거 없는 세부 분류를 만들 수 있다. 코스 추천은 평가와 거리에 치우쳐 실제 시간대·영업 가능성·업장 성격을 충분히 반영하지 못한다.

이번 변경의 우선순위는 다음과 같다.

1. 잘못된 세부 분류보다 `일반` 또는 `미확정`을 선택한다.
2. 장소의 대표 음식과 식사 성격을 분리한다.
3. NAVER와 AI는 검증자이며, 근거 없는 자동 분류기가 아니다.
4. 코스는 거리보다 방문 가능성, 시간대, 메뉴 적합성을 먼저 판단한다.
5. 기존 공개 카테고리를 즉시 덮어쓰지 않고 v4와 v5를 병행 비교한다.

## 2. 릴리스 분해와 롤아웃

이 변경은 서로 독립적으로 검증 가능한 두 하위 프로젝트로 나눈다.

| 단계 | 산출물 | 공개 영향 |
| --- | --- | --- |
| A | `place-category-v5`, `naver-category-v2`, 적대적 AI 검증, v5 결과 병행 저장, 관리자 dry-run | 기존 공개 장소 카테고리를 바꾸지 않음 |
| B | `course-context-v2`, 시간대·메뉴 호환도·업장 속성·영업시간 상태를 반영한 코스 순위 | v5 프로필이 없는 장소도 안전한 fallback으로 유지 |
| C | 100건 이상 비교 표본과 관리자 확인 후 제한적 activate | `VERIFIED` 근거가 충분한 결과만 forward-fix 적용 |

단계 A와 B는 별도 Pull Request로 진행한다. 자동 변경은 C에서만 허용하며, migration rollback 대신 감사 이력의 이전값을 쓰는 forward-fix로 되돌린다.

## 3. 분류 v5 파이프라인

```text
공공데이터
  → 기존 음식점 제외 정책
  → 상호 정규화·음식/비음식/모호 표현 추출
  → FOOD_PLACE_SCORE
  → Level 1~4 후보 생성·점수화
  → CONFLICT·GREEN/YELLOW/ORANGE/RED 판정
  → NAVER 장소 유형·카테고리 검증(v2)
  → AI 적대적 검증
  → 자동 가능 / 보류 / 수동 확인
```

### 3.1 음식점 대상 여부

기존 `food-venue-policy`를 첫 관문으로 유지한다. 유흥·성인 업종, 노래방, 라이브바·라이브클럽·라이브카페, PC방, 공방·원데이클래스·공예, 편의점(CU·GS25·세븐일레븐 등)은 기본 제외한다. 관리자가 `OVERRIDDEN`한 원천은 이 필터를 통과할 수 있다.

`foodPlaceScore`는 0~100의 파생 점수다. 상호·원천 업태에 구체 음식, 조리 방식, 음식 업장 형태가 있으면 올리고, 비음식·모호 표현은 내린다. 이 점수는 공개 평점이나 사용자 화면에 노출하지 않으며 분류 상태와 수동 검수 우선순위에만 쓴다.

### 3.2 사전과 계층

사전은 코드의 버전 관리되는 설정으로 유지하며, 음식 긍정 신호·사람/감성형 모호 신호·비음식 신호를 서로 분리한다.

- 긍정 신호가 있는 `할매국밥`, `청년다방`은 정상 음식점 후보로 처리한다.
- 긍정 신호 없이 `김대리`, `칼퇴근 김대리`, `낭만 연구소`처럼 사람·생활형 표현만 있으면 `NAME_AMBIGUOUS` 또는 `RED` 후보로 처리한다.
- 헤어·공방·PC·호텔·학원 등 비음식 신호는 음식 신호가 없을 때 `RED` 후보가 된다. 단어 하나만으로 즉시 공개 제외하지 않는다.

카테고리 근거의 우선순위는 아래 네 단계다.

| Level | 근거 | 예 |
| --- | --- | --- |
| 1 | 구체 메뉴 | 국밥, 마라탕, 초밥, 돈카츠, 닭강정, 물회 |
| 2 | 재료·조리 방식 | 숯불, 화로, 식육, 정육, 활어, 생선구이 |
| 3 | 업장 형태 | 횟집, 이자카야, 포차, 호프, 로스터리, 기사식당 |
| 4 | 넓은 음식 권역 | 한식, 일식, 중식, 양식, 기타 외국식 |

점수는 기존 기준을 보존한다. 상호 Level 1 메뉴 80점, 상호 업장 형태 74점, 원천 구체 메뉴 65점, 원천 업장 형태 45점, 넓은 원천 권역 25~35점, 원천 종류 기본값 10~15점, 우선순위 보너스 최대 10점, 같은 카테고리 보조 근거는 원점수의 30%, 같은 음식권역 보조 근거는 6점이다. 최종 범위는 0~100이다.

넓은 원천 업태는 절대로 상세 메뉴의 자동 근거가 아니다.

| 원천 업태 | v5 기본 결과 |
| --- | --- |
| 한식 | 한식 일반 |
| 일식 | 일식 일반 |
| 중식 | 중식 일반 |
| 경양식·양식 | 양식 일반 |
| 기타 외국식 | 세계음식 일반 |

따라서 `한식 → 백반·가정식`, `경양식 → 돈가스` 규칙은 제거한다. 기존 taxonomy에 없는 일반 leaf 카테고리는 additive migration으로 추가한다.

### 3.3 분류 결과 계약

각 v5 결과는 다음을 가진다.

```ts
type PlaceClassificationV5 = {
  primaryCategorySlug: string | "category-unresolved";
  secondaryCategoryCandidates: string[]; // 최대 4개, primary 제외
  placeTraits: PlaceTrait[];
  foodPlaceScore: number; // 0~100
  confidence: "HIGH" | "MEDIUM" | "LOW" | "CONFLICT";
  state: "GREEN" | "YELLOW" | "ORANGE" | "RED";
  decision: "RULE_ONLY" | "AUTO_ELIGIBLE" | "MANUAL" | "CONFLICT" | "EXCLUDED";
  evidenceCodes: string[];
  algorithmVersion: "place-category-v5";
};

type PlaceTrait =
  | "BREAKFAST_POSSIBLE" | "LUNCH" | "DINNER" | "LATE_MEAL"
  | "ALCOHOL_FRIENDLY" | "SOLO_FRIENDLY" | "GROUP_FRIENDLY" | "FAMILY_FRIENDLY"
  | "QUICK_MEAL" | "BRUNCH" | "DESSERT" | "CAFE" | "PARKING_LIKELY" | "OPEN_LATE";
```

대표 음식은 `primaryCategorySlug`로, 업장 성격은 `placeTraits`로 표현한다. 예를 들어 치킨호프는 `chicken`과 `ALCOHOL_FRIENDLY`를 함께 갖고, 둘 중 하나로 축소하지 않는다.

동일 Level의 서로 다른 구체 메뉴가 모두 65점 이상이고 점수 차가 20점 이하이면 `CONFLICT`다. 단, 더 높은 우선순위가 명확하게 이기면 해소할 수 있다. 후보는 primary를 포함해 최대 4개를 유지한다.

### 3.4 상태와 자동 처리

| 상태 | 조건 | 다음 처리 |
| --- | --- | --- |
| GREEN | 구체 음식 신호, 원천 모순 없음, RED FLAG 없음, HIGH | `RULE_ONLY` 가능 |
| YELLOW | 음식점은 유력하나 상세 근거 약함 | NAVER 우선, 필요 시 AI |
| ORANGE | 강한 후보 복수 또는 원천·상호 모순 | NAVER와 AI 필수 |
| RED | 음식 신호 없음, 모호/비음식 신호, 원천만 음식점 주장 | 자동 공개 금지, NAVER+AI 후에도 불충분하면 수동 |

HIGH는 Level 1·2 구체 근거와 65점 이상, 또는 RED FLAG 없이 78점 이상, 또는 검증된 NAVER 구체 카테고리 일치일 때다. 넓은 업태만으로 HIGH가 될 수 없다.

## 4. NAVER v2와 AI 적대적 검증

NAVER는 `RED → ORANGE → YELLOW → 기존 공개 LOW` 순서로 제한된 배치에서만 호출한다. GREEN+HIGH는 비용 절감을 위해 생략할 수 있다. 사용자 공개 화면에서는 호출하지 않는다.

정규화 상호가 일치하고 주소가 일치하거나 좌표가 100m 이내이며 광주·전남 결과일 때만 동일 장소로 본다. 유효 결과가 여러 개면 `AMBIGUOUS`로 수동 확인한다.

NAVER는 아래 두 판단을 분리해서 저장한다.

```ts
type PlaceTypeVerification = "FOOD_CONFIRMED" | "FOOD_LIKELY" | "NON_FOOD" | "UNKNOWN" | "AMBIGUOUS";
type CategoryVerification = "SPECIFIC_MATCH" | "BROAD_ONLY" | "CONFLICT" | "UNKNOWN";
```

이름·위치 40점, NAVER 구체 카테고리 20점, 원천 업태 의미 일치 20점, 상호 구체 음식 일치 10점, AI 일치 10점으로 최대 100점이다. 85점 이상만 자동 변경 가능하다. `한식`, `일식`, `중식`, `양식`, `카페`, `주점`처럼 넓은 NAVER 카테고리는 상세 분류의 자동 근거가 아니다.

AI는 Llama 3.1 8B Instruct Fast를 유지하되 자유 분류기가 아니다. 모델에는 상호, 원천 종류·업태, v5 후보, 검증된 NAVER 요약과 근거 코드만 준다. 출력은 다음 strict 계약을 따른다.

```ts
type AdversarialVerdict = "SUPPORTED" | "WEAK" | "CONFLICT" | "NOT_FOOD" | "UNKNOWN";
type AiVerification = {
  verdict: AdversarialVerdict;
  selectedCandidate: string | null; // v5 후보 안에서만
  confidence: number; // 0~1
  evidence: string[]; // 입력 문자열 또는 NAVER 검증 정보만
};
```

AI가 후보 밖 메뉴를 만들거나 근거를 인용하지 못하면 결과를 폐기한다. 0.85 이상으로 규칙과 일치하면 `confidence × 10`만 가산한다. 불일치가 0.85 이상이면 CONFLICT, 그 미만이면 규칙 점수 10점 감점이다. RED는 NAVER+AI가 모두 맞아도 자동 공개가 아닌 `AUTO_ELIGIBLE`이며 기존 공개 변경은 관리자 승인 후에만 활성화한다.

외부 호출은 현재 NAVER Local adapter와 Workers AI adapter 안에만 둔다. feature flag, request timeout, 일일 quota, bounded retry, fake adapter, 오류 시 기존 분류 유지가 필수다. 원문 검색 결과·사진·리뷰·소개 문구는 저장하지 않고, 최소한의 상태·점수·근거 코드·조회 시각·입력 지문만 보관한다.

## 5. 병행 저장, 관리자 dry-run, 활성화

v4를 지우지 않는다. additive migration으로 다음 파생 데이터를 만든다.

| 데이터 | 목적 | 보존·정리 |
| --- | --- | --- |
| `place_classification_results` | 후보/공개 장소별 v5 결과, 점수, 상태, 제한된 근거 코드 | 동일 입력 지문·버전의 중복은 재사용, 활성 결과 외 180일 후 정리 대상 |
| `place_classification_profiles` | 공개 장소에서 현재 활성화된 v5 primary/secondary/traits 연결 | 장소 삭제 시 cascade, 새 활성 결과로 교체 가능 |
| `category_reclassification_runs` | dry-run cursor, 집계, 실패·quota, 실행자 | 감사 목적 1년 보존 |
| `place_operating_hours` | 관리자가 검증한 주간 영업시간과 만료 시각 | 관리자가 수정·삭제 가능, 검증 만료 시 UNKNOWN 처리 |

`place_classification_profiles`가 없는 장소는 기존 `place_categories` primary와 빈 traits를 사용한다. 즉 단계 B가 기존 공개 화면을 끊지 않는다.

관리자 dry-run은 100곳 이하 cursor batch만 실행한다. 결과에는 전체 처리, 동일, 변경, 미확정, GREEN/YELLOW/ORANGE/RED/CONFLICT, NAVER 필요, AI 필요, MANUAL 필요 집계와 최소 100건의 v4/v5 비교 표본을 포함한다. dry-run은 `places`나 `place_categories`를 수정하지 않는다.

활성화는 `VERIFIED` 근거와 정책 조건을 충족한 항목만 명시 선택하여 수행한다. 모든 전환은 기존 감사 로그와 분류 결과 ID·알고리즘 버전·근거 코드·전후 category/traits를 남긴다. API flag를 끄면 v5 외부 검증만 중단하고, 이미 공개된 장소는 유지한다.

## 6. 코스 추천 v2

### 6.1 시간·영업 상태

KST 기준 시간대는 다음 여섯 구간이다.

| 내부 구간 | 시간 |
| --- | --- |
| breakfast | 06:00–10:29 |
| lunch | 10:30–13:59 |
| afternoon | 14:00–16:59 |
| dinner | 17:00–19:59 |
| late-dinner | 20:00–22:59 |
| overnight | 23:00–05:59 |

기존 URL의 `time=late`는 `late-dinner`로 호환 처리한다. UI에는 아침과 심야를 추가하고, 자동은 위 시간표에 따라 결정한다.

영업 상태는 `OPEN_NOW`, `OPEN_AT_ARRIVAL`, `CLOSES_SOON`, `CLOSED`, `UNKNOWN` 중 하나다. 현재 NAVER Dynamic Map·Geocoding·Local Search는 음식점 영업시간의 서버 원본이 아니므로 비공식 수집이나 크롤링을 하지 않는다.

- `CLOSED`: 후보 제외
- `OPEN_NOW`, `OPEN_AT_ARRIVAL`: 정상
- `CLOSES_SOON`: 강한 감점
- `UNKNOWN`: 유지하되 감점, 특히 `overnight`에서 더 크게 감점

초기 확정 영업시간은 관리자 검증 `place_operating_hours`만 사용한다. 데이터가 없으면 UNKNOWN이며, 그 자체로 장소를 숨기지 않는다. 이후 승인된 공공·제휴 원본이 생길 경우 별도 adapter·개인정보·비용·보존·rollback 심사를 거친다.

### 6.2 시간·메뉴·trait 적합도

`TIME_FIT_SCORE`는 category/trait와 여섯 시간대의 0~100 설정값이다. 요청서의 기사식당·국밥·브런치·돈가스·고기·곱창·족발·치킨·해산물·포차·카페·베이커리·디저트 표를 코드 설정으로 넣고, 테스트 fixture에서 독립적으로 검증한다.

첫 장소는 기본적으로 카페·디저트를 제외한다. 다만 아침·오후에는 브런치·베이커리·샌드위치·토스트·카페형 브런치를 허용한다. 두 번째 장소는 현재 카페 또는 디저트 pool을 유지하되 시간대와 실제 영업 상태를 적용한다. 심야에 적합한 두 번째 장소가 없으면 오류 대신 단일 장소 코스를 허용한다.

선택 메뉴와 장소 카테고리는 `CATEGORY_MATCH_SCORE`로 비교한다.

| 관계 | 점수 |
| --- | ---: |
| exact | 100 |
| direct child/detail | 90 |
| same food family | 70 |
| adjacent | 40 |
| unrelated | 0 |

메뉴를 골랐을 때 unrelated는 제외 또는 강한 감점한다. 호환성 graph는 taxonomy와 분리된 명시 설정이며, 추천 UI의 배지는 traits·영업 상태·실제 score 근거에서만 만든다.

### 6.3 점수·다양성·주차

v2 기본 점수는 아래와 같이 100점이다.

| 요소 | 비율 |
| --- | ---: |
| 첫 장소 품질 | 22 |
| 첫 장소 시간 적합도 | 18 |
| 선택 메뉴 적합도 | 15 |
| 사용자→첫 장소 거리 | 15 |
| 두 번째 장소 품질 | 12 |
| 두 번째 장소 시간 적합도 | 5 |
| 두 장소 거리 | 10 |
| course context/traits | 3 |

메뉴 미선택 시 15점은 시간 +7, 품질 +4, 거리 +4로 재분배한다. 품질은 `rating-v1`을 유지하며, 표본 0~2개 0.85, 3~7개 0.93, 8개 이상 1.0 reliability modifier를 품질 성분에만 적용한다.

결과는 상위 3개다. 후보에 서로 다른 첫 장소가 두 곳 이상 있으면 상위 3개는 최소 두 곳의 첫 장소를 포함해야 하며, 같은 첫 장소에 두 번째 장소만 다른 조합은 최대 두 개까지만 허용한다. 동점은 최종 점수, 시간 적합도, 메뉴 적합도, 첫 장소 품질, 사용자 거리, 장소 간 거리, 장소 ID 순으로 안정 정렬한다.

`parking-course-v1`은 유지한다. 코스 시작 시각과 첫 70분·두 번째 60분·이동·90분 buffer를 그대로 전달하며, `CLOSES_SOON` 또는 단일 장소 코스 정보가 주차 표시에도 모순 없이 반영되도록 입력 경계를 정리한다.

## 7. 실패 처리와 운영 안전장치

1. NAVER/AI timeout, quota, 429, 5xx는 기존 분류를 유지하고 제한된 오류 코드와 batch 상태만 남긴다.
2. 어느 외부 확인도 없는 RED/CONFLICT는 자동 PUBLISHED 전환하지 않는다.
3. dry-run과 활성화는 idempotency key·cursor·실행자·입력 hash를 갖고 중복 실행을 막는다.
4. 모든 batch는 최대 100곳, AI/NAVER 동시성·일일 상한은 환경변수, kill switch는 명시적으로 enable해야 한다.
5. 영업시간 데이터가 없거나 만료된 장소는 UNKNOWN이다. 거짓 OPEN을 만들지 않는다.
6. 공개 요청·코스 화면은 DB의 파생값만 읽고 NAVER·AI를 동기 호출하지 않는다.

## 8. 검증 기준

### 분류

- `한식`만 있는 `칼퇴근 김대리`는 백반으로 자동 확정되지 않고 RED/MANUAL이다.
- `식육(숯불구이)`는 `grill` 후보와 Level 2 근거를 만든다.
- `정종/대포집/소주방`은 포차/주점 후보와 `ALCOHOL_FRIENDLY`를 만든다.
- PC방·공방·편의점·라이브카페는 OVERRIDDEN이 아니면 음식점 대상에서 제외된다.
- NAVER broad-only는 음식점 확인에만 쓰고 상세 slug를 만들지 않는다.
- NAVER/AI가 후보·근거 계약을 위반하거나 서로 충돌하면 자동 변경하지 않는다.
- v4/v5 dry-run의 집계·100건 비교 표본·감사 기록·재실행 idempotency를 actual D1 integration으로 검증한다.

### 코스

- 아침 고기구이, 심야 브런치, 확정 CLOSED 장소는 추천하지 않는다.
- UNKNOWN은 낮/심야에서 서로 다른 감점을 받고, verified OPEN_AT_ARRIVAL은 유지된다.
- 메뉴 exact/direct family/adjacent/unrelated의 점수와 제외가 table-driven 테스트로 고정된다.
- 메뉴 미선택 재분배, 단일 장소 심야 fallback, 상위 3개 다양성, 안정 동점 정렬을 검증한다.
- 데스크톱과 모바일에서 여섯 시간대 선택, 코스 배지, 빈 두 번째 장소, 주차 결과가 깨지지 않는지 Playwright로 확인한다.

## 9. PR·운영 게이트

구현 PR은 다음을 반드시 기록한다.

- 새 D1 테이블별 소유자, 보존·삭제 방식, migration, query/index 검증, forward-fix rollback.
- NAVER·Workers AI 대상, per-run/per-day 상한, timeout/retry, feature flag, local fake, 장애 UX.
- 상호·주소의 외부 전송 및 저장 최소화, 원문 응답 비보관, 로그 redaction.
- local unit/integration, desktop/mobile E2E, dry-run sample, production rollout/rollback 절차.

새 공급자·비공식 크롤링·실시간 외부 호출은 이번 범위에 포함하지 않는다.
