# 2026-08-22 잔여 작업 전수와 시간 단위 실행 플랜

> **상태:** `PROPOSED` — 잔여 작업 목록과 실행 순서의 채택이다. 이 PR 병합은 배포 완료, 일괄 공개, 두 번째 도시, 결제, `k6`, 새 binding, 라이브 NAVER 일괄을 승인하지 않는다.
>
> 배포 실행은 이미 병합된 [#218](https://github.com/taejunyun1/Tasted_it/pull/218) 본문의 rollout 범위다. 실행 완료는 별도 기록 PR에 적는다.

**Goal:** `origin/main`과 라이브·위키·문서가 어긋난 지점을 한 번에 고정하고, 남은 일을 **주 단위가 아니라 시간 단위**로 실행 가능하게 만든다.

**코드 기준선:** `origin/main` [`7389537`](https://github.com/taejunyun1/Tasted_it/commit/7389537) (PR [#218](https://github.com/taejunyun1/Tasted_it/pull/218), 2026-08-22 08:09 KST 병합)

**라이브 기준선 (문서):** Worker `retaste-beta` version `3115d0dc-673c-40c1-b08d-62811c772f8b` · 배포 SHA [`f42e53a`](https://github.com/taejunyun1/Tasted_it/commit/f42e53a) (`#215`/`#217`, 2026-08-20). 원격 D1 최신 기록명 `0035`.

**라이브 재실측 (2026-08-22, 익명 GET):** `/` 200, `/places` **200**(온보딩 302 아님, 공개 카드 **4**), `/robots.txt` 앱 규칙, `/sitemap.xml` 200, `/privacy` DRAFT. `/admin` 인덱스 404. `#218` 카테고리 근거 문구는 이 실측에서 Worker SHA로 확인하지 않음.

**담당:** Jay (`deximple`) · **배포 실행:** 지정 운영자 · **소유자 결정:** TJ (`taejunyun1`)

**추적:** [#219](https://github.com/taejunyun1/Tasted_it/issues/219)

**선행:** 지역 팩 제약 `GO` ([#179](https://github.com/taejunyun1/Tasted_it/pull/179)) · 고도화 방법 `GO` ([#183](https://github.com/taejunyun1/Tasted_it/pull/183)) · 오딧 하드닝 `#190`–`#196` · NAVER 노매치 `#215` · 카테고리 근거 v2 `#218`

**거버넌스:** [`docs/decisions/2026-08-10-tech-stack-governance.md`](../../decisions/2026-08-10-tech-stack-governance.md) — 상태 `PROPOSED`. 이 문서는 스택 예외를 열지 않는다.

---

## 0. 한 줄

코드는 초대 HOLD를 해제했다. `main` HEAD는 `#218`이다. 라이브 기록은 `#215`다. 공개 베타는 카탈로그·법적 주체·`main` 보호로 **NO-GO**. 다음 일은 기능을 늘리는 것이 아니라 **라이브를 HEAD에 맞추고, 검수 큐를 사람이 줄이고, 남은 P1을 한 PR씩 닫는 것**이다.

열린 이슈는 이 문서를 열기 전 **0개**, 열린 PR **0개**였다. 위키 스냅샷은 2026-08-20 `6a1c5ea`로 **2일·2커밋** 뒤처져 있었다.

---

## 1. 지금 연결된 상태

| 면 | 값 | 근거 |
|---|---|---|
| 저장소 | Private. 비로그인 404. Jay write | `#182`/`#200` |
| `origin/main` | `7389537` `#218` | git fetch 2026-08-22 |
| 로컬 `main` | 이 작업 시작 시 `origin/main`으로 ff | 작업 전 1커밋 behind |
| 열린 이슈 / PR | 이 이슈 전까지 0 / 0 | `gh` |
| 최신 CI `main` | success, `#218` push | Actions |
| 원격 feature 브랜치 | `origin/main`만 | `git branch -r` |
| 위키 Features API | `has_wiki: false`. wiki.git는 인증 clone 가능 | `#200` |
| `main` 보호 | 없음. Free+Private ruleset 403 | `#200` |
| 공개 론칭 시장 | 광주전남만. 팩 2개(`GWANGJU`/`JEONNAM`) | `region-pack.ts` |
| 킬 스위치 (운영 설정) | NAVER 검색·지오코딩 `true`. 사진·v5·코스 v2 `false` | `wrangler.jsonc` |
| 카탈로그 (08-18 D1) | PUBLISHED **2** / HIDDEN 646 / DRAFT 2 · ACTIVE 755 | 재오딧 |
| 카탈로그 (08-22 익명 `/places`) | 공개 카드 **4** | 라이브 GET. D1 재집계는 이 문서에서 하지 않음 |
| 처리량 표본 | 14일 공개 2 · 7일 공개/일 0.29 | `#196` |
| 원격 migration | `0035` 적용 기록 | `#204`/`#217` |

---

## 2. 다시 열지 말 것 (코드에 이미 있다)

| 항목 | 코드 | 라이브 |
|---|---|---|
| E2E 운영 D1 id 분리 (슬라이스 1) | `wrangler.e2e.jsonc` placeholder · `#190` | 해당 없음 |
| 검수 처리량 화면 (슬라이스 2) | `/admin/operations` · `#196` | `#204` 이후 |
| 지역별 NAVER 예산 (슬라이스 3) | 팩 10k+10k · `0035` · `#202` | `#204` apply |
| 로그인 한도·더미 KDF | `consumeLoginRateLimit` | 배포 후 창 행이 생겨야 함 |
| 토큰 `#` 링크, GET 미소비 | `token-link.ts` | 배포 후 |
| `/me` 탈퇴 익명화 | `withdrawAccount` | 배포 후 |
| `/places` 온보딩 강제 제거 | `place-list.tsx` loader | 08-22 라이브 **200** |
| robots / sitemap / 홈·상세 OG | 라우트 존재 | 08-22 라이브 **200** |
| 보안 헤더 4종 (CSP/HSTS 제외) | `security-headers.ts` | 08-22에 SHA 미확인 |
| 노매치 확인필요·수동 근거 | `#215` | `#217` 배포 |
| NAVER 세부/광역 근거 분리 | `#218` | **미배포로 본다** |
| 게스트 맵·리스트·상세 열람 | 로그인 없이 GET | 라이브 `/places` 200 |
| 제안 승인·영업 재검증·병합 탭 | `#173`/`#175` | 관리자 경로 |
| x-algorithm 1단계 (순서 불변) | eligibility + action values | 결과 순서 변경 없음 |
| 합성 200 하네스 파일 | Vitest + 스크립트 + opt-in Playwright | 라이브 실행 없음 |
| Private 전환 | 실행됨 | 소유자 |

`docs/superpowers/plans/2026-08-22-naver-category-evidence-v2.md`의 체크박스가 비어 있어도 **재구현하지 않는다.** 코드는 `#218`이다.

---

## 3. 시간 단위 시계

한 칸은 **한 사람 집중 시간**이다. 검수 큐를 줄이는 운영 시간은 엔지니어링 시계와 분리한다. 한 PR에 시계를 섞지 않는다. 새 브랜치는 항상 최신 `origin/main`에서 `jay_<작업>`으로 만든다.

### 시계 A — 정합과 배포 (H00–H04) · 지금

| 시간 | 일 | 산출 | 하지 않는 일 |
|---|---|---|---|
| **H00–H01** | 이 플랜·이슈 `#219` | 이 문서 | 제품 코드 |
| **H01–H02** | 변경 이력 SSOT에 `#218` · 위키 4페이지 | 스냅샷 SHA `7389537` | 새 위키 페이지 |
| **H02–H03** | `7389537` 운영 배포 (`#218` rollout) | Worker version · 홈 200 · `/admin` 302 | 원격 migration · 일괄 NAVER · 일괄 공개 |
| **H03–H04** | 배포 결과 기록 PR | rollback 직전 version `3115d0dc-…` | 비밀값·상호·주소 |

성공: 라이브 SHA = `7389537`. 검수 카드에 `NAVER 세부 업종 추천` / `NAVER 광역 업종만 확인`이 신규 검증부터 보인다. 기존 카테고리는 일괄 변경하지 않는다.

`#218` 본문이 이미 “병합 후 main에서 배포”를 적었으므로 **새 배포 승인 PR은 필요 없다.** 실행 후 기록 PR만 연다 (`#217` 패턴).

**실행 (2026-08-22):** 시계 C–F가 먼저 `main`에 병합된 뒤 HEAD [`fdf45d8`](https://github.com/taejunyun1/Tasted_it/commit/fdf45d8)(`#235`)를 배포했다. Worker `7579b600-7302-443b-9753-a4a5aaa3dd05`. rollback `b2268318-3473-4661-8598-e0560a7d1396`. 기록 [#236](https://github.com/taejunyun1/Tasted_it/issues/236). 원격 apply·일괄 NAVER·일괄 공개 없음.

---

### 시계 B — 사람 확인 (H04–H06) · 배포와 독립 가능

| 시간 | 일 | 산출 |
|---|---|---|
| **H04–H06** | localhost `http://127.0.0.1:5173`에서 게스트 맵·`/places`·상세·온보딩 URL 직접 진입 | 재현된 것만 이슈. 랩 n200 숫자를 GO로 올리지 않음 |

가설 (재현 전 이슈 금지): 공개 맵은 가입 없이 본다. 긴 온보딩을 맵 앞에 두지 않는다. 타인 투표만으로 가입을 설득하지 않는다.

**실행 (2026-08-23):** 로컬 D1 week1+홈 큐레이션 QA 시드, `pnpm dev --host 127.0.0.1`. 비로그인 데스크톱 1280과 모바일 390. 세 가설은 **구멍으로 재현되지 않음.** 랩 숫자는 GO로 올리지 않음. 기록 [#240](https://github.com/taejunyun1/Tasted_it/issues/240). 라이브·운영 D1·NAVER 실호출 없음.

---

### 시계 C — 값싼 코드 PR (H06–H16) · 배포 뒤 또는 병행

각 행 = PR 1개. 합 **10h**.

| 시간 | PR | 파일 힌트 | 성공 |
|---|---|---|---|
| **H06–H08** | `/admin` → `/admin/place-operations` 인덱스 | `app/routes.ts` | `/admin` 404 해제. 새 대시보드 아님 |
| **H08–H09** | 관리자 이메일 화면 제거 · 검수 `attention`에 NAVER 미확인 | `admin-places.tsx` · `place-review-query.server.ts` | SEC-18-03 · 2단계 `미확인`이 필터에 탐 |
| **H09–H11** | `slugPrefix` 가상 팩 테스트 (슬라이스 6) | `tests/unit/region-pack.test.ts` | 공개 slug 불변. 리다이렉트 루프 없음 |
| **H11–H14** | 헤더/가입 `returnTo` · 로그인·가입 필드 유지 · 공개 `meta()` 제목 | `root.tsx` · `signup.tsx` · `login.tsx` | UX-01 잔여 · UX-02 부분 |
| **H14–H16** | 대비 `#78827b`/`#6d786f` · 시트 `prefers-reduced-motion` · 홈 `h1` 1개 | `app.css` · `home.tsx` | UX-08 · UX-14 · UX-18-01 |

---

### 시계 D — 보안 P1 (H16–H28)

| 시간 | PR | 메모 |
|---|---|---|
| **H16–H24** | CSP + HSTS + `geolocation=()` | `security-headers.ts`. 루트는 jsDelivr SUIT + Google Fonts + NAVER Maps. 깨지면 nonce/allowlist만. 새 폰트 패키지 없음 |
| **H24–H28** | 회원 POST same-origin | 투표/저장/제안/정정/온보딩/리뷰어/로그아웃. 관리자 액션은 이미 있음 |

Playwright CI 스모크는 **H44–H52**. CSP와 한 PR에 넣지 않는다.

---

### 시계 E — 점수 정합 (H28–H44) · 제품 P0

공개 목록은 `currentVotes` 합, 상세는 `getLatestRatingSnapshot`이다 (`place.server.ts` vs `place-detail.tsx`). 카탈로그가 작아도 숫자가 어긋나면 신뢰가 깨진다.

| 시간 | 일 |
|---|---|
| **H28–H36** | 목록·지도를 최신 `isStale=false` 스냅샷으로. 없으면 명시적 폴백 카피 |
| **H36–H40** | 같은 값 재투표 no-op (`CHANGE` 남발 중지) |
| **H40–H44** | 재import 시 이전 primary 해제 (ARC-03) |

geo 인덱스는 이 시계에 **넣지 않는다.** 측정 증거가 없다.

---

### 시계 F — CI 스모크 (H44–H52)

| 시간 | 일 |
|---|---|
| **H44–H45** | CI에 `pnpm run build` |
| **H45–H52** | Playwright **스모크만** (`release.spec.ts` + 홈/`/places` 1개). 로컬 `wrangler.e2e.jsonc`. 20파일×2 프로젝트를 required로 올리지 않음 |

커버리지 패키지·80% 게이트는 거버넌스 예외 없이 추가하지 않는다.

---

### 시계 G — 문서 드리프트 (H52–H56)

| 시간 | 일 |
|---|---|
| **H52–H54** | NAVER 런북을 지역 10k + `/admin/place-operations`로. 전역 20000·`/admin/candidates` 배치 25 문구 삭제 |
| **H54–H55** | 배포 런북 `SESSION_SECRET` / `pnpm deploy` 정합 |
| **H55–H56** | week1 런북 `--remote` 시드 지시 제거 |

**실행:** [#238](https://github.com/taejunyun1/Tasted_it/issues/238). cron `limit: 25`와 env `20000` 선언은 코드 변경 없이 운영 문구만 고친다.

---

### 시계 H — 검수 운영 (엔지니어링 시계 밖)

코드로 755건을 줄이지 않는다. 일괄 공개·615 지오코딩·한도 상향·요청당 NAVER 일괄은 **하지 않는다.**

| 일 | 추정 | 규칙 |
|---|---|---|
| 2단계 ACTIVE (~35, NO_MATCH+미확인) | 운영 **2–6h** | 수동 근거 20자 또는 표본 1–3회. `#217` 패턴 |
| 1단계 ACTIVE (~708) | 운영 **수십 시간** | 좌표 없는 항목은 보류/제외. 지오코딩 일괄 없음 |
| 2주 처리량 재표본 | 기록 **1h** + 대기 14일 | `#196` 화면. 새 테이블 없음 |
| 광주전남 “이 정도면 된다” (슬라이스 4) | 문서 **2h** | 공개 수·카테고리 커버·홈 5칸 채움. 카탈로그가 4곳이면 아직 쓰지 않음 |

Free Worker 10ms 셸 로더는 Paid라 **급하지 않다** (4–8h, 보류).

---

### 시계 I — GO 후에만 (지금은 열지 않음)

| 항목 | 상태 | GO 뒤 시간 |
|---|---|---|
| 합성 200 격리 **실행 보고** | 하네스는 있음. 플랜 `PROPOSED` | **2–4h** |
| 합성 300 카탈로그 → HTTP 하네스 (E1) | `PROPOSED` | **16–24h** |
| 맵 뒤 짧은 취향 칩 (4단계 온보딩 아님) | 랩 `PROPOSED` | **4–6h** |
| `/me` 닉네임·비밀번호·Naver 연결 버튼 | 스펙 잔여 | **4–8h** (이메일 변경은 migration) |
| 장소 OG 이름·canonical·JSON-LD·sitemap 공개 slug | 부분 | **4–6h** |
| 시트 포커스 트랩 (새 의존성 없이) | 미착수 | **4–6h** |
| PBKDF2 210k + 재해시 | 스펙 vs 99,999 | **4–8h** |
| 로그인 오류 문구 단일화 (SEC-10) | 열림 | **2–3h** |

코스 v2·카테고리 v5 공개 적용·사진 업로드 `true`·Kakao `HIDE`는 **별도 activate PR**. 플래그 기본값은 유지한다. 영업시간 관리자 입력 없이 코스 v2를 켜면 전부 `UNKNOWN` 감점이다 (선행 **12–20h**).

---

## 4. 소유자 대기 (코드로 닫히지 않음)

| 항목 | 누구 | 시간 |
|---|---|---|
| 운영자 성명·연락처·개인정보 문의 | TJ | 사람 결정. 페이지 반영 **1–2h** |
| Cloudflare 국외 이전 문구 | TJ + 방침 | 페이지 반영 **1h** |
| `main` 보호 | TJ | Free+Private에서 불가. (b) 신뢰 또는 (c) Team/Pro |
| 위키 Features 재활성 | TJ | Jay PATCH 404 |
| 법적 주체 (개인/법인) | TJ | 공개 베타·매출 전 |
| 브랜드 Re:Taste vs `Tasted : IT` | TJ | 문서 정합 **2h** |

---

## 5. 하면 안 되는 일

| 금지 | 이유 |
|---|---|
| 두 번째 도시·제주 팩 | 지역 팩 게이트 미닫힘 |
| `regions` 테이블, 세 번째 bbox, 접두 없는 `동구` | `#179` |
| 기존 cron `Promise.all`에 6번째 작업 | 거버넌스 §5.2. 지금 5개 |
| KV / Queues / Durable Object / 검색 엔진 / 벡터 DB | 거버넌스 HOLD |
| `k6`, 100–300 CCU 인증, soak | Stage 1 `PROPOSED / HOLD`. `#207`이 k6를 대체하지 않는다 |
| 결제·캠페인 스키마·업주 포털 | BM `PROPOSED`. 첫 SKU도 코드 결제 아님 |
| 일괄 공개, `week1-places.csv`를 PUBLISHED로 import, 615 지오코딩 | D-13 |
| NAVER 일일 한도 상향, 요청당 일괄 실호출 | `#217` 표본만 |
| `places` geo 인덱스 | 병목 측정 전 |
| 적용된 migration `0031` 두 파일 재작성 | MIG-18-01. 새 순번만 |
| 랩 러너·Hugging Face·MatrAIx를 이 저장소에 | `#211` |
| `Archive/*`에서 새 브랜치, `main` 직접 push | `AGENTS.md` |

---

## 6. 고도화 슬라이스 판정 (2026-08-22)

| 슬라이스 | 코드 | 게이트 |
|---|---|---|
| 1 E2E D1 id | 끝 `#190` | 닫힘 |
| 2 처리량 숫자 | 화면 끝 `#196` | 큐를 줄이는 **운영**은 열림 |
| 3 지역 NAVER 예산 | 코드 끝 `#202` · 라이브 `#204` | 팩 kill은 상수. UI 토글 없음. `region_code IS NULL`이 양쪽에 잡힘(선택 수정 2h) |
| 4 큐레이션 품질 기록 | 없음 | 카탈로그 밀도 후 |
| 5 geo 인덱스 | 하지 말 것 | 측정 전 |
| 6 `slugPrefix` 테스트 | 부분 | H09–H11 |

광주전남 완료 게이트는 **열려 있다.** 제주 이슈를 지금 열지 않는다.

---

## 7. 추천 다음 네 칸 (이 문서 병합 직후)

1. **H02–H04** `7389537` 배포 + 기록.
2. **H04–H06** localhost 게스트 재현. 재현된 구멍만 이슈.
3. **H06–H08** `/admin` 인덱스. 독립 PR.
4. 검수 2단계 미확인/노매치를 사람이 줄인다. 코드 지름길 없음.

그 다음 값싼 코드는 시계 C, 보안은 D, 점수 정합은 E. Stage 1 CCU·결제는 시계에 넣지 않는다.

---

## 8. 이 문서가 승인하는 것 / 아닌 것

| 행동 | 이 PR 병합 |
|---|---|
| 잔여 목록과 시간 순서 채택 | 예 |
| `#218` 배포 실행 | 아니오. `#218`이 이미 승인. 실행은 운영자 |
| 시계 C–F 구현 | 아니오. 각 전용 이슈·PR |
| 시계 I | 아니오. 별도 `GO` |
| 위키 스냅샷 갱신 | 예. 진행 기록만 |

Rollback: 이 PR은 문서만 되돌리면 된다.

---

# 2026-08-22 Remaining-work inventory and hour-unit plan

> **Status:** `PROPOSED`. Merging this PR adopts the inventory and order. It does not complete a deploy, mass-publish places, add a second city, payments, `k6`, new bindings, or bulk live NAVER.

**Baseline:** `origin/main` `7389537` (#218). Last **recorded** live Worker: `3115d0dc-…` on `f42e53a` (#215/#217). Anonymous live GET on 2026-08-22: `/places` 200 with **4** public cards (not the 08-18 D1 count of 2). `#218` category-evidence copy is **not** proven on the live Worker SHA.

**One line:** Invite-HOLD is cleared in code. Public beta is still **NO-GO** (catalog, legal contact, `main` protection). Next work is deploy HEAD, drain the review queue by hand, and close leftover P1s one PR at a time — in **hours**, not weeks.

**Clock A (H00–H04):** this plan, history/wiki snapshot, deploy `7389537` (already authorized by #218), record Worker version. **Executed 2026-08-22** as HEAD `fdf45d8` after clocks C–F landed. Worker `7579b600-7302-443b-9753-a4a5aaa3dd05`. Record #236.

**Clock B (H04–H06):** human localhost guest repro of persona hypotheses. Do not promote lab numbers. **Executed 2026-08-23.** Three hypotheses not reproduced as holes. Record #240.

**Clock C (H06–H16):** cheap PRs — `/admin` index, hide admin email, `attention` includes unverified NAVER, `slugPrefix` fake-pack tests, `returnTo`/form persist/`meta()`, contrast + reduced-motion + single `h1`.

**Clock D (H16–H28):** CSP+HSTS; same-origin on member POSTs.

**Clock E (H28–H44):** list/map scores from rating snapshots; same-value vote no-op; primary-category reimport.

**Clock F (H44–H52):** CI `build` + Playwright **smoke only**.

**Clock G (H52–H56):** runbook drift. **Issue #238** — docs only; no redeploy or live NAVER.

**Clock H:** operator drain of ~35 stage-2 and ~708 stage-1 items. No bulk publish/geocode.

**Clock I:** only after explicit GO — synthetic-200 run report, E1 300 harness, short post-map taste, `/me` settings, richer OG, focus trap, PBKDF2 raise.

**Owner-blocked:** legal contact, Cloudflare transfer clause, `main` protection, wiki Features, legal entity, brand string.

**Do not start:** second city, extra cron in the existing `Promise.all`, KV/Queues/DO, k6/CCU, payments, mass publish, geo index, rewriting applied `0031` files, lab runners in this repo.
