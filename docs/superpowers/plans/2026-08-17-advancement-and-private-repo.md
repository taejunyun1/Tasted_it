# 2026-08-17 고도화 실행 방법과 저장소 Private 전환 판단

> **상태:** 고도화 **방법**은 `GO`. 저장소 Private 전환은 **`요청하라 — 단, Private만으로는 부족하다`**.
>
> 이 문서는 방법과 판단만 기록한다. 이 PR에서 저장소 공개 범위를 바꾸지 않았고, 배포하지 않았고, 제품 코드를 바꾸지 않았다.

**Goal:** 광주전남 게이트가 남아 있는 상태에서 "다음에 무엇을 어떤 순서로 구현하는가"를 고정하고, 공개 저장소가 실제로 무엇을 노출하는지 증거로 확인해 Private 전환 요청 여부를 결정한다.

**코드 기준선:** `origin/main` `9e47190` (PR [#181](https://github.com/taejunyun1/Tasted_it/pull/181) 병합 직후)

**담당:** Jay · **결정 필요:** TJ(저장소 소유자, `taejunyun1`)

**추적:** [#182](https://github.com/taejunyun1/Tasted_it/issues/182) 저장소 Private 전환 요청(소유자 결정 필요)

**거버넌스:** [`docs/decisions/2026-08-10-tech-stack-governance.md`](../../decisions/2026-08-10-tech-stack-governance.md) — 상태 `PROPOSED`. 이 문서는 스택 예외를 열지 않는다.

**선행 제약:** [`2026-08-17-region-pack-expansion.md`](./2026-08-17-region-pack-expansion.md) `GO`. 두 번째 도시 금지와 지역 팩 제약은 그대로 유효하다.

---

## 0. 요약

| 질문 | 답 |
|---|---|
| 고도화를 어떻게 진행하는가 | 기능을 늘리지 않는다. **광주전남 완료 게이트를 닫는 순서**로 진행한다. 아래 5개 슬라이스. |
| 지금 무엇부터 하는가 | E2E 설정이 운영 D1 `database_id`를 들고 있는 것을 먼저 없앤다. 새 binding 없이 가능하다. |
| Private 전환을 요청해야 하는가 | **요청한다.** 다만 이유는 "비밀값 유출"이 아니라 **사업 문서와 취약점 지도의 노출**이다. |
| Private이면 끝나는가 | 아니다. Private은 무료 secret scanning과 (Free 요금제에서) branch protection을 **잃는다**. 보완 3건을 같이 해야 한다. |

---

## A. 고도화 구현 방법

### A-1. 지금 "고도화"는 기능 추가가 아니다

현재 `origin/main` `9e47190` 기준 사실:

- 열린 이슈 0개, 열린 PR 0개. **추적 가능한 다음 작업이 하나도 없다.**
- [#180](https://github.com/taejunyun1/Tasted_it/pull/180)으로 지역 상수·주소 판정·bbox·구집 키가 `app/features/regions/region-pack.ts` 하나로 모였다.
- 관리자 UI는 [#173](https://github.com/taejunyun1/Tasted_it/pull/173)·[#175](https://github.com/taejunyun1/Tasted_it/pull/175)로 복구됐고 [#161](https://github.com/taejunyun1/Tasted_it/issues/161)·[#163](https://github.com/taejunyun1/Tasted_it/issues/163)은 닫혔다.
- 지역 팩 플랜의 완료 게이트 6줄 중 **4줄이 아직 "숫자가 없다"** 상태다.

따라서 이 단계의 고도화는 다음 뜻이다.

**고도화 = 게이트를 반증 가능하게 만드는 일.** "잘 되고 있다"를 "이 숫자다"로 바꾸는 작업이 우선이다.

| 고도화로 인정 | 고도화가 아님 (지금은) |
|---|---|
| 검수 처리량 측정, 지역별 NAVER 예산, geo 인덱스(측정 후), 큐레이션 품질 기록, E2E 격리, slug 접두 검증 | KV·Queues·Durable Objects·R2 확장, 네이티브 앱, 두 번째 Worker/D1/계정, 새 인증·결제 공급자, 새 UI kit |

오른쪽은 거버넌스 §5.3에서 기본 `HOLD`다. 이 문서는 그것을 바꾸지 않는다.

### A-2. 순서 원칙

지역 팩 게이트를 "매력도"가 아니라 **위험도** 순으로 닫는다.

1. 운영 데이터를 파괴할 수 있는 것을 먼저 없앤다.
2. 반드시 측정해야 하는 것을 측정 가능하게 만든다.
3. 돈이 나가는 쿼터를 지역 단위로 보호한다.
4. 사람의 품질 판단을 기록으로 남긴다.
5. 구조 변경(인덱스 등)은 **측정 결과가 나온 뒤에만** 한다.

### A-3. 다음 슬라이스 (각각 PR 1개로 닫힌다)

#### 슬라이스 1 — E2E 설정에서 운영 `database_id`를 뗀다 (P0)

**문제 (코드 확인):** `wrangler.e2e.jsonc`의 `database_id`가 `wrangler.jsonc`의 운영 값과 **같다**. 현재 `playwright.config.ts`는 `--local --persist-to .wrangler/e2e-state`로만 실행하므로 지금 원격에 쓰지 않는다. 즉 **활성 사고가 아니라 잠재 지뢰**다. `--local` 하나가 빠지거나 누가 그 설정으로 `--remote`를 부르면 그때 운영 D1에 쓴다. README는 "운영 데이터에는 QA fixture를 적용하지 않습니다"라고 적고 있어 문서와 설정이 어긋나 있다.

**방법:** E2E는 로컬 전용이므로 실제 D1 id가 필요 없다. e2e 설정의 `database_id`를 운영과 다른 고정 placeholder로 바꾼다. **새 D1을 만들지 않는다** — 새 binding은 거버넌스 §6에서 ADR + Operations 승인 대상이므로, 예외를 열지 않는 이 경로를 택한다.

**성공 기준**
- `wrangler.e2e.jsonc`에 운영 `database_id`가 없다.
- 두 설정 파일의 `database_id`가 같으면 실패하는 단위 테스트가 있다.
- `pnpm run test:e2e`가 그대로 통과한다.

**범위 밖:** 새 D1 생성, 원격 apply, 배포.

#### 슬라이스 2 — 검수 처리량을 "숫자"로 만든다 (P0)

**문제:** 게이트는 "광주전남에서 **측정된** 일/주 처리량"을 요구한다. [#171](https://github.com/taejunyun1/Tasted_it/issues/171)/[#172](https://github.com/taejunyun1/Tasted_it/pull/172)로 대시보드가 `PLACE_REVIEW_*`를 집계하지만, **대시보드 코드는 측정이 아니다.**

**방법:** 새 테이블을 만들지 않는다. 기존 work item과 감사 기록에서 7일 창의 "발행/일", "대기 큐 길이"를 유도해 관리자 화면 한 곳 또는 런북에 고정 쿼리로 남긴다. 그 뒤 **2주 표본을 병합된 PR에 기록**한다.

**성공 기준**
- 운영자가 한 화면에서 최근 7일 발행 건수/일과 큐 잔량을 본다.
- 2주치 실제 숫자가 PR 본문에 남는다. 개인정보·상호·주소는 남기지 않는다.
- 지역 팩 플랜의 "처리량" 게이트 줄이 "없음"에서 PR 링크로 바뀐다.

#### 슬라이스 3 — NAVER 예산을 지역 단위로 쪼갠다

**문제 (코드 확인):** `getNaverLocalSearchApiCallsToday`는 `naver_local_category_runs.api_call_count`를 **지역 구분 없이 전역 합산**한다. 한도(`NAVER_LOCAL_SEARCH_DAILY_LIMIT`)도 앱 전역 환경 변수 하나다. 도시가 둘이 되면 한쪽이 다른 쪽 쿼터를 굶긴다.

**방법:** 예산을 `region-pack.ts`의 팩 필드로 넣는다(예: 팩별 일일 예산). 카운터를 지역으로 분할하고, 관리자 화면에 지역별 잔량과 지역별 kill switch를 노출한다. 예산을 팩 필드로 두는 것이 핵심이다 — 지역 팩 제약을 지키면서 확장 지점을 한 곳에 유지한다.

**성공 기준**
- 팩 항목 하나를 더해도 예산이 자동으로 분리된다.
- 한 지역이 한도를 소진해도 다른 지역 검수가 계속된다.
- 지역 컬럼 추가가 필요하면 순번 migration 1개로 끝나고 rollback을 PR에 적는다.

**주의:** 컬럼 추가는 거버넌스 §6의 Data/Tech 리뷰 대상이다. 실호출 한도 변경은 별도 승인이다.

#### 슬라이스 4 — 광주전남 큐레이션 품질을 기록으로 확정한다

**문제:** 게이트는 운영자가 "이 정도면 된다"고 한 **기록**을 요구한다. 지금은 없다.

**방법:** 코드가 아니다. 판단 기준(공개 장소 수, 카테고리 커버리지, 영업 재검증 실패율)을 적고 운영자 판단을 PR로 병합한다.

**성공 기준:** 게이트 줄이 병합된 PR 링크를 가리킨다.

#### 슬라이스 5 — geo 인덱스 (슬라이스 2 이후에만)

**문제 (코드 확인):** `places`에는 `places_status_idx`, `places_search_text_idx`뿐이다. bbox 조회에 쓰이는 좌표 인덱스가 없다.

**방법:** **먼저 측정한다.** 현재 행 수에서 bbox 조회의 소요와 스캔량을 기록하고, 그 숫자가 문제를 보일 때만 인덱스 PR을 연다. 지역 팩 플랜과 거버넌스 §4.4가 모두 "측정 뒤 별도 PR"이라고 못 박았다.

**성공 기준:** PR 본문에 before/after 측정이 함께 있다. 측정이 없으면 인덱스를 넣지 않는다.

#### 슬라이스 6 — `slugPrefix`가 실제로 작동하는지 증명한다 (저비용, 언제든)

**문제:** 팩에 `slugPrefix` 필드는 있으나 두 팩 모두 값이 `""`다. 즉 아직 아무것도 검증하지 못한다.

**방법:** 운영 동작을 바꾸지 않는다. `slugPrefix`가 비어 있지 않은 **가상 팩**을 테스트에서만 추가해, slug 생성과 리다이렉트 표가 충돌하지 않음을 고정한다.

**성공 기준:** 테스트만 추가된다. 공개 slug는 그대로다.

### A-4. 실행 순서

```
슬라이스 1 (E2E 격리)
  → 슬라이스 2 (처리량 숫자)
    → 슬라이스 3 (지역별 NAVER 예산)
      → 슬라이스 4 (큐레이션 품질 기록)
        → 슬라이스 5 (geo 인덱스, 슬라이스 2가 병목을 보일 때만)
슬라이스 6 은 위와 독립. 아무 때나.
```

슬라이스 1~4가 끝나면 지역 팩 플랜의 게이트가 닫힌다. **게이트 통과는 전용 PR에 기록하며, 이 문서가 그 통과를 대신하지 않는다.**

### A-5. 지역 팩 제약을 유지하는 법

새 PR마다 아래를 확인한다. 이미 [#179](https://github.com/taejunyun1/Tasted_it/pull/179)의 상시 규칙이며 여기서 강화하지 않는다.

- 새 bbox 상수를 만들지 않는다. `region-pack.ts`를 읽는다.
- 새 `광주%` / `전%` 주소 매처를 만들지 않는다. `addressLikePatterns`를 쓴다.
- 접두 없는 `동구` 집군 id를 만들지 않는다. `districtSet`은 `GWANGJU:동구` 형태다.
- 새 지리·주소 로직은 활성 팩이 하나여도 그 모듈을 거친다.
- 기존 cron `Promise.all`에 작업을 추가하지 않는다.

### A-6. 이슈 → 브랜치 → PR → 위키 사이클

**결론: 사이클은 깨지지 않았다.** 병합 PR 111개, 이슈 66개 종료, 위키 4개 페이지 유지. 바꿀 필요가 없다. 다만 두 가지만 보완한다.

1. **이슈를 먼저 연다.** 지금 열린 이슈가 0개다. 슬라이스는 플랜 문서가 아니라 이슈에서 추적한다. 브랜치는 이슈가 생긴 뒤 최신 `origin/main`에서 만든다.
2. **`main` 직접 push는 GitHub가 막고 있지 않다.** 현재 `main`에 branch protection과 ruleset이 **없다**(확인함). `AGENTS.md` 1번 규칙은 지금 순전히 신뢰에 의존한다. 이 사실은 아래 B 절의 Private 판단과 직접 얽힌다.

### A-7. 시작하지 말아야 할 것

| 하지 않는다 | 근거 |
|---|---|
| 두 번째 도시(제주 포함) | 지역 팩 플랜 게이트 미통과 |
| `regions` CRUD 테이블 | 지역 팩 플랜에서 기각. 지금은 코드 모듈로 충분 |
| 기존 cron `Promise.all`에 작업 추가 | 거버넌스 §5.2. 결합 실패 분리가 먼저 |
| KV·Queues·Durable Objects·검색 엔진·벡터 DB | 거버넌스 §5.3 기본 `HOLD` |
| 네이티브 앱, 새 인증·결제 공급자 | 거버넌스 §5.3 기본 `HOLD` |
| 두 번째 Worker·D1·Cloudflare 계정 | 지역 팩 플랜에서 기각 |

---

## B. 저장소 Private 전환 판단

### B-1. 확인한 현재 상태

| 항목 | 확인 결과 |
|---|---|
| 공개 범위 | `PUBLIC`. 소유자 `taejunyun1`. 2026-08-05 생성 |
| 포크 | 0개 |
| 협업자 | 2명 (`taejunyun1` admin, `deximple` push) |
| 위키 | 활성. **인증 없이 clone 가능** = 공개 |
| Actions | 워크플로 1개(`CI`)만. Codex 잔여 워크플로 없음 |
| CI 안전성 | 액션이 커밋 SHA로 고정. `permissions: contents: read`. `persist-credentials: false`. **워크플로에 secret 참조 0건** |
| Deploy key | 없음 |
| branch protection / ruleset | **없음** |
| Pages | 미사용 |

### B-2. 비밀값은 새지 않았다 (중요)

Private을 "비밀값이 샐까 봐"로 정당화하면 잘못된 근거다. 확인한 사실:

- git 이력 전체에서 `.dev.vars` 계열로 추가된 파일은 `.dev.vars.example` **하나뿐**이고, 그 내용은 전부 placeholder다.
- 추적 파일 전체에 대한 비밀값 패턴 스캔(토큰 접두어, private key 블록, 하드코딩된 키/시크릿 대입) 결과 **일치 0건**.
- `.gitignore`가 `.dev.vars`와 `.dev.vars.*`를 막고 `.dev.vars.example`만 예외로 둔다.
- 실제 비밀값은 Cloudflare Worker secret에 있다.
- 비용이 나가는 NAVER 지역검색 서버 호출은 관리자 경로에서만 시작한다. 브라우저에 내려가는 지도 Client ID는 원래 공개용이며 서비스 URL로 제한된다.

**즉, 소스가 공개라는 사실 자체가 계정·데이터 탈취로 이어지는 경로는 지금 없다.**

### B-3. 그럼에도 공개가 실제로 노출하는 것

Private 전환의 진짜 근거는 비밀값이 아니라 **사업 정보와 취약점 지도**다.

| 노출 | 성격 | 심각도 |
|---|---|---|
| `refer/` 아래 **사업계획서·개발명세서 원본 문서 2건** | 사업 기밀. 경쟁사·투자 맥락에서 가치가 있다 | **높음** |
| `docs/audits/2026-08-14-bm-revenue-altitude-plan.md` — 수익 준비도 자체 평가와 12개월 수익화 순서, B2B 판매 가정 | 사업 기밀 | **높음** |
| `docs/audits/` 및 플랜 문서가 적어 둔 **알려진 약점 목록** (E2E가 운영 D1 id 공유, 관리자 CPU 한계, 지역별 예산 부재, geo 인덱스 부재) | 공격자 정찰 비용을 낮춘다 | 중간 |
| `README.md`의 **비밀값 인벤토리 전체 목록**, kill switch 이름과 현재 값, 일일 NAVER 상한, OAuth 리다이렉트 URI, 운영 Worker URL | 값은 없으나 운영 구조 지도 | 중간 |
| Cloudflare 계정 ID·Worker 이름·D1 이름/ID·R2 bucket 이름·cron 시각 | 식별자. 토큰 없이는 무력하다 | 낮음 |
| `data/week1-places.csv` 20행(상호·주소·전화) | 대부분 공개된 상업 정보지만 운영 시드 데이터 | 낮음 |
| 관리자 화면·로그인 화면 스크린샷 10장 | UI 구조 노출 | 낮음 |
| 전체 소스: 라우트 39개(관리자 10개), migration 36개, D1 스키마, 인증 흐름 | 설계 노출. 인증은 서버에서 강제된다 | 낮음 |

**판단:** 낮음 항목만 있었다면 공개 유지가 합리적이다. 하지만 **사업계획서와 수익화 오딧이 공개 저장소에 그대로 있다.** 이것이 결정적이다. 이 저장소는 오픈소스 목적이 없다 — LICENSE 없음, 포크 0, 외부 기여자 0, 공개로 얻는 이익이 사실상 없다. **얻는 것 없이 사업 기밀을 공개하고 있다.**

### B-4. Private이 고치지 못하는 것

| 항목 | Private 이후 |
|---|---|
| 이미 공개된 12일간의 복제본 | **되돌릴 수 없다.** stargazer 2명이 있었고 clone은 추적되지 않는다. Private은 미래 노출만 막는다 |
| git 이력 속 비밀값 | 해당 없음(없음). 다만 Private은 이력을 지우지 않는다 |
| 운영 공격면 | Worker 공개 URL은 그대로 공개다. Private과 무관 |
| E2E가 운영 D1 id를 들고 있는 위험 | **전혀 안 고쳐진다.** 슬라이스 1이 필요하다 |
| Cursor·클라우드 에이전트·Codex 접근 | 접근 권한 있는 계정으로 인증하므로 그대로 접근한다 |
| 협업자 실수 | 그대로. 협업자 2명 모두 push 권한이 있다 |
| 위키 | 저장소를 따라 비공개가 된다(이건 개선) |
| Preview URL | `wrangler.jsonc`에 `preview_urls: false`로 이미 꺼져 있다 |

### B-5. 비용 — 측정한 값

| 항목 | 영향 | 판단 |
|---|---|---|
| **secret scanning / push protection** | 공개 저장소는 **무료**, 비공개는 GitHub Secret Protection 유료(활성 커미터당 과금) | **실질 손실.** 지금의 "비밀값 무커밋" 규율을 GitHub가 공짜로 받쳐 주고 있는데 그게 사라진다 |
| **branch protection** | GitHub Free에서 보호 브랜치는 **공개 저장소 전용** | 지금 안 쓰고 있으므로 즉시 손실은 없다. 다만 Free + Private에서는 `main` 보호를 **영영 켤 수 없다**. 켜려면 Team 요금제가 필요하다 |
| **Actions 분** | 비공개는 월 2,000분 한도에서 차감. 측정값: 잡 1개, 실행당 약 43초 → 실행당 1분 과금. 12일간 총 115회 ≈ 월 290회 | **문제 없음.** 한도의 약 15% |
| 위키 | Free + Private에서 사용 가능 | 영향 없음 |
| Pages | 미사용 | 영향 없음 |
| 외부 기여자 | 현재 0명 | 영향 없음 |
| Codex 잔여 워크플로 | 없음(워크플로는 `CI` 1개뿐) | 영향 없음 |

### B-6. 판정

> **요청하라. 다만 "Private만으로는 부족하고 이것도 하라"가 정확한 답이다.**

근거를 한 문단으로 정리하면 이렇다. 이 저장소가 공개여서 생기는 실제 위험은 비밀값 유출이 아니다 — 비밀값은 Cloudflare에 있고, 이력·추적 파일 스캔에서 유출 흔적이 0건이며, 돈이 나가는 외부 호출은 관리자 경로에 막혀 있다. 진짜 노출은 **사업계획서와 수익화 오딧, 그리고 우리가 스스로 문서에 적어 둔 약점 목록**이다. 이 저장소는 오픈소스 의도가 없고(LICENSE 없음, 포크 0, 외부 기여 0) 공개로 얻는 이익이 없으므로, 얻는 것 없이 사업 기밀을 내주고 있는 상태다. 전환은 소유자가 클릭 한 번으로 하고 되돌릴 수 있으며 측정된 비용(Actions 월 약 290분, 한도의 15%)은 무시할 만하다. 그래서 **요청은 옳다.** 다만 전환은 두 가지를 잃는다 — 무료 secret scanning과 (Free 요금제에서) `main` 보호 가능성. 그리고 이미 공개됐던 12일은 회수되지 않으며, 운영 데이터를 실제로 위협하는 항목(E2E가 운영 D1 id를 들고 있는 것)은 Private과 아무 관계가 없다. 따라서 **Private은 필요조건이지 충분조건이 아니다.**

### B-7. 전환한다면 — 누가, 무엇을, 그 다음에

**누가:** 소유자 **TJ (`taejunyun1`)** 만 가능하다. Jay(`deximple`)는 push 권한만 있고 admin이 아니라 이 설정을 볼 수도 바꿀 수도 없다.

**어디:** 저장소 → `Settings` → 맨 아래 `Danger Zone` → `Change repository visibility` → `Make private`.

**전환 후 확인 목록 (측정된 현재 상태 기준으로 대부분 무해하다)**

| 확인 | 현재 상태 | 예상 |
|---|---|---|
| Deploy key | 없음 | 조치 불필요 |
| Actions secret | 워크플로가 secret을 하나도 안 쓴다 | 조치 불필요 |
| Cloudflare 배포 연동 | 배포는 로컬 `pnpm run deploy`로 한다. GitHub 연동 배포가 아니다 | 조치 불필요. GitHub App 연결을 나중에 붙일 때 권한 재승인 필요 |
| 기존 포크 | 0개 | 조치 불필요 |
| 위키 | 자동으로 비공개가 된다 | 접근 확인만 |
| 협업자 | 2명 유지 | 확인만 |
| CI | 계속 동작. 월 약 290분 차감 시작 | 사용량만 관찰 |
| 문서 내 GitHub 링크 | 비로그인 상태에서 404가 된다 | 정상 |

**Private과 함께 반드시 할 3가지 (이게 빠지면 전환의 의미가 절반이다)**

1. **슬라이스 1을 실행한다.** E2E 설정에서 운영 `database_id`를 뗀다. 운영 데이터를 실제로 위협하는 유일한 항목이고 Private과 무관하다.
2. **무료 secret scanning의 공백을 메운다.** 전환하면 GitHub가 더 이상 무료로 잡아 주지 않는다. `.gitignore`는 이미 맞게 되어 있으므로, 커밋 전 로컬 검사 한 겹을 추가하는 정도로 충분하다.
3. **`main` 보호를 지금 결정한다.** 공개인 동안에는 Free에서도 보호 브랜치를 켤 수 있다. 비공개 + Free가 되면 못 켠다. 셋 중 하나를 고른다 — (a) 전환 **전에** 보호를 켜 본다, (b) 신뢰 기반을 유지한다(현 상태), (c) Team 요금제를 쓴다. **권고: 지금 `AGENTS.md` 1번 규칙이 기술적으로 강제되지 않는다는 사실만이라도 TJ가 알고 결정해야 한다.**

**되돌리기:** 언제든 다시 Public으로 바꿀 수 있다. 별과 워치 수는 복구되지 않는다.

### B-8. 이 문서 자체에 대한 주의

이 문서는 공개 저장소에 병합된다. 그래서 새로운 공격 정보를 더하지 않도록 썼다 — 비밀값, 값이 든 식별자, 미인증 경로의 악용 방법은 적지 않았다. 여기 적힌 약점은 이미 [`docs/audits/`](../../audits/)와 [지역 팩 플랜](./2026-08-17-region-pack-expansion.md)에 공개되어 있는 항목의 재확인이다.

### B-9. TJ에게 보낼 요청문 (초안)

```text
TJ, 저장소 Private 전환 요청드립니다.

이유는 비밀값 유출이 아닙니다. 이력·추적 파일 전수 확인 결과 비밀값 유출은 0건이고,
실제 값은 전부 Cloudflare secret에 있습니다.

문제는 사업 정보입니다. refer/ 아래 사업계획서와 개발명세서 원본, 그리고
docs/audits/의 수익 준비도 오딧이 지금 공개 상태로 올라가 있습니다.
여기에 우리가 문서에 적어 둔 알려진 약점 목록까지 함께 공개되어 있습니다.

이 저장소는 오픈소스 목적이 없습니다. LICENSE도 없고 포크 0, 외부 기여자 0이라
공개로 얻는 것이 사실상 없습니다. 얻는 것 없이 사업 기밀만 내주고 있는 상태입니다.

비용도 확인했습니다. CI는 실행당 약 1분, 월 290분 정도라 비공개 무료 한도
2,000분의 15% 수준입니다. 위키도 그대로 쓸 수 있습니다.

대신 두 가지를 잃습니다. 공개 저장소에서 무료로 받던 secret scanning이 유료가 되고,
현재 요금제에서는 main 브랜치 보호를 켤 수 없게 됩니다.
참고로 지금 main에는 보호 설정이 아예 없어서, 직접 push 금지 규칙이
기술적으로는 강제되지 않고 있습니다. 이건 별도로 판단해 주시면 좋겠습니다.

전환은 Settings 맨 아래 Danger Zone에서 소유자만 가능합니다. 저는 admin이 아닙니다.
전환 여부와 시점만 정해 주시면 나머지 확인은 제가 진행하겠습니다.
```

---

## 범위 밖

- 저장소 공개 범위 변경 (소유자 전용. 이 PR에서 하지 않았다)
- 배포, 원격 D1 쓰기, NAVER 실호출
- 고도화 슬라이스 구현 (각각 전용 이슈·PR)
- 스택 예외 신청
- 두 번째 도시

## 승인·롤백

| 행동 | 이 PR 병합만으로 승인? | 실제 승인 |
|---|---|---|
| 고도화 슬라이스 순서 채택 | 예. 상태 `GO`(방법) | 이 PR |
| 슬라이스 1~6 구현 | 아니오 | 각 이슈의 전용 PR |
| Private 전환 | 아니오 | TJ의 저장소 설정 변경 |
| geo 인덱스 추가 | 아니오. 측정이 먼저 | 측정 결과를 포함한 전용 PR |
| 지역별 NAVER 예산 컬럼 | 아니오 | 순번 migration을 포함한 전용 PR |

Rollback: 이 PR은 문서만 되돌리면 된다.

---

# 2026-08-17 Advancement Method and Private-Repo Decision

> **Status:** The advancement **method** is `GO`. Repository visibility: **`request it — but private alone is not enough`**.
>
> This PR changed no product code, ran no deploy, and did not change repository visibility.

**Baseline:** `origin/main` `9e47190` · **Owner:** Jay · **Decision needed from:** TJ (`taejunyun1`)

## A. Advancement method

**Advancement here does not mean new features.** With zero open issues and four region-pack gate rows still lacking numbers, advancement means **making the gates falsifiable** — turning "it seems fine" into "here is the number."

Order gates by **risk**, not attractiveness. Five slices, each closable in one PR:

1. **Remove the production `database_id` from `wrangler.e2e.jsonc` (P0).** The e2e config carries the production D1 id. Playwright currently runs `--local --persist-to`, so this is a latent footgun rather than an active incident, but README already claims e2e never touches production. Fix with a placeholder id plus a test asserting the two configs differ. **Do not create a second D1** — a new binding needs an ADR under governance §6.
2. **Make review throughput a number (P0).** #171/#172 shipped the dashboard; dashboard code is not measurement. Derive 7-day publish/day and queue depth from existing work items, then record a two-week sample in a merged PR. No new table.
3. **Split the NAVER budget per region.** `getNaverLocalSearchApiCallsToday` sums globally and the daily limit is one app-wide variable. Put the budget on the region pack, partition the counter, expose per-region kill switches.
4. **Record 광주전남 curation quality.** Not code. An operator judgment merged as a PR.
5. **Geo index on `places` — only after slice 2.** Only `places_status_idx` and `places_search_text_idx` exist. Both the region-pack plan and governance §4.4 require measurement first.

Slice 6 (independent, cheap): prove `slugPrefix` works. Both packs currently set it to `""`, so it is untested. Add a test-only fake pack with a non-empty prefix.

**Cadence is not broken** (111 merged PRs, 66 closed issues, wiki maintained). Two refinements only: open the tracking issue before branching, and note that `main` has **no branch protection or ruleset**, so `AGENTS.md` rule 1 is honor-system today.

**Do not start:** a second city, a `regions` CRUD table, extra cron in the existing `Promise.all`, KV/Queues/Durable Objects, a native app, a second Worker/D1/account, or new auth/payment providers.

## B. Private repo decision

**Verified state:** public, 0 forks, 2 collaborators, public wiki, one CI workflow with pinned action SHAs, `contents: read`, `persist-credentials: false`, and **zero secret references**. No deploy keys. No branch protection or rulesets. Pages unused.

**Secrets did not leak.** The only `.dev.vars`-family file ever committed is `.dev.vars.example`, all placeholders. A secret-pattern scan over all tracked files returns zero hits. Real values live in Cloudflare. Cost-bearing NAVER server calls are admin-gated.

**What public actually exposes** is business information, not credentials: the **business plan and dev-spec source documents under `refer/`**, the **revenue-readiness audit** with its 12-month monetization ordering, and a **self-documented list of known weaknesses**. Identifiers (account id, D1 id, bucket names) are inert without a token.

**What private does not fix:** twelve days of public history cannot be retracted; the production Worker URL stays public; the e2e/production D1 id hazard is untouched; agents and collaborators authenticate and retain access.

**Measured cost:** Actions become metered but the job takes ~43s (1 billable minute per run, ~290 runs/month against a 2,000 free quota — about 15%). Wikis work on Free + private. The real losses are **free secret scanning and push protection** (free for public, paid per active committer for private) and **branch protection**, which GitHub Free offers on public repositories only.

**Verdict: request it, but private alone is not enough.** The repository has no open-source purpose — no license, no forks, no outside contributors — so it is giving away business confidential material for nothing, and the flip is one reversible click with negligible measured cost. But it forfeits free secret scanning and the ability to ever protect `main` on the Free plan, and it does nothing about the only item that actually threatens production data. Pair the flip with three things: run slice 1, replace the free secret-scanning safety net with a local pre-commit check, and decide `main` protection **before** flipping, since Free + private cannot enable it.

**Who clicks:** only TJ (`taejunyun1`). `Settings` → `Danger Zone` → `Change repository visibility` → `Make private`. Post-flip checks are mostly no-ops given the measured state: no deploy keys, no Actions secrets, no forks, deploys run locally rather than through a GitHub integration.

**Note on this document:** it merges into a public repository, so it adds no new attack information. Every weakness named here is already public in `docs/audits/` and the region-pack plan.
