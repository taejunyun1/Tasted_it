# 2026-08-17 관리자(Admin) 오딧

작성일 2026-08-17 · Issue [#160](https://github.com/taejunyun1/Tasted_it/issues/160) · 담당 Jay (`jay_admin_audit`) · 위임: TJ(Codex) 토큰 소진

보고 배경: 운영 관리자 화면이 오류투성이이고, 배포 후에도 화면이 같아 보이며 Worker 무료 티어 가능성이 언급됨.

---

## 1. 기준선, 범위, 제외

| 항목 | 값 |
|---|---|
| 코드 SSOT | `origin/main` `92ad073` (2026-08-17 로컬 fast-forward 완료) |
| 라이브 익명 실측 | `https://retaste-beta.retaste-beta.workers.dev` — 홈 200, `/admin/place-operations`·`/admin/audit` 302→로그인, `/admin` 404 |
| 확인 시각 | 2026-08-17 12:48–13:00 KST |

**포함:** `/admin/*` 라우트, 검수 파이프라인, 권한, 감사 기록, 관리자 E2E, 배포·무료 티어 정합성.

**오딧 당시(오전) 미실시:** 원격 D1 쓰기, 비밀값 열람, 배포 실행, 로그인된 운영 세션 재현, NAVER 실호출, TJ 잔여 이슈 닫기. 당시 이 머신 wrangler는 가정 계정 `a58fbe3a0082c49f571d69d08c1227ab`와 개인 계정 `f43d6ae07d0d75a6d9ca80befae153eb` 쪽으로 해석되어 운영 목록을 읽지 못했다.

**2026-08-17 정정:** 운영자 OAuth와 owner 로그인은 같은 결론이다. 보이는 운영 계정은 `7543330c65069ee2df1b7b353fb0201c`(owner 계정)뿐이며, Worker `retaste-beta`와 D1 `retaste-production`(`5181489d-83a7-4f78-9384-db096cadaa2d`)을 소유한다. 가정 계정 `a58fbe3a…`와 개인 계정 `f43d6ae0…`는 쓰기 대상이 아니다. 계정 확인은 더 이상 차단 조건이 아니다. 원격 `d1 migrations list`는 대기 없음. `origin/main` `5c4285f` Worker 배포는 Jay 채팅 승인 후 실행됐다. 로그인 관리자 QA(#161)·NAVER 실호출(#163)은 여전히 미실시. 계획은 [`docs/superpowers/plans/2026-08-17-admin-audit-followup.md`](../superpowers/plans/2026-08-17-admin-audit-followup.md)다.

증거 등급: **[확인]** 파일을 열거나 익명 HTTP를 측정함 · **[추론]** 확인된 사실에서 규칙으로 도출 · **[가설]** 운영 로그인·대시보드 없이 단정하지 않음.

---

## 2. Executive verdict

# HOLD

관리자 **권한 가드 자체는 살아 있다.** 익명 요청은 로그인으로 보내지고, 확인한 admin loader/action은 모두 `requireAdmin`을 탄다. HOLD는 “권한 구멍이 있다”가 아니라 **운영자가 쓰는 화면이 깨졌거나 사라졌고, 배포·스키마·무료 티어를 이 자리에서 증명할 수 없다**는 뜻이다.

TJ가 말한 세 줄과 코드가 맞물리는 지점:

1. **“똑같은데”** — 공개 홈은 이미 `home-curation`이 떠 있어 최근 프론트가 올라가 있다. 관리자 기본 링크만 눌러서는 공개 화면이 거의 안 바뀐다. [확인]
2. **“Worker 무료 티어라서 그런가”** — Free plan은 요청당 CPU 10ms. 검수 목록·운영 대시보드·통합 감사는 다중 D1 조인/집계라 1102(`Worker exceeded resource limits`)가 나기 쉽다. 공개 홈은 상대적으로 가볍다. [확인(한도)] · [추론(운영 재현)]
3. **“admin에서 오류투성이”** — 헤더 ‘어드민’은 `/admin/place-operations`인데, 이 화면은 `place_review_work_items`(migration `0034`)에 의존한다. 원격 미적용이면 기본 입구가 500이다. 적용됐더라도 제안 승인·영업 재검증·병합 UI는 라우트에서 제거되어 서버 함수만 남았다. [확인]

정확한 운영 경계:

| 경계 | 판정 | 근거 |
|---|---|---|
| 코드 권한(비로그인·비관리자) | **GO** | `requireAdmin` 전 라우트 존재, 익명 302 |
| 관리자 일상 운영(제안 승인, 영업 재검증, 병합, 검수) | **NO-GO** | 제안/재검증/병합 라우트 0건, 검수는 스키마·CPU에 취약 |
| 공개 홈 조회 | **관측만** | 200 + curation 마크. 관리자 오류와 별개 |
| 배포·원격 migration 완료 주장 | **정정됨** | 계정 `7543330c…`에서 원격 migration 대기 없음. `origin/main` `5c4285f`를 Worker `retaste-beta`에 배포함(버전 `194a3423-7964-4c58-98d5-0f2d0d822d0d`). 라이브 홈 200 |

---

## 3. 핵심 결함

우선순위(P0=운영 차단)와 심각도는 별개다. 직접 우회·대량 유출 증거가 없으면 Critical을 쓰지 않는다.

### P0 — 관리자 운영 차단

| ID | 결함 | 심각도 | 근거 | 상태 |
|---|---|---|---|---|
| ADM-IA-01 | 장소 제안 승인·반려 UI가 라우트에서 사라짐. `approvePlaceSuggestion`은 테스트만 호출 | High | `app/routes/` grep 0건 vs `place-suggestion.server.ts:68-141`. `0034` backfill은 이미 `CREATE_FROM_SUGGESTION`인 DRAFT만 큐에 넣음 | 확인 |
| ADM-IA-02 | 영업 재검증·중복 병합·정정 적용 화면이 검수 파이프라인 통합 과정에서 제거됨 | High | `app/routes/`에 `mergePlaces`/`applyPlaceLiveness`/`approvePlaceSuggestion` 호출 0건. E2E는 옛 탭을 그대로 기대 | 확인 |
| ADM-OPS-01 | 기본 어드민 입구가 `0034` 테이블에 의존. 원격 migration 미적용 시 500 | High | `admin-place-operations.tsx:41-43`, `drizzle/0034_place_review_pipeline.sql`. 2026-08-17 원격 `migrations list`: 대기 없음 → 미적용 가설 기각. 코드 의존은 유지 | 확인(의존) · 원격 대기 없음 |
| ADM-OPS-02 | Workers Free 10ms CPU. 관리자 무거운 loader가 1102로 보일 수 있음 | High | 공식 한도 10ms. `place-review-query.server.ts:88-132` 3단 조인, `dashboard.server.ts:7-19` 창 3×질의 7, `record-audit.server.ts:51-93` 병렬 9 | 확인(한도·쿼리) · 추론(운영 1102) |

### P1 — 운영 직후 반드시

| ID | 결함 | 심각도 | 근거 | 상태 |
|---|---|---|---|---|
| ADM-AUTH-01 | 로그인 `returnTo`가 `/places`만 허용. 세션 만료 후 관리자 URL로 와도 홈으로 떨어짐 | Medium | `login.ts:17-19`, `login-return-to.test.ts:6-8` | 확인 |
| ADM-ERR-01 | 검수 action 중 NAVER·자동제외만 try/catch. 카테고리·공개·단계이동 예외는 전역 500 | Medium | `admin-place-operations.tsx:76-158` vs `place-review-publication.server.ts:60-76` throw | 확인 |
| ADM-ERR-02 | 403·잘못된 intent가 모두 “잠시 길을 잃었습니다” | Medium | `guards.server.ts:8-10`, `root.tsx:48`, `admin-place-operations.tsx:158` | 확인 |
| ADM-IA-03 | 관리자 셸/내비 없음. 헤더는 검수만 가리킴. 감사·리뷰어·평가·운영·가져오기·동기화는 고아 경로 | Medium | `root.tsx:34`. `/admin` 404 [라이브] | 확인 |
| ADM-OBS-01 | 운영 대시보드가 레거시 `APPROVE_CANDIDATE`/`REJECT_CANDIDATE`만 집계. 파이프라인은 `PLACE_REVIEW_*` | Medium | `dashboard.server.ts:11-12` vs `place-review-publication.server.ts:84` | 확인 |
| ADM-TEST-01 | E2E가 삭제된 IA를 단언. 파이프라인 happy path E2E 없음 | High | `place-operations.spec.ts:32-50`, `admin-place-liveness.spec.ts:3-17`. `admin-candidate-review.spec.ts` 삭제됨 | 확인 |

### P2 — 정리

| ID | 결함 | 심각도 | 근거 | 상태 |
|---|---|---|---|---|
| ADM-SEC-01 | same-origin 검사는 검수 POST만. 리뷰어·평가·운영·가져오기·동기화는 없음 | Medium | `isSameOriginMutation` 사용처 `admin-place-operations.tsx:59` 1곳 | 확인 |
| ADM-UX-01 | `/admin/places` 빈 상태·`#main`·페이지네이션 없음. primary 카테고리 없는 장소는 목록에서 사라짐 | Low | `admin-places.tsx:17`, `place.server.ts:37-53` innerJoin | 확인 |
| ADM-UX-02 | `/admin/data-sync` 입력 zod 없음, 실패 피드백 없음, 성공 시 검수로 redirect | Medium | `admin-data-sync.tsx:10-19` | 확인 |
| ADM-AUD-01 | `/admin/audit`의 `sourceCommit`이 `"runtime-unversioned"` 고정 | Low | `admin-audit.tsx:10-12` | 확인 |
| ADM-OPS-03 | 배포 주체와 계정 SSOT 부재로 보이던 항목 | Medium | 오딧 당시 가정 계정 `a58fbe3a…`는 API 10000/7403. 정정: OAuth와 owner 로그인 모두 계정 `7543330c65069ee2df1b7b353fb0201c`만 보이며 이 계정이 라이브 Worker/D1 소유. 개인 계정 `f43d6ae0…`는 쓰기 대상 아님 | 해소 |
| ADM-OPS-04 | cron 5작업을 `Promise.all`로 동시 실행. Free 10ms면 야간 배치도 실패하기 쉬움 | Medium | `workers/app.ts:17-24` | 확인(구조) · 추론(실패) |

---

## 4. 현재 관리자 표면

| 경로 | 역할 | 가드 | 비고 |
|---|---|---|---|
| `/admin` | 없음 | — | 라이브 404 |
| `/admin/place-operations` | 5단계 검수 파이프라인 | `requireAdmin` + same-origin | 헤더 기본 입구 |
| `/admin/candidates`, `/admin/candidates/bulk` | 레거시 redirect | `requireAdmin` 후 1단계로 | 승인 우회 화면 없음 |
| `/admin/places` | 장소 테이블 | `requireAdmin` | 상한 없음, empty 없음 |
| `/admin/import` | CSV | `requireAdmin` | |
| `/admin/data-sync` | 공공데이터 | `requireAdmin` | 검증·오류 UI 없음 |
| `/admin/reviewers` | 리뷰어 | `requireAdmin` | 인라인 오류 있음 |
| `/admin/ratings` | 평가 운영 | `requireAdmin` | 잘못된 intent → 400 화면 |
| `/admin/operations` | 운영 현황 | `requireAdmin` | 레거시 승인 카운트 |
| `/admin/audit` | 통합 기록 감사 | `requireAdmin` | 읽기 전용, 커밋 미표기 |

권한 누락 라우트는 위 10개 중 **0건**. [확인]

---

## 5. 배포·무료 티어

익명 실측:

- 홈 200, HTML에 `home-curation` 다수 → 8월 15일 전후 프론트는 올라가 있음.
- `/admin/audit`가 로그인으로 302 → 통합 감사 라우트도 배포된 코드에 있음.
- `/admin/place-operations`도 라우트는 존재(세션 검사까지 도달). **테이블 존재 여부는 로그인 뒤에만 판정 가능.**

오딧 당시에는 가정 계정 `a58fbe3a…`와 개인 계정 `f43d6ae0…` 쪽으로 보여 배포 버전과 `0034`를 읽지 못했다. 2026-08-17 정정: 운영 계정은 `7543330c65069ee2df1b7b353fb0201c`이며 `wrangler.jsonc` D1 `5181489d-83a7-4f78-9384-db096cadaa2d`와 일치한다. 원격 migration은 대기 없음. 같은 날 `origin/main` `5c4285f`를 `retaste-beta`에 배포했고 라이브 홈은 200이다.

Workers Free 공식 한도(2026): 요청 10만/일, CPU 10ms, subrequest 50. 초과 시 Error 1102. Paid는 기본 30초. 관리자 오류가 공개 홈과 달리 난다면 이 한도가 1순위 가설이다. 확정하려면 Cloudflare Metrics의 `exceededCpu`와 로그인된 검수 화면 재현이 필요하다.

---

## 6. 이전 오딧 대비

2026-08-07 풀 오딧의 관리자 항목:

| 당시 | 2026-08-17 |
|---|---|
| DOC-02 감사 조회 화면 없음 | `/admin/audit` 존재. 커밋 식별은 비어 있음 |
| UX-10 skip-link `#main` 누락 4곳 | 검수·감사·평가·운영은 `#main` 있음. `admin-places`·`admin-data-sync`는 없음 |
| ARC-07 도메인 에러 500 | 자동제외·NAVER만 화면 오류. 나머지 검수 mutation은 여전 |
| 후보 검수 화면 | 파이프라인으로 통합. 제안/재검증/병합은 같이 사라짐 |

열린 이슈 6개(#113·#115·#118·#124·#128·#144)는 담당 Codex이며, 대응 PR이 이미 병합된 잔여 티켓이다. 이 오딧에서 닫거나 재사용하지 않는다.

---

## 7. 권고 순서

1. **운영 계정 `7543330c…`는 확인됨.** 원격 D1 migration은 대기 없음. 추가 apply는 하지 않는다. 이후 배포는 이 계정만 대상으로 한다. 가정 계정 `a58fbe3a…`와 개인 계정 `f43d6ae0…`에는 쓰지 않는다.
2. **Workers Paid 여부**를 확인한다. Free면 관리자 1102를 코드만으로 고치기 어렵다. 검수 loader를 단계별 질의로 쪼개도 10ms는 빠듯하다.
3. **제안 승인 UI를 검수 1단계 또는 전용 탭으로 복구**한다. 서버 함수는 있다. 라우트만 없다.
4. 영업 재검증·병합을 검수 파이프라인에 명시적으로 넣거나, 없다고 제품 결정을 남긴다. 지금처럼 서버만 남기면 운영이 멈춘다.
5. E2E를 현재 IA에 맞추고, 검수 5단계 중 최소 1개 happy path를 추가한다.
6. `safeReturnTo`에 `/admin/*`를 ADMIN 세션에 한해 허용한다.
7. 검수 action 전 intent에 화면 오류 반환을 적용한다.

---

## 8. 이 오딧 본편에서 실행하지 않은 것 — 후속 플랜에 포함

아래는 더 이상 범위 밖이 아니다. [`2026-08-17-admin-audit-followup.md`](../superpowers/plans/2026-08-17-admin-audit-followup.md)와 이슈에 넣었고, TJ 컨펌(`GO`) 전에 실행하지 않는다.

| 항목 | 이슈 | 단계 |
|---|---|---|
| 관리자 로그인 후 라이브 클릭 재현 | [#161](https://github.com/taejunyun1/Tasted_it/issues/161) | 0 |
| 원격 D1 행 수·migration 목록 | [#162](https://github.com/taejunyun1/Tasted_it/issues/162) | 0 |
| NAVER 실호출 | [#163](https://github.com/taejunyun1/Tasted_it/issues/163) | 0 |
| 코드/테스트 수정, 커밋 | [#164](https://github.com/taejunyun1/Tasted_it/issues/164) [#165](https://github.com/taejunyun1/Tasted_it/issues/165) [#167](https://github.com/taejunyun1/Tasted_it/issues/167) | 1–3 |
| 배포 | [#166](https://github.com/taejunyun1/Tasted_it/issues/166) | 2 |
| TJ 잔여 이슈 정리 | [#168](https://github.com/taejunyun1/Tasted_it/issues/168) | 4 |
