# 운영 후보 카테고리 분류 감사

## 감사 기준

- 일시: 2026-08-08
- 대상: 운영 D1의 `OPEN`·`PENDING` 후보
- 방식: 운영 데이터는 읽기 전용으로 조회하고 현재 브랜치의 순수 분류 함수로 집계
- 개인정보 보호: 상호명과 주소는 문서나 저장소에 기록하지 않고 숫자 집계만 남김

## 적용 전 결과

체인점 `ACTIVE` 제외 기록을 뺀 일반 검수 대상은 732곳이었다.

### 신뢰도

| 신뢰도 | 건수 |
|---|---:|
| HIGH | 131 |
| MEDIUM | 308 |
| LOW | 279 |
| CONFLICT | 14 |

`LOW` 또는 `CONFLICT`는 293곳이다. 상호명이 일반적이거나 상호의 구체 음식과 원천 업태가 충돌하는 후보로, AI 보조 또는 수동 확인 대상이다.

### 주요 추천 분포

| 카테고리 slug | 건수 |
|---|---:|
| home-meal | 343 |
| cafe | 129 |
| pub | 57 |
| bakery-detail | 34 |
| chicken | 25 |
| seafood-dish | 24 |
| pasta | 16 |
| grill | 14 |
| tteokbokki | 11 |
| jokbal-bossam | 9 |
| gukbap-detail | 7 |
| pocha | 7 |
| gimbap | 7 |

나머지 활성 세부 카테고리는 각 1~6곳이었다.

## 발견된 문제와 조치

### 카테고리 slug 불일치 43곳

분류기가 추천한 slug와 운영 카테고리 slug가 달라 관리자 선택값에 연결되지 않는 후보가 43곳 있었다.

| 추천 slug | 건수 | 운영의 과거 slug |
|---|---:|---|
| bakery-detail | 34 | bakery |
| gukbap-detail | 7 | gukbap |
| donkatsu-detail | 2 | donkatsu |

원인은 초기 카테고리 행이 먼저 존재해 `0002_category_taxonomy.sql`의 `INSERT OR IGNORE`가 표준 slug로 갱신하지 못한 것이다. `0012_repair_category_slugs.sql`에서 동일 category ID를 유지한 채 표준 slug와 이름만 복구한다. 적용 후 unknown category 예상 건수는 0곳이다.

### 일반 검수 큐의 기존 체인점 8곳

명시적 체인 사전과 일치하지만 제외 기록이 없는 후보가 8곳 있었다. 관리자 복원 상태인 후보는 없었다. `0011_backfill_chain_store_exclusions.sql`이 이들을 `ACTIVE` 제외로 등록하며, 이후 일반 검수 큐가 아니라 `체인점 제외` 탭에 표시된다.

## 안전 판단

- 문맥형 키워드 확장 후에도 279곳은 `LOW`로 남아 근거가 없는 상호를 강제 분류하지 않는다.
- 서로 다른 구체 음식 신호가 겹친 14곳은 `CONFLICT`로 유지한다.
- AI 결과는 원문과 일치한 근거가 하나 이상일 때만 사용하고 자동 공개에는 사용하지 않는다.
- 체인점 backfill은 `OPEN`·`PENDING`과 명시적 체인 별칭만 대상으로 하며 기존 `OVERRIDDEN` 행을 덮어쓰지 않는다.

## 배포 전 확인 항목

- migration `0011`, `0012` 순서 적용
- migration 적용 후 unknown category 0곳 확인
- 일반 검수 큐의 미등록 명시적 체인점 0곳 확인
- 관리자 화면에서 베이커리·국밥·돈가스 추천값 자동 선택 확인
