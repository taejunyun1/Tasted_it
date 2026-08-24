# POI 등록 절차 (유저 / 관리자)

- **역할:** 장소가 손님 맵·리스트에 오르기까지의 과정 SSOT
- **화면:** 유저 `/suggestions/new` · `/me/suggestions`. 관리자 `/admin/place-operations`
- **이 문서가 승인하지 않는 것:** 일괄 공개, 한도 상향, 원격 D1 시드, 라이브 NAVER 일괄, 유저가 바로 `PUBLISHED`로 넣는 기능

손님에게 보이는 장소는 `places.status = PUBLISHED`뿐이다. **카탈로그 허용은 관리자 검수 5단계의 마지막(승인·공개) 한 곳**이다. 유저 제안·공공데이터·CSV는 대기열이다.

관련: [장소 운영 가이드](./place-operations-runbook.md) · [NAVER 검증](./naver-local-category-runbook.md) · [week1 데이터](./week1-data-runbook.md) · 설계 [`docs/superpowers/specs/2026-08-15-place-review-pipeline-design.md`](../superpowers/specs/2026-08-15-place-review-pipeline-design.md)

---

## 1. 한 줄 비교

| | 유저 | 관리자 |
|---|---|---|
| 할 수 있는 일 | 빠진 가게 **제안** | 원천 확인 → 근거 → 카테고리 → 중복 → **선택 공개** |
| 끝나는 상태 | `place_suggestions` `SUBMITTED` | 5단계에서 고른 항목만 `PUBLISHED` |
| 공개 리스트에 바로 올라가는가 | 아니오 | 5단계에서 고른 것만 |
| 로그인 | 이메일 인증 회원 | ADMIN |

정정(`/corrections/new`)은 이미 있는 장소의 정보·영업 요청이다. POI **등록이 아니다.**

---

## 2. 상태

### 장소 (`places.status`)

| 값 | 손님 화면 | 의미 |
|---|---|---|
| `DRAFT` | 안 보임 | 제안 초안 승인 또는 CSV 기본값. 아직 공개 검수 전 |
| `PUBLISHED` | 맵·리스트·상세 | 관리자가 공개를 실행함 |
| `HIDDEN` | 안 보임 | 폐업·회수·비공개. 다시 올리려면 1단계부터 |

### 제안 (`place_suggestions.status`)

`SUBMITTED` → `REVIEWING` / `NEEDS_INFO` → `APPROVED` / `REJECTED` / `DUPLICATE`

`APPROVED`여도 장소는 `DRAFT`다. 공개는 5단계다.

### 검수 작업 (`place_review_work_items`)

| 단계 | 화면 이름 |
|---|---|
| 1 `SOURCE_REVIEW` | 원천 검수 |
| 2 `NAVER_VERIFICATION` | NAVER 검증 |
| 3 `CATEGORY_CONFIRMATION` | 카테고리 확정 |
| 4 `DUPLICATE_REVIEW` | 중복 검토 |
| 5 `FINAL_APPROVAL` | 승인·공개 |

원천 종류: `PUBLIC_DATA` · `PLACE_SUGGESTION` · `CATEGORY_RECALL` · `LIVENESS_RECHECK`. 작업 상태: `ACTIVE` · `ON_HOLD` · `COMPLETED` · `EXCLUDED`.

서버가 앞 단계를 건너뛰지 못하게 한다. NAVER 성공은 `places.status`를 바꾸지 않는다.

---

## 3. 유저 버전 — 장소 제안

경로: 로그인 메뉴 **장소 제안** → `/suggestions/new`. 내역은 `/me/suggestions`.

### 조건

1. 로그인
2. 이메일 인증 (`EMAIL_VERIFICATION_REQUIRED`)
3. 광주·전남 주소·좌표 (`LOCATION_OUT_OF_SCOPE`)
4. 지도에서 위치 확인 (`LOCATION_REQUIRED`)
5. 활성 세부 카테고리
6. 비슷한 장소가 있으면 **별도 장소인 이유** (`DUPLICATE_CONFIRMATION_REQUIRED`)

비회원은 제안할 수 없다. 게스트는 맵만 본다.

### 유저가 하는 순서

```text
가입·이메일 인증
  → /suggestions/new
  → 상호·주소·카테고리·(선택) 전화·설명
  → 지도에서 위치 확정
  → 중복이면 이유 작성
  → 제출 → SUBMITTED
  → /me/suggestions에서 상태·관리자 답 확인
```

이 시점에 손님 리스트에는 안 나온다.

### 관리자가 제안에 하는 일 (아직 공개 아님)

`/admin/place-operations`에서 주소·좌표·카테고리·중복을 본다. 좌표가 없으면 관리자가 넣은 뒤 **초안 승인**.

초안 승인 결과:

- `place_suggestions` → `APPROVED`
- `places` 한 행 → **`DRAFT`**
- 검수 작업 1개 → 원천 `PLACE_SUGGESTION`, **1단계**

그다음부터는 아래 관리자 5단계와 같다.

거절·중복 판정은 제안만 닫는다. 공개 장소를 만들지 않는다.

