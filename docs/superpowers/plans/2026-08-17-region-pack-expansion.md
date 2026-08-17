# 2026-08-17 지역 팩(region pack) 확장 제약

> **상태:** `GO` — **제약/계획**이다. 지금 도시를 추가하라는 승인이 아니다. Jay 합의(2026-08-17): 전남-광주가 실제로 끝나기 전에는 공개·운영 시장을 광주전남만 두고, 이후 확장은 같은 제품·Worker 1개·D1 1개의 **지역 팩**으로만 한다.

**Goal:** 이후 모든 작업이 광주전남을 포크하지 않으면서도, 두 번째 도시를 지금 실어내지 않게 한다.

**추적:** [#178](https://github.com/taejunyun1/Tasted_it/issues/178) 지역 상수 단일 모듈 정리(론칭은 광주전남)

**거버넌스:** [`docs/decisions/2026-08-10-tech-stack-governance.md`](../../decisions/2026-08-10-tech-stack-governance.md) — 상태 `PROPOSED`. 이 문서는 스택 예외 승인이 아니다.

**코드 기준선:** `origin/main` `9c8c7ee`

**담당:** Jay · **합의:** Jay (전남-광주 완료 전 확장 제약)

이 PR은 문서만 추가한다. 지역 팩 구현, 두 번째 도시 공개, 새 Worker/D1/계정/포크/KV/Queues/DO/프레임워크는 범위 밖이다.

## 판정

**지역 팩만 허용한다.** 아래는 기각한다.

| 기각 | 이유 |
|---|---|
| 도시별 Worker | 거버넌스 기본은 Worker 1개. 배포·관측·인가가 갈라진다. |
| 도시별 D1 shard | 두 번째 운영 DB는 측정된 한계와 이전 계획 없이 HOLD. |
| git fork / 복제 관리자 | 같은 제품의 분기. 검수·인증·큐레이션이 어긋난다. |
| 두 번째 Cloudflare 계정 | 운영 SSOT가 다시 갈라진다. |
| 기존 cron `Promise.all`에 도시별 작업 추가 | 현재 `workers/app.ts`는 이미 5개 작업을 한 번에 돌린다. 거버넌스 §5.2: 결합 실패를 먼저 분리하기 전에는 같은 `Promise.all`에 새 작업을 넣지 않는다. |
| 성급한 `regions` CRUD 테이블 | 지금은 코드 모듈이면 충분하다. 새 테이블은 제품 요구·lifecycle·migration이 따로 필요하다. |

허용하는 형태: **같은 제품, Worker 1개, D1 1개, 데이터 모듈로 팩을 추가.**

## 전남-광주 완료 정의 — 두 번째 도시 게이트

아래가 모두 참이기 전에는 제주를 포함해 두 번째 도시를 실어내지 않는다.

| 게이트 | 현재 사실 (`origin/main` `9c8c7ee`) | 아직 남은 것 |
|---|---|---|
| 관리자 파이프라인이 실제로 돌아간다 | 오딧 ADM-IA-01/02를 아직 비어 있다고 보지 않는다. 제안 승인 UI는 [#173](https://github.com/taejunyun1/Tasted_it/pull/173)(#164), 영업 재검증·정정·병합 탭은 [#175](https://github.com/taejunyun1/Tasted_it/pull/175)(#165). 라이브 클릭·NAVER 표본 승인은 [#176](https://github.com/taejunyun1/Tasted_it/pull/176)(#161·#163, 둘 다 닫힘). `admin-place-operations`에 검수·제안·재검증·정정·병합 탭이 있다. | 운영자가 이 화면으로 광주전남 큐를 꾸준히 처리한다는 **측정된** 증거 |
| Worker 플랜 / 관리자 CPU | [#166](https://github.com/taejunyun1/Tasted_it/issues/166)에 `usage_model=standard`(Workers Paid)로 기록됨. 이 문서에서 재논쟁하지 않는다. | 도시 2를 이유로 플랜을 바꾸거나 두 번째 Worker를 만들지 않는다 |
| 사람 검수 처리량 | 대시보드 `PLACE_REVIEW_*`는 [#172](https://github.com/taejunyun1/Tasted_it/pull/172)(#171) | 광주전남에서 측정된 일/주 처리량. 숫자 없이 “끝나다”고 하지 않는다 |
| NAVER 표본 | [#163](https://github.com/taejunyun1/Tasted_it/issues/163) 닫힘. 광주전남 표본은 끝 | 도시 2 전에 **지역별** NAVER 예산(한도·kill switch·기아 방지). 전역 카운터만으로는 부족하다 |
| 광주전남 큐레이션 품질 | 홈 큐레이션은 bbox/중심 기반이며 지역 컬럼이 없다 | 운영자가 광주전남 공개 목록을 “이 정도면 된다”고 한 기록 |
| E2E가 운영 D1을 공유하지 않는다 | `wrangler.e2e.jsonc`의 `database_id`가 운영 `wrangler.jsonc`와 같다. 알려진 위험 | 도시 2 전에 격리하거나, 공유 id를 제거하는 전용 수정. **이 문서 PR에서는 고치지 않는다** |

이 게이트를 통과했다고 기록하는 곳은 병합된 전용 PR이다. 이 문서의 `GO`는 그 통과가 아니다.

## 지역 팩이란

플랫폼 재작성이 아니다. **데이터 모듈 1개**다. 예:

```ts
type RegionPack = {
  code: string;
  displayName: string;
  bounds: { minLatitude: number; maxLatitude: number; minLongitude: number; maxLongitude: number };
  defaultCenter: { latitude: number; longitude: number };
  defaultBbox: readonly [west: number, south: number, east: number, north: number];
  districtSet: ReadonlySet<string>; // 반드시 도시 접두와 함께 쓰거나, id에 도시 접두를 넣는다
  publicDataAddressPrefix: string;
  slugPrefix: string;
};
```

활성 팩이 하나여도 지도·주소·검수 필터·집군 키는 이 모듈만 읽는다. 공개 론칭 플래그/복사는 광주전남을 가리킨다.

## 현재 이음새 (코드에서 확인)

### 이미 지역에 묶이지 않은 것

- `places`에 region 컬럼이 없다. 주소·위경도·`neighborhood`만 있다. geo 인덱스도 없다(`places_status_idx`, `places_search_text_idx`만).
- 홈 큐레이션(`home-curation.server.ts`)은 중심+반경 bbox다. 지역 enum을 읽지 않는다.
- 인증(`users`, session, Google/NAVER OAuth)은 지역이 없다.
- 검수 큐는 지역 필터가 있다(`PlaceReviewToolbar`의 광주/전남). 필터를 끄면 한 목록에 섞인다.

### 광주·전남에 붙어 있는 것

- 닫힌 유니온 `RegionCode = "GWANGJU" | "JEONNAM"` — `public-data.ts`, `schema.ts`(`business_licenses`, 리뷰어, 주차 등), `place-review-pagination.ts`, 리뷰어 지원 폼.
- 주소 prefix 판정이 대략 6개 이상 파일에 복제: `public-data.ts`, `parking-data.ts`, `ev-data.ts`, `place-review-query.server.ts`(`광주%` / `전%`), `naver-local-category.ts`, `place-location.ts`, `naver-place-liveness.server.ts`. 공공데이터 sync는 `addressPrefix: "전남광주통합특별시"`를 하드코딩한다.
- bbox가 서로 다르다. 예: `map-state.ts` `DEFAULT_BBOX`, `PlaceMap.tsx` `GWANGJU_OVERVIEW_BOUNDS`, `location-policy.ts` `SERVICE_AREA_BBOX`. `place-location.ts` `SUPPORTED_BOUNDS`와 주차 광주 좌표 상자도 또 있다.
- `region-cluster-policy.ts`의 `GWANGJU_DISTRICTS`는 `동구`/`서구`처럼 **도시 접두 없는** 구 이름이다. DISTRICT 키는 구 이름만 쓴다. 부산·대구·인천을 넣으면 같은 구 이름이 한 클러스터로 붙는다.

## 지금 해도 되는 일 (론칭은 광주전남)

[#178](https://github.com/taejunyun1/Tasted_it/issues/178)만. 새 테이블·binding·의존성 0.

1. 지역 상수·주소 prefix·bbox·구집 키를 모듈 1개로 모은다.
2. 호출부는 그 모듈을 읽는다. 세 번째 bbox나 새 `광주%`/`전%` 매처를 만들지 않는다.
3. 팩 항목을 추가하는 실험이 지도/큐레이션/검수 큐를 깨지 않는지 테스트로 막는다. **공개 론칭은 광주전남.**

성공: 나중에 팩 한 줄을 넣어도 기존 광주전남 경로가 그대로이고, 사용자는 두 번째 도시를 보지 않는다.

## 게이트 이후 도시 순서

두 번째 도시는 **제주**가 먼저다. 지리적으로 떨어져 있고, 규모가 작으며, `동구`/`서구` 충돌이 없다.

| 순서 | 지역 | 조건 |
|---|---|---|
| 1 | 제주 | 게이트 통과 후 첫 팩. 구 이름 충돌이 없다. |
| 다음 | 부산, 대구, 인천 | **구 이름 충돌 수정 후.** 집군 id는 `부산:동구`처럼 도시 접두가 있어야 한다. |
| 나중 | 서울, 동해 | 같은 팩 모델. 별도 Worker/D1 없음. |
| 마지막 | 세종 | 구/군이 없다. 구 집합·집군 가정을 굳힌 뒤. |

도시마다 이슈를 미리 열지 않는다. 다음 실행 이슈는 게이트 통과 뒤에 연다.

## 다른 PR에 대한 상시 규칙

전남-광주가 끝나기 전에도:

- 세 번째 bbox를 하드코딩하지 않는다.
- 새 `광주%` / `전%` 주소 매처를 만들지 않는다.
- 접두 없는 `동구` 집군 id를 추가하지 않는다.
- 새 지리·주소 로직은 모듈 1개를 거친다. 활성 팩이 하나여도 마찬가지다.
- 도시별 cron을 기존 `Promise.all`에 넣지 않는다.
- 이 제약을 이유로 스택 예외(두 번째 Worker/D1/KV/Queues/DO)를 열지 않는다.

## 위험

| 위험 | 왜 |
|---|---|
| 구 이름 충돌 | 접두 없는 `동구`/`서구`는 여러 광역시에서 같다. |
| slug 루프 vs Free subrequest 50 | `slugifyPlaceName`은 상호만 쓰고, `uniqueSlug`는 전역 유일하다. 리다이렉트(`place_slug_redirects`)와 맞물리면 요청이 길어진다. #166은 Paid/`standard`다. Free 50을 현재 한도로 재논쟁하지 않되, 팩에는 `slugPrefix`가 있어야 한다. |
| geo 인덱스 없음 | `places` bbox 조회는 상태/검색 인덱스만 탄다. 한 시장에서는 버틸 수 있으나 도시가 늘면 스캔이 커진다. 인덱스는 측정 뒤에 별도 PR. |
| 전역 NAVER 카운터가 광주를 굶긴다 | 일일 한도는 앱 전역이다. 도시 2 예산 없이 동기화하면 광주전남 검수가 멈춘다. |
| 검수 큐 정렬 혼재 | 지역 필터를 끄면 한 큐다. 두 도시가 섞이면 처리량 측정이 무의미해진다. |
| 지역 없는 상호 그룹 | `place-name-groups`는 정규화 상호만 본다. 다른 도시 동명이 한 그룹이 된다. |
| 브랜드·약관 복사 | 홈 메타, 약관, 위치 피커는 “광주·전남”으로 고정. 팩을 넣어도 복사 변경은 별도 제품 승인. |
| 거버넌스 `PROPOSED` | 스택 ADR은 아직 ACCEPTED가 아니다. 이 플랜은 예외를 열지 않는다. |

## 이 문서의 범위 밖

- 지역 팩 구현 또는 제주 공개
- 스택 예외 신청
- E2E `database_id` 수정(게이트로만 기록)
- 도시 7개 이슈 개설
- 배포, 원격 D1 쓰기, NAVER 실호출

## 승인·롤백

| 행동 | 이 플랜 PR 병합만으로 승인? | 실제 승인 |
|---|---|---|
| 제약 채택(론칭은 광주전남, 확장은 팩) | 예. 상태가 `GO`(제약)로 기록된 뒤 병합 | 이 PR |
| 상수 모듈 정리 | 아니오 | #178 전용 코드 PR |
| 두 번째 도시 공개 | 아니오 | 게이트 통과를 기록한 전용 PR |
| 새 Worker/D1/binding | 아니오. 거버넌스는 `PROPOSED` | 별도 ADR + 예외 기록 |

Rollback: 이 PR은 문서만 되돌리면 된다. 후속 코드 PR은 각자 revert.

---

# 2026-08-17 Region-Pack Expansion Constraint

> **Status:** `GO` as a **constraint/plan**, not as permission to add cities now. Jay agreed (2026-08-17): keep 전남-광주 as the only launch/operating market until it is actually complete, then expand only via a **region pack** on the same product, one Worker, and one D1.

**Goal:** Make later city work add a pack instead of forking, without shipping a second city in this change.

**Tracking:** [#178](https://github.com/taejunyun1/Tasted_it/issues/178) region-constant consolidation (launch stays 광주전남)

**Governance:** [`docs/decisions/2026-08-10-tech-stack-governance.md`](../../decisions/2026-08-10-tech-stack-governance.md) is still `PROPOSED`. This document is not stack-approval.

**Baseline:** `origin/main` `9c8c7ee`

**Owner:** Jay · **Agreement:** Jay (constraint until 전남-광주 is complete)

This PR is documentation only. It does not implement packs, ship a second city, or add a Worker, D1, account, fork, KV, Queue, Durable Object, or framework.

## Verdict

**Region pack only.** Reject city-specific Workers, D1 shards, git forks, cloned admin, a second Cloudflare account, extra cron jobs in the existing `Promise.all` (`workers/app.ts` already runs five tasks together; governance §5.2 forbids adding more before isolation), and a premature `regions` CRUD table.

## Definition of 전남-광주 complete

Do not ship a second city until all of the following are true.

- **Admin pipeline operable:** Do not copy stale HOLD/NO-GO as if suggestion or liveness/merge UI is still missing. On current `main`, suggestion approval returned in [#173](https://github.com/taejunyun1/Tasted_it/pull/173) (#164) and liveness/correction/merge tabs in [#175](https://github.com/taejunyun1/Tasted_it/pull/175) (#165). Live QA and the NAVER sample were approved in [#176](https://github.com/taejunyun1/Tasted_it/pull/176) (#161, #163 closed). The remaining gate is **measured** operator throughput on that UI, not “UI missing.”
- **Worker plan / admin CPU:** [#166](https://github.com/taejunyun1/Tasted_it/issues/166) recorded `usage_model=standard` (Workers Paid). Do not re-litigate here.
- **Measured human review throughput** in 광주전남. Dashboard code in #171/#172 is not the measurement.
- **NAVER:** live sample done (#163 closed). A **per-region** NAVER budget is still required before city 2.
- **Curation quality** in 광주전남 is recorded as good enough.
- **E2E must not share production D1.** `wrangler.e2e.jsonc` reuses the production `database_id`. Treat that as a gate/fix; do not change it in this docs PR.

## What a region pack is

One data module, for example `{ code, displayName, bounds, defaultCenter, defaultBbox, districtSet, publicDataAddressPrefix, slugPrefix }`. Not a platform rewrite. Public launch copy stays 광주전남 while only one pack is active.

## Current seams (grounded)

**Already agnostic:** `places` has no region column; home curation is center/bbox; auth has no region; the review queue has a region filter.

**Glued:** closed `RegionCode = "GWANGJU" | "JEONNAM"`; address-prefix matchers duplicated across ~6 files; three different bboxes (`DEFAULT_BBOX`, `GWANGJU_OVERVIEW_BOUNDS`, `SERVICE_AREA_BBOX`); unprefixed `동구`/`서구` district ids in `region-cluster-policy.ts`.

## Work that MAY happen now

[#178](https://github.com/taejunyun1/Tasted_it/issues/178) only: consolidate region constants into one module. Zero new tables or bindings. Success = adding a pack entry does not break map/curation/queue, while public launch stays 광주전남.

## After the gate

Second city is **제주** first (geo-separated, small, no `동구`/`서구`). 부산/대구/인천 after the district-collision fix. 세종 last (no 구/군). Do not open one issue per city now.

## Standing rule for other PRs

Do not hardcode a third bbox, a new `광주%`/`전%` matcher, or unprefixed `동구` cluster ids. New geo/address logic goes through the single module even while only one pack is active.

## Risks

District-name collision; slug loops vs Free subrequest 50 (Paid/`standard` is already recorded — keep `slugPrefix` anyway); missing geo index on `places`; a global NAVER counter starving 광주; mixed review-queue sort; name-groups without region; brand/legal copy; governance still `PROPOSED`.

## Out of scope

Implementing packs, shipping 제주, opening a stack exception, fixing the E2E `database_id`, or opening seven city issues.

## Approval and rollback

Merging this PR adopts the constraint only. #178 needs its own code PR. A second city needs a later PR that records the gate. Rollback is revert of this documentation.
