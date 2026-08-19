# 2026-08-18 300명 합성 테스트 시나리오

> **상태:** `PROPOSED` — 시나리오 카탈로그다. 하네스 재작성, 라이브 실행, 일괄 공개, 공개 베타 GO, `k6`를 승인하지 않는다.

**Goal:** 테스터 200 + 뷰어 100이 **구현된 제품 경로로** 가입·탐색·이용·기여·관찰까지 가려면 어떤 여정을 어떤 기대 결과로 돌릴지 고정한다.

**추적:** [#208](https://github.com/taejunyun1/Tasted_it/issues/208) · [PR #209](https://github.com/taejunyun1/Tasted_it/pull/209)

**선행:** [#206](https://github.com/taejunyun1/Tasted_it/issues/206) · [PR #207](https://github.com/taejunyun1/Tasted_it/pull/207) 격리 슬라이스 하네스. 그 런은 시드 세션·공개 2곳·제안 `SUBMITTED` 정지였다. 이 문서는 그 빈칸을 시나리오로 채운다.

`#206` 믹스(게스트 120·투표 50·제안 16·경계 10)는 슬라이스 한도이다. 이 카탈로그는 같은 300명을 **풀 여정**으로 다시 나눈다. `#207` 하네스를 바꾸지 않는다.

**거버넌스:** [`docs/decisions/2026-08-10-tech-stack-governance.md`](../../decisions/2026-08-10-tech-stack-governance.md) — 새 테스트 프레임워크·binding 없음.

**담당:** Jay (`deximple`)

---

## 0. 이 문서가 하는 일 / 안 하는 일

하는 일: 페르소나, 인원, 스텝, 통과/실패, 게이트, 테스트 더블을 적는다.

안 하는 일: 스크립트 구현, 라이브 300 가입, 운영 D1 쓰기, NAVER/Resend 실호출, 카탈로그 일괄 공개.

실행은 이 문서가 `ACCEPTED`/`GO`로 바뀌고 하네스 PR이 별도로 병합된 뒤에만 한다.

## 1. 규모와 픽스처 모드

| 항목 | 값 |
|---|---|
| 인구 | 테스터 **200** + 뷰어 **100** = **300**. 동시 CCU 300이 아니다. |
| 환경 | 격리 D1만. 라이브 Worker·`retaste-production` 금지. |
| 한도 복제 | 가입 IP 시간당 10, 로그인 IP 15분당 20, NAVER 일일 20,000(스텁). |
| 소통 | DM·댓글·팔로우 없음. 투표·Flavor·추천만 공개로 전달. |

픽스처는 두 모드다. 시나리오마다 어느 모드인지 적는다.

- **Sparse:** 공개 장소 2곳. 라이브와 같은 희소 카탈로그. 취향 그래프는 `LEARNING`이 정상.
- **Journey:** 격리 전용 합성 공개 장소 충분히(최소 Flavor 공개 5곳 + 제안 승인 여정용 초안). 라이브 상호 복사 금지. 일괄 공개 아님. 시나리오가 요구하는 곳만 운영자가 공개.

Google/네이버 로그인 실 IdP는 합성 대상이 아니다. 이메일 가입만 다룬다.

## 2. 인원 배분 (테스터 200)

| ID | 페르소나 | 인원 | 하는 일 |
|---|---|---:|---|
| P-VIEW | 뷰어 | 100 | GET만. 테스터와 겹쳐 점수·Print·추천을 관찰. |
| P-GUEST | 게스트 탐색 | 50 | 계정 없이 공개 화면. 온보딩 완료/스킵 안 함. |
| P-MEMBER | 회원 이용 | 70 | 가입(더블)→인증→온보딩→투표·저장→`/me`. |
| P-CONTRIB | 기여자 | 24 | 주소·핀 확인 후 제안. 운영자 초안 승인까지 이어지는 소수. |
| P-FIX | 정정 | 6 | 공개 장소 정보 정정 요청. |
| P-REVIEW | 리뷰어 지망 | 10 | 승인 제안 <10이면 apply 거절. 게이트를 보여 줌. |
| P-EDGE | 경계 | 20 | 14세, 미인증 제안, 범위 밖, 중복, 탈퇴, 한도 429. |
| P-OP | 운영자 | 1 (300 밖) | 제안 초안 승인, 검수 5단계, 선택 공개. 일괄 공개 금지. |

테스터 합 50+70+24+6+10+20 = 200. 뷰어 100은 테스터가 아니다.

가입 HTTP를 70명 모두에게 쓰지 않는다. 한 IP면 시간당 10에서 멈춘다.

- 분산 IP 또는 메일 더블로 **대표 가입 여정**만 HTTP (P-MEMBER 중 10, P-EDGE 한도).
- 나머지 회원은 격리 D1에 사전 인증 계정. 여정은 로그인 이후부터 실제 라우트.

## 3. 공통 규칙

1. 합성 이메일 `synth+NNN@example.test`. 상호·좌표·토큰을 로그/위키에 쓰지 않는다.
2. 테스터마다 합성 IP. 한도 시나리오만 IP 공유.
3. 뷰어는 POST/PUT/PATCH/DELETE 없음. `/onboarding/taste` 완료·스킵 없음.
4. 제안 승인은 `DRAFT`다. 지도 공개는 `FINAL_APPROVAL` 선택 공개 후에만.
5. 리뷰어는 제출 전 타인 개별 Flavor를 보면 안 된다.
6. 실패가 통과인 경우(429, 400, 403)를 시나리오에 명시한다.

## 4. 시나리오 카탈로그

각 시나리오: 목적 → 스텝 → 기대 → 모드 → 더블.

### 4.1 뷰어 (100)

**S-V1 공개 관찰** · P-VIEW 100 · Sparse 또는 Journey

1. GET `/`, `/places`, 공개 상세 2+, `/maps/:categorySlug`, `/reviewers/:slug`, `/resources/home-recommendations`, `/privacy`, `/terms`.
2. 투표·저장·가입·제안 버튼을 누르지 않는다.

기대: 5xx 0. 로그인 CTA는 보여도 POST 0. `current_votes` / `place_suggestions` insert 0.

**S-V2 간접 소통 관측** · P-VIEW 100, P-MEMBER 웨이브와 동시 · Sparse

1. 투표 웨이브 전: 두 장소 추천 표본 수 기록 (상호 없이 표본만).
2. P-MEMBER가 투표하는 동안 같은 상세를 다시 GET.
3. Flavor Print `LEARNING`/`VISIBLE`와 `ratingCount` 기록.

기대: 표본이 공개 임계(8)를 넘으면 뷰어 화면에 숫자가 바뀐다. Print는 리뷰어 3건이면 `VISIBLE`.

### 4.2 게스트 (50)

**S-G1 비회원 탐색** · P-GUEST 50 · Sparse

1. 홈 → `/places` (온보딩 302 아님, `#194`) → 상세 2곳 → 카테고리 지도.
2. `/courses` 빈/희소 상태 확인.
3. 온보딩 화면을 열어도 완료·스킵 POST를 하지 않는다.

기대: 200. 핀 2개. 추천 슬롯이 비거나 짧아도 5xx 아님.

**S-G2 로그인 유도** · P-GUEST 10 (G1 부분집합)

1. 상세에서 추천을 시도하면 로그인으로 보낸다.

기대: 비회원 투표 insert 0.

### 4.3 회원 이용 (70)

**S-M1 가입·인증 루프** · P-MEMBER 70명 중 HTTP 가입 10명(나머지는 사전 인증 시드) · Journey · 메일 더블

1. `/signup` 만 14세 확인 + 유효 입력.
2. 인증 메일은 발송 더블. 토큰으로 `/verify-email`.
3. `/login` 후 홈.

기대: `emailVerifiedAt` 설정. Resend 실호출 없음. 같은 IP 11번째는 S-E5.

**S-M2 온보딩 완료** · P-MEMBER 50 (S-M1 HTTP 10명 포함) · Sparse

1. 로그인 후 `/onboarding/taste`: 위치 → 음식 → 스타일 → 미리보기 → 완료.
2. 미리보기는 공개 2곳만 나올 수 있다.

기대: `ONBOARDING_COMPLETED`. 미리보기 0~2곳이면 실패가 아니라 희소 관측.

**S-M3 온보딩 스킵** · P-MEMBER 20 · Sparse

1. 온보딩 스킵 후 `/places`.

기대: `ONBOARDING_SKIPPED`. 목록 200.

**S-M4 투표·철회·저장** · P-MEMBER 70 · Sparse

1. 장소 A 추천. 같은 장소 비추천으로 변경. 철회.
2. 장소 B 저장 후 저장 해제 가능.
3. `/me`에 현재 투표·저장만 맞는지.

기대: `(userId, placeId)` 현재 투표 최대 1. `vote_events`는 append. 철회 후 현재 투표 없음. 5xx 0.

**S-M5 추천 믹스** · S-M4 이후 · Sparse

1. `/resources/home-recommendations`를 투표 전후 비교 (뷰어 S-V2와 짝).

기대: 에러 없이 응답. 2곳이면 슬롯이 짧아도 됨.

**S-M6 취향 그래프** · P-MEMBER 70 · Sparse vs Journey

- Sparse: `/me` 취향 그래프 `LEARNING` (공개 Flavor 장소 <5). **통과.**
- Journey: Flavor 공개 장소 5곳 이상에 추천을 남기면 `VISIBLE` 가능.

### 4.4 기여자 (24)

**S-C1 제안 풀 스텝** · P-CONTRIB 20 · Sparse · 지오코딩 더블

1. 인증 회원. `/suggestions/new`.
2. 광주·전남 주소 검색 → 후보 선택 → 핀 확정(origin 2km 안) → 카테고리 → 비공개 접수.
3. `/me/suggestions`가 `SUBMITTED`.

기대: `places` 행 없음. 지도에 안 나옴. 지오코딩 실호출 없음.

**S-C2 운영자 초안 승인** · P-CONTRIB 4 + P-OP · Sparse

1. S-C1 제안 4건을 관리자가 지도 확인·사유 후 승인.
2. `places` `DRAFT` + work item `SOURCE_REVIEW`.
3. 뷰어가 그 slug를 GET하면 공개 목록에 없음.

기대: 제안 `APPROVED`. 공개 지도 불변.

**S-C3 선택 공개 (소수)** · P-OP · Journey

1. S-C2 초안 1~2건만 5단계: `SOURCE_REVIEW` → `NAVER_VERIFICATION`(스텁) → `CATEGORY_CONFIRMATION` → `DUPLICATE_REVIEW` → `FINAL_APPROVAL` → 선택 공개.
2. 뷰어가 새 공개 상세 GET 200.

기대: 공개 +1 또는 +2. 나머지 제안은 `SUBMITTED`/`DRAFT` 유지. 일괄 공개 없음.

### 4.5 정정 (6)

**S-F1 정정 요청** · P-FIX 6 · Sparse

1. `/corrections/new`에 공개 장소 대상, 관계·유형, 변경.
2. 메일 더블로 검증 링크. `/corrections/verify`.

기대: 검증 전 반영 없음. 관리자 적용 전 공개 필드 불변.

### 4.6 리뷰어 지망 (10)

**S-R1 게이트 미달** · P-REVIEW 10 · Sparse

1. 승인 제안 0~9인 회원이 `/reviewer/apply`.

기대: `REVIEWER_REQUIREMENT_NOT_MET`. 프로필 생성 없음.

**S-R2 교차 조회 금지** · 시드 리뷰어 3 · Sparse

1. 리뷰어 A가 평가 화면에서 B의 미제출 값을 읽으려 함.

기대: 403 또는 값 미노출. 제출 후 집계(Print)만 공개.

**S-R3 Flavor 공개** · 시드 리뷰어 3 · Sparse

1. 장소당 Flavor 3건.
2. 뷰어 상세 Print `VISIBLE`, `ratingCount` ≥ 3.

기대: 회원 투표와 독립. 리뷰어 대량 신청 없음.

### 4.7 경계 (20)

**S-E1 14세 미확인** · 5 · 가입 폼 age 체크 없음 → 400.

**S-E2 미인증 제안** · 3 · `EMAIL_VERIFICATION_REQUIRED`. 제안 insert 0.

**S-E3 범위 밖 주소** · 4 · 서울 등 → `LOCATION_OUT_OF_SCOPE` 400.

**S-E4 중복 제안** · 2 · 기존 공개와 유사·100m 안, 사유 없으면 `DUPLICATE_CONFIRMATION_REQUIRED`. 사유 있으면 `SUBMITTED` + duplicate OPEN.

**S-E5 한도** · 4 시퀀스 · 동일 IP 가입 11번째 429, 로그인 21번째 429, 이메일 가입 4번째 429, 이메일 로그인 9번째 429. **통과 조건.**

**S-E6 탈퇴** · 2 · `/me` 탈퇴 문구 확인 → 세션 무효, 이메일 익명화, 투표 이벤트 보존.

### 4.8 운영자 (1, 300 밖)

**S-O1 검수 큐** · 제안 초안만 처리. 공공데이터 615 지오코딩·25곳 일괄 없음.

**S-O2 감사** · `APPROVE_PLACE_SUGGESTION` / `PLACE_REVIEW_PUBLISH` 로그. 본문에 상호·PII 없음.

## 5. 간접 소통 매트릭스

| 생산 | 소비 | 시나리오 |
|---|---|---|
| 회원 투표 | 뷰어 상세 점수 | S-M4 + S-V2 |
| 리뷰어 Flavor 3 | 뷰어 Print | S-R3 + S-V1 |
| 선택 공개 | 뷰어 새 상세 | S-C3 + S-V1 |
| 회원 추천 | 홈 믹스 | S-M5 + S-V2 |
| 리뷰어 미제출 값 | 다른 리뷰어 | 보이면 실패 (S-R2) |
| 제안 SUBMITTED | 다른 회원 지도 | 보이면 실패 (S-C1) |

## 6. 커버하지 않는 여정

- Google/네이버 OAuth 실계정
- 리뷰어 사진 업로드 100명 (별도 kill switch)
- 관리자 200명
- 두 번째 도시, `regions` 테이블
- 라이브 메일·지도·로컬검색 실호출
- Stage 1 300 CCU / `k6`

## 7. 후속 하네스에 넘길 것

이 문서 `GO` 후 별도 PR:

1. 시나리오 ID를 테스트 이름으로 1:1.
2. 메일·지오코딩·NAVER 검수는 더블. 실호출 없음.
3. Playwright는 시나리오당 1~2 대표. 300 브라우저 금지.
4. 대량은 기존 Vitest workers + `fetch`. `k6` 없음.
5. 결과는 시나리오 ID별 pass/fail. 상호·PII 없음.

`#207` 슬라이스 하네스를 이 카탈로그로 바꾸기 전에는 풀 이용 완료를 주장하지 않는다.

페르소나 에이전트 랩 결과와 다음 진입점(E1 하네스 / E2 랩 preview / E3 1M)은 [`2026-08-19-persona-lab-entry.md`](./2026-08-19-persona-lab-entry.md)에 둔다. 랩은 이 카탈로그를 대체하지 않는다.

## 8. 시나리오 ID 색인

| ID | 페르소나 | 인원 | 모드 | 핵심 기대 |
|---|---|---:|---|---|
| S-V1 | 뷰어 | 100 | Sparse/Journey | GET 200, POST 0 |
| S-V2 | 뷰어 | 100 | Sparse | 투표 웨이브 후 공개 점수 변화 |
| S-G1 | 게스트 | 50 | Sparse | `/places` 200, 온보딩 강제 없음 |
| S-G2 | 게스트 | 10 | Sparse | 비회원 투표 insert 0 |
| S-M1 | 회원 | 10 HTTP | Journey | 가입→인증(더블)→로그인 |
| S-M2 | 회원 | 50 | Sparse | `ONBOARDING_COMPLETED` |
| S-M3 | 회원 | 20 | Sparse | `ONBOARDING_SKIPPED` |
| S-M4 | 회원 | 70 | Sparse | 투표 1개 불변식, 저장, `/me` |
| S-M5 | 회원 | 70 | Sparse | 홈 추천 응답 |
| S-M6 | 회원 | 70 | Sparse/Journey | Sparse=`LEARNING` 통과 |
| S-C1 | 기여자 | 20 | Sparse | `SUBMITTED`, `places` 없음 |
| S-C2 | 기여자+운영 | 4 | Sparse | `DRAFT`만, 지도 불변 |
| S-C3 | 운영 | 1~2곳 | Journey | 선택 공개만 |
| S-F1 | 정정 | 6 | Sparse | 검증 전 공개 필드 불변 |
| S-R1 | 리뷰어 지망 | 10 | Sparse | `REVIEWER_REQUIREMENT_NOT_MET` |
| S-R2 | 시드 리뷰어 | 3 | Sparse | 교차 조회 거부 |
| S-R3 | 시드 리뷰어 | 3 | Sparse | Print `VISIBLE` |
| S-E1 | 경계 | 5 | Sparse | 14세 미확인 400 |
| S-E2 | 경계 | 3 | Sparse | 미인증 제안 차단 |
| S-E3 | 경계 | 4 | Sparse | `LOCATION_OUT_OF_SCOPE` |
| S-E4 | 경계 | 2 | Sparse | 중복 확인/사유 |
| S-E5 | 경계 | 4 seq | Sparse | 가입/로그인 429가 통과 |
| S-E6 | 경계 | 2 | Sparse | 탈퇴 익명화 |
| S-O1 | 운영 | 1 | Sparse | 큐만, 일괄 공개 없음 |
| S-O2 | 운영 | 1 | Sparse | 감사 로그에 PII 없음 |

---

# 2026-08-18 Synthetic 300-person scenario catalog

> **Status:** `PROPOSED`. Scenario catalog only. Does not authorize harness rewrite, live execution, mass publish, public-beta GO, or `k6`.

**Population:** 200 testers + 100 viewers. Not 300 concurrent CCU.

**Fixture modes:** Sparse (2 published places, live-shaped) and Journey (isolated extra synthetic publishes only as required).

**Viewers:** GET-only. Testers cover signup (doubled), onboarding, vote/save, suggest, correction, reviewer-gate, abuse 429s. Admin is outside the 300.

**Out of scope:** live writes, real NAVER/Resend, OAuth IdP, second city.

Implementation requires a later PR that marks this document `GO` and maps each `S-*` id to an isolated test. Persona-lab pickup is [`2026-08-19-persona-lab-entry.md`](./2026-08-19-persona-lab-entry.md).

**Tracking:** [#208](https://github.com/taejunyun1/Tasted_it/issues/208) · [PR #209](https://github.com/taejunyun1/Tasted_it/pull/209)