---

## 4. 관리자 버전 — 카탈로그 허용

화면: `/admin/place-operations` · 흐름 `review` · 단계 `step=1…5`.

### 대기열로 들어오는 것 (허용이 아님)

| 유입 | 시작 |
|---|---|
| 공공데이터 동기화 (`/admin/data-sync`, 예약) | 후보. 1단계 `PUBLIC_DATA` |
| 회원 제안 초안 승인 | `DRAFT` + 1단계 `PLACE_SUGGESTION` |
| CSV `/admin/import` | 기본 `DRAFT`. 컬럼 `status`를 비우면 DRAFT |
| 카테고리 회수·영업 회수 | `HIDDEN` + 1단계 `CATEGORY_RECALL` / `LIVENESS_RECHECK` |

### 5단계 (여기가 등록)

```text
1 원천    광주전남·좌표·영업·음식점·원천 근거. 비음식·유흥은 제외
       ↓
2 NAVER   상호·주소·위치. 한 곳씩. 한도 광주/전남 각 1만/일
       ↓
3 카테고리 말단 업종 확정. 광역만 있으면 세부로 자동 지정하지 않음
       ↓
4 중복    다른 가게 / 병합 / 원천 연결 / 보류. 열린 중복이면 5단계 금지
       ↓
5 공개    관리자가 고른 ACTIVE 5단계 항목만 PUBLISHED
```

5단계 조건(코드): 단계가 `FINAL_APPROVAL`, 카테고리 있음, 중복 결정 완료, 관리자 선택. 공공데이터 후보는 이때 장소 행을 만들고 `PUBLISHED`. 기존 `DRAFT`/`HIDDEN`은 상태를 `PUBLISHED`로 바꾼다. 감사 액션 `PLACE_REVIEW_PUBLISH`.

요청당 작업 상한은 코드 `REVIEW_BATCH_MAX`(50). **카탈로그 전체를 한 번에 여는 동작이 아니다.** 라이브 NAVER는 표본 1–3곳, 한 곳씩([NAVER 런북](./naver-local-category-runbook.md)). 일괄 공개·615곳 지오코딩은 하지 않는다.

### 1→4 조건부 이동 스위치

wrangler var `REVIEW_CONFIDENT_ADVANCE_ENABLED`. 새 binding이 아니다.

- `"true"`: 저장된 근거가 있는 항목만 5단계 **대기**까지. `publishReviewedPlaces` 호출 없음. 이 버튼은 NAVER를 부르지 않음
- `"false"`: 한 건 체인(S2)과 버튼 **근거 있는 항목만 다음 단계**(S3) 모두 추가 이동 0. 기존 수동 한 칸은 그대로
- 5단계 공개 버튼과 분리. cron에 검수 이동을 붙이지 않음

운영 wrangler 기본값은 `"true"`다. 끄려면 var를 `"false"`로 되돌린 뒤 재배포한다. 이 문서만으로 라이브 Worker를 바꾸지 않는다.

### CSV 옆문

CSV에 `PUBLISHED`를 적으면 5단계를 안 거치고 상태가 올라갈 수 있다. 기본값은 `DRAFT`다. 운영 D1에 week1 시드를 넣지 않는다. 초기 소수 공개는 이 경로이거나 예전에 관리자가 공개한 값일 수 있다. 새 카탈로그는 5단계로만 연다.

---

## 5. 유저가 등록이 아닌 일로 하는 것

| 경로 | 무엇인가 |
|---|---|
| `/corrections/new` | 정정·이전·휴업·폐업·권리. 로그인 없이 가능. 이메일 확인 후 관리자 큐 |
| 상세 투표·저장 | 로그인 후 취향. 장소 추가 아님 |
| `/onboarding/taste` | 취향 칩. 카탈로그 아님 |

관리자의 공개 **후** 탭(영업 재검증, 정정 적용, 병합, 복원)도 등록이 아니다. 회수된 공개 장소는 다시 1단계부터다.

---

## 6. 하면 안 되는 일

- 유저 제안 승인만으로 손님 리스트에 올리기
- NAVER 통과만으로 공개
- `/admin/candidates` 일괄 25곳으로 등록 (레거시 리다이렉트)
- 전역 한도 상향을 등록 근거로 쓰기
- 좌표 없는 항목 일괄 지오코딩
- 운영 D1에 QA 시드

---

## 7. 지금 큐

공개 리스트의 `PUBLISHED`만 “허용된 POI”다. 1–4단계 ACTIVE는 아직 등록이 아니다. 그 줄을 사람이 줄이는 일은 Clock H이며 이 문서 범위가 아니다.

1→4를 근거가 있을 때만 옮기고 공개는 사람으로 남기는 안은 [`docs/superpowers/plans/2026-08-23-confident-review-advance.md`](../superpowers/plans/2026-08-23-confident-review-advance.md). S1 게이트·S2 한 건 체인·S3 버튼은 코드에 있다. wrangler 스위치 `"true"`. 5단계 자동 `PUBLISHED`는 원래 목적 밖이다.
