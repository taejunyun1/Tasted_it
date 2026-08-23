# 검수 1→4 조건부 자동 이동 플랜

> **상태:** `PROPOSED` — 목록과 금지선을 채택한다. 이 문서 병합은 구현, 배포, 라이브 NAVER, 5단계 공개를 승인하지 않는다.
>
> **추적:** [#244](https://github.com/taejunyun1/Tasted_it/issues/244) · [PR #245](https://github.com/taejunyun1/Tasted_it/pull/245)
>
> **원래 목적:** 손님 리스트는 관리자가 **고른** `PUBLISHED`만. 유저 제안·공공데이터는 대기열. NAVER 통과만으로 공개하지 않는다. ([POI 등록 절차](../../operations/poi-registration.md), [파이프라인 설계](../specs/2026-08-15-place-review-pipeline-design.md))

**Goal:** 관리자가 같은 판단을 반복하지 않게, **이미 근거가 있는 항목만** 1→4를 다음 단계로 옮긴다. 5단계 대기 칸에 모은다. 리스트에 올리는 클릭은 사람으로 남긴다.

---

## 0. 한 줄

자동화는 **통과 도장**이지 **입점 허가**가 아니다. 입점(5단계 `PUBLISHED`)은 지금과 같이 관리자가 고른 항목만.

---

## 1. 원래 목적 (이 플랜이 지키면 되는 것)

| 지켜야 할 것 | 근거 |
|---|---|
| 공개는 5단계에서 선택 | `publishReviewedPlaces`, 설계 §5 |
| NAVER 성공 ≠ 공개 | `evaluateReviewAdvance`는 2→3만, status 불변 |
| 광역 업종으로 세부 카테고리 자동 지정 금지 | `#218` |
| 라이브 NAVER는 한 곳씩, 지역 1만 | `MAX_NAVER_REVIEW_BATCH_SIZE = 1`, 런북 |
| 일괄 공개·일괄 지오코딩 없음 | Clock H, POI 문서 |
| 기존 cron `Promise.all`에 6번째 잡 없음 | 거버넌스 §5.2 |
| 새 Queue / DO / 패키지 / binding 없음 | 거버넌스 HOLD |

벗어나면 이 플랜이 아니다: 유저 제안 즉시 공개, 노매치 통과, 프랜차이즈 자동 병합, 좌표 없는 곳 지오코딩 후 공개.

---

## 2. 이미 있는 것 (다시 만들지 않음)

- 게이트: `evaluateReviewAdvance` (`place-review-pipeline.ts`)
- 이동: `advancePlaceReviewWorkItems` (관리자 `actorUserId`, 감사 로그)
- 비음식 제외: `autoExcludeNonFoodReviewItems`
- NAVER 1건: `verifyReviewItemsWithNaver` — `VERIFIED`면 말단 `mappedCategoryId`를 비어 있을 때 넣고 2→3 시도
- 예약 동기화 뒤 후보 NAVER `limit: 25`는 **검수 단계 이동이 아님**. 운영 절차로 쓰지 않음. 이 플랜도 그 경로를 확장하지 않음

없는 것: “근거만 보고 여러 단계를 이어서 옮기되, 공개는 하지 않는” 실행기와 그 단위 테스트.

---

## 3. 자신 있음 / 멈춤

한 항목에 대해 **현재 단계만** 보고, 아래를 모두 만족하면 다음 단계. 아니면 그 자리에 남김. 공개 호출 없음.

### 1 원천 → 2

자신 있음:

- `sourceReady`: 주소·좌표 있음. 공공데이터면 `OPEN`
- 활성 제외 없음
- 비음식 자동 제외 대상 아님 (그 경우는 지금처럼 `EXCLUDED`)

멈춤: 좌표 없음, 지역 밖, 원천 미준비.

**NAVER를 이 이동에서 호출하지 않음.**

### 2 NAVER → 3

자신 있음:

- 공공데이터: `naver_local_category_verifications.status = VERIFIED`
- 장소 작업: `place_liveness_states.naverStatus = MATCHED`
- 세부(말단) 카테고리 매핑이 있음. 광역만이면 `#218`대로 멈춤

멈춤: `NO_MATCH` / `NOT_FOUND` / `AMBIGUOUS` / `FAILED` / 광역만. 수동 근거 20자는 **사람이 쓴 뒤에만** 통과. 자동으로 사유를 만들지 않음.

**이 칸에서 새 NAVER 호출을 돌리지 않음.** 호출은 지금 UI의 한 곳씩만. 호출이 `VERIFIED`+말단이면 그 한 건은 이어서 3까지 가도 된다 (이미 일부 있음).

### 3 카테고리 → 4

자신 있음:

- `selectedCategoryId`가 있고 `categories.isActive`
- 그 ID가 말단(부모 있는 세부). 관리자가 고른 값이거나 NAVER 말단 매핑

멈춤: 비어 있음, 비활성, 광역만 추천.

자동으로 다른 세부 업종을 찍지 않음.

### 4 중복 → 5 (대기)

자신 있음: `openDuplicateCount === 0`

멈춤: 열린 중복. 병합/다른 가게/원천 연결은 사람. 프랜차이즈 동명 자동 병합 없음.

도착지는 `FINAL_APPROVAL` **대기**. `publishReviewedPlaces` 호출 없음.

### 5 공개

**이 플랜 밖.** 자동화 0. 화면 카피도 “자동 공개”로 바꾸지 않음.

---

## 4. 실행 방식 (구현이 열려도)

우선순위는 호출·공개를 늘리지 않는 쪽.

| 방식 | 쓰는가 | 이유 |
|---|---|---|
| A. 관리자 액션 **한 건**이 성공한 뒤, 같은 항목만 게이트를 끝까지(5 직전) | 1순위 | 새 cron·새 NAVER 없음. 행위자는 그 관리자 |
| B. 관리자 버튼 “근거 있는 항목만 다음 단계” — **NAVER 호출 없음**, 이미 저장된 근거만, 요청당 상한 `REVIEW_BATCH_MAX` | 2순위 | Clock H를 공개 없이 줄이는 보조. 끌 수 있는 플래그 |
| C. 기존 일일 cron에 검수 이동/NAVER 추가 | **안 함** | 거버넌스. 운영 런북이 그 25를 절차로 쓰지 않음 |
| D. 5단계 자동 `PUBLISHED` | **안 함** | 원래 목적 이탈 |

킬 스위치(구현 PR이 열리면): `REVIEW_CONFIDENT_ADVANCE_ENABLED` 기본 `false`. `false`면 A/B 모두 no-op. 새 binding 아님. wrangler vars.

감사: `lastTransitionBy` = 클릭한 ADMIN. 시스템 유저 행을 만들지 않음.

---

## 5. 구현 슬라이스 (이 문서 다음, 각기 전용 PR)

이 플랜 병합만으로는 슬라이스를 시작하지 않는다. 각 슬라이스는 이슈+테스트 먼저.

| ID | 내용 | 성공 | 하지 않음 |
|---|---|---|---|
| S0 | 이 플랜 | `PROPOSED` 채택 | 코드 |
| S1 | 순수 함수 `confidentAdvanceAllowed(stage, evidence)` + 단위 테스트 | 광역·노매치·중복 열림·5단계는 false | NAVER, D1 쓰기 |
| S2 | 한 건 액션 뒤 같은 항목 체인 (A) | VERIFIED+말단이면 5 대기까지. PUBLISHED 수 불변 | 다른 항목, 새 호출 |
| S3 | 버튼 B + 킬 스위치 기본 off | off면 이동 0. on이어도 publish 0, NAVER 0 | cron |
| S4 | 검수 화면에 “자동으로 5단계 대기 N건 / 공개 0” | 카운트만. 공개 버튼과 분리 | 자동 공개 카피 |

예상 집중 시간: S1 2h, S2 3–4h, S3 3–4h, S4 2h. Clock H 사람 큐와 섞지 않음.

테스트: 로컬 D1 + mock NAVER. 라이브 NAVER·운영 공개 없음. 커버하는 실패: 광역 업종, 노매치, 열린 중복, 5단계 항목에 체인 호출, 스위치 off.

---

## 6. 이 문서가 승인하는 것 / 아닌 것

| 행동 | 이 PR 병합 |
|---|---|
| 금지선·슬라이스 순서 채택 | 예 (`PROPOSED`) |
| S1–S4 구현 | 아니오. 각 전용 이슈·PR |
| 5단계 자동 공개 | 아니오 |
| 라이브 NAVER·원격 D1·배포 | 아니오 |
| Clock H 큐를 코드로 비우기 | 아니오 |

Rollback: 문서 revert.

---

# 2026-08-23 Confident review advance (stages 1–4)

> **Status:** `PROPOSED`. Merging adopts the boundary. It does not implement auto-advance, auto-publish, live NAVER, a sixth cron job, queues, or new bindings.

**One line:** Automate **stamps**, not **listing**. Stage 5 `PUBLISHED` stays a human selection.

**Keep:** admin catalog; NAVER success ≠ publish; no broad-category leaf assignment (`#218`); NAVER one item per admin request; no mass publish/geocode; do not append a sixth job to the existing cron `Promise.all`.

**Do:** after an admin action, or via an optional “advance items that already have evidence” button (NAVER=0, publish=0), move a work item through `evaluateReviewAdvance` until `FINAL_APPROVAL`. Stop on no-match, broad category, open duplicates, missing coords.

**Do not:** auto-call NAVER in batch; invent manual-evidence text; auto-merge franchises; publish.

**Next:** dedicated PRs S1 (pure predicate tests) → S2 (same-item chain) → S3 (button + kill switch default false) → S4 (count copy). Kill switch `REVIEW_CONFIDENT_ADVANCE_ENABLED` default `false` only when an implementation PR lists it.
