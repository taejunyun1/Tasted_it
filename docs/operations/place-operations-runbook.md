# Re:Taste 장소 운영 가이드

작성일: 2026-08-06
적용 버전: Place Operations v1

## 운영 원칙

- 회원 제안은 승인해도 `DRAFT`로만 생성한다. 공공데이터 검수 또는 관리자 장소 검수에서 별도로 공개한다.
- 폐업이 확인된 장소는 즉시 `HIDDEN` 처리하며 지도·목록·검색 후보에 노출하지 않는다.
- AI나 중복 규칙은 후보와 근거만 제시한다. 자동 병합·자동 공개는 하지 않는다.
- 장소 수정, 병합, 복원, 영업 상태 변경은 사유와 before/after revision을 보존한다.
- 동네는 별도 입력받지 않고 주소의 괄호 또는 행정동·읍·면·리에서 추출한다.

## 회원·외부 요청 흐름

1. 이메일 인증 회원이 `/suggestions/new`에서 장소를 제안한다.
2. 중복 후보가 있으면 별도 장소인 이유가 있어야 접수된다.
3. 회원은 `/me/suggestions`에서 상태와 관리자 답변을 확인한다.
4. 업주·직원·방문자는 로그인 없이 `/corrections/new`에서 정정·이전·휴업·폐업·권리 요청을 제출할 수 있다.
5. 정정 요청은 이메일 확인 링크를 완료한 뒤에만 관리자 큐로 이동한다.

## 관리자 처리 순서

관리자 화면은 `/admin/place-operations`다.

1. **회원 장소 제안:** 주소·좌표·대표 카테고리·중복 근거를 확인한다. 좌표가 없으면 관리자 입력 후 `초안 승인`한다.
2. **정보 정정:** 요청자 관계, 이메일 확인 여부, 변경 JSON, 근거를 확인한다. 적용하면 장소 수정과 revision이 함께 기록된다.
3. **영업 재검증:** `CLOSED`는 숨김 유지, 오탐이나 재개업은 공개 복원한다. 90일 이상 확인되지 않은 공개 장소도 같은 큐에서 처리한다.
4. **중복 병합:** 남길 장소와 흡수할 장소를 다시 확인하고 병합 근거를 입력한다. 투표·저장·출처는 남길 장소로 이동하고 기존 slug는 301 redirect된다.
5. **최근 변경·복원:** 잘못된 변경은 DB rollback 대신 이전 revision 값을 적용하는 새 `RESTORE` revision으로 복원한다.

## 상태 기준

- 장소 제안: `SUBMITTED → REVIEWING/NEEDS_INFO → APPROVED/REJECTED/DUPLICATE`
- 정정 요청: `PENDING_VERIFICATION → SUBMITTED → REVIEWING → APPLIED/REJECTED`
- 재검증: `OPEN → REVIEWING → RESOLVED`
- 승인된 제안 장소: `DRAFT`; 별도 공개 검수 후에만 `PUBLISHED`

## 예약 작업

- 공공데이터 동기화에서 `CLOSED`가 확인되면 연결된 공개 장소를 숨기고 재검증 사건을 생성한다.
- `TEMPORARILY_CLOSED`와 `UNKNOWN`은 자동으로 숨기지 않고 재검증 사건만 생성한다.
- 마지막 확인 후 90일이 지난 공개 장소는 예약 작업이 `STALE_90D` 사건으로 등록한다.
- 열린 동일 사건이 있으면 중복 생성하지 않는다.

## 배포 확인

1. D1 export 후 `0006_place_operations.sql`을 적용한다.
2. 회원 제안·내 제안·공개 정정·관리자 장소 운영 화면의 HTTP 200을 확인한다.
3. 관리자 외 계정이 관리자 URL에 접근할 수 없는지 확인한다.
4. 폐업 장소가 지도·목록·검색에서 제외되는지 확인한다.
5. 병합 전 slug가 남길 장소 slug로 redirect되는지 확인한다.

## 취향 온보딩 운영

### 순방향 migration

취향 온보딩 배포에는 다음 migration이 순서대로 모두 필요하다. 이미 적용한 migration 파일은 수정하거나 되돌리지 않는다.

1. `0018_app_first_taste_onboarding.sql`: 비회원 취향 세션·선택, 추천 피드백, 제품 이벤트 테이블과 인덱스를 추가한다.
2. `0019_taste_learning_state.sql`: 저장·평가 기반 추론 취향 갱신의 사용자별 동시성 상태를 추가한다.
3. `0020_product_event_lifecycle_uniqueness.sql`: 같은 비회원 세션의 시작·회원 전환 이벤트가 중복되지 않도록 부분 유일 인덱스를 추가한다.
4. `0021_guest_onboarding_selection_revision.sql`: 같은 문서 안에서 늦게 도착한 선택 저장을 거절할 revision을 추가한다.
5. `0022_guest_onboarding_selection_epoch.sql`: 재진입·복수 탭의 이전 문서가 최신 선택을 덮지 못하도록 document epoch를 추가한다.
6. `0023_onboarding_data_lifecycle.sql`: 30일 제품 이벤트 purge가 전체 테이블 scan 없이 실행되도록 발생 시각 인덱스를 추가한다.

로컬 검증은 격리된 로컬 D1에서 다음 명령으로 수행한다.

```bash
pnpm wrangler d1 migrations apply DB --local
```

운영 D1 적용은 배포 담당자가 export와 현재 Worker version을 기록한 뒤 `0018`부터 `0023`까지의 미적용 목록을 확인하고 수행한다. 이 절차는 기존 데이터를 파괴하는 역 migration을 포함하지 않는다.

### 취향 온보딩 기능 플래그

- 활성: `ONBOARDING_ENABLED=true`
- 비활성: `ONBOARDING_ENABLED=false`
- 판정 방식: 문자열이 정확히 `true`일 때만 활성화된다. 미설정 또는 다른 값은 비활성으로 취급한다.
- 현재 저장소 기본값: `wrangler.jsonc`의 `ONBOARDING_ENABLED`는 `true`다. 제한 공개가 필요하면 배포 환경에서 먼저 `false`로 설정해 Worker를 배포하고, 준비가 끝난 시점에 `true`로 전환해 다시 배포한다.
- 비활성 동작: 비회원 `/places`와 추천 resource는 비회원 온보딩 세션을 조회하지 않고 기존 추천 흐름을 사용한다. `/onboarding/taste` loader와 stale/direct POST는 세션·배지·이벤트·쿠키를 생성·수정하지 않고 allowlist로 정규화한 공개 `returnTo`로 이동한다. 로그인 사용자의 direct POST도 같은 무변경 경로로 처리한다.
- `returnTo` allowlist: raw pathname으로 정확한 `/places`와 React Router `/places.data`만 허용하고 둘 다 `/places`로 canonicalize한다. 공개 필터 `bbox`, `category`, `q`, 반복 `badge`만 보존한다. 자기 경로 `/onboarding/taste`, 관리·인증·로그아웃·알 수 없는 경로, 외부·protocol-relative, backslash, dot-segment, 중첩 인코딩 입력은 `/places`로 fallback한다.
- 롤백 확인: 새 비회원 브라우저에서 `/places`가 `/onboarding/taste`로 이동하지 않고 기존 추천을 표시하는지 확인한다.

현재 플래그는 전체 켜기/끄기만 지원한다. 사용자 비율 기반 점진 노출은 지원하지 않으므로 제한 공개 대상은 별도 배포 환경 또는 명시적인 QA 사용자 집단으로 관리한다.

### 출시 순서

1. 운영 D1 export, 현재 Worker version, 현재 기능 플래그 값을 기록한다.
2. 격리된 로컬·preview 환경에서 `0018`~`0023`과 typecheck, unit, Workers integration, build, 데스크톱·모바일 온보딩 E2E를 확인한다.
3. 배포 담당자가 운영 D1의 미적용 migration을 순서대로 적용하고 적용 목록을 다시 확인한다.
4. `ONBOARDING_ENABLED=false`로 기존 `/places` 추천, 로그인, 저장·평가가 정상인지 먼저 확인한다.
5. 제한 공개 환경에서 `ONBOARDING_ENABLED=true`로 전환하고 시작·완료·건너뛰기·회원 전환과 제품 동작 실패 로그를 관찰한다.
6. 초기 관찰 구간과 다음 24시간에 지표·오류가 기준 범위인지 확인한 뒤 공개 범위를 결정한다.

### 관찰 이벤트와 지표

허용되는 제품 이벤트는 다음 아홉 개다.

- 온보딩: `ONBOARDING_STARTED`, `ONBOARDING_STEP_COMPLETED`, `ONBOARDING_COMPLETED`, `ONBOARDING_SKIPPED`
- 추천 행동: `RECOMMENDATION_DETAIL_OPENED`, `RECOMMENDATION_SAVED`, `RECOMMENDATION_LIKED`, `RECOMMENDATION_DISLIKED`
- 회원 전환: `GUEST_CONVERTED`

배포 직후에는 이벤트별 건수와 발생 시각을 확인한다. `ONBOARDING_STARTED` 대비 완료·건너뛰기·회원 전환의 급격한 변화, `PRODUCT_EVENT_WRITE_FAILED`, `GUEST_TASTE_MERGE_FAILED`, `TASTE_LEARNING_REFRESH_FAILED`의 증가를 함께 관찰한다. 이벤트 기록과 취향 학습 실패는 핵심 사용자 동작과 분리되어 있으므로, 고정 오류 코드가 증가하면 사용자 동작 성공 여부와 이벤트·학습 상태를 각각 확인한다.

```sql
SELECT event_name, COUNT(*) AS event_count, MAX(occurred_at) AS latest_at
FROM product_events
WHERE unixepoch(occurred_at) >= unixepoch('now', '-1 hour')
GROUP BY event_name
ORDER BY event_name;
```

### 보존·삭제 예약 작업

- 기존 daily cron `17 18 * * *`(한국 시간 매일 03:17)이 온보딩 수명주기 작업도 함께 실행한다.
- 진행 중 비회원 세션은 유효한 온보딩 활동마다 D1 `expires_at`과 응답 쿠키를 현재 시각+30일로 갱신한다.
- 완료·건너뛰기는 해당 terminal 활동 시각+30일로 고정하며 이후 `/places`·추천 조회는 연장하지 않는다. 병합 세션도 연장하지 않는다.
- 예약 작업은 `expires_at <= now`인 `guest_taste_sessions`를 삭제한다. `guest_taste_badges`는 외래 키 cascade로 함께 삭제되고, 남겨야 할 최근 제품 이벤트의 guest 참조는 `SET NULL` 처리된다.
- `product_events`는 발생 후 30일 보유한다. 출시 직후·24시간 관찰과 월 단위 단기 비교를 지원하는 가장 짧은 운영 기간으로 정했으며, 매일 `occurred_at <= now-30일` 행을 삭제한다.
- 점검 SQL은 `SELECT MIN(occurred_at), MAX(occurred_at), COUNT(*) FROM product_events;`와 `SELECT COUNT(*) FROM guest_taste_sessions WHERE expires_at <= datetime('now');`를 사용한다. 만료 행이 다음 daily cron 이후에도 계속 남으면 Worker scheduled 오류를 먼저 확인한다.

### 개인정보 경계

- `product_events.metadata_json`에 이메일, 이름, 주소, 원본 위치 좌표를 기록하지 않는다.
- metadata는 `step`, `selectedCount`, `sourceRail`, `discoveryMode`, `reason`만 허용하며 문자열 또는 유한 정수만 저장한다.
- 비회원 식별자는 서버가 발급한 무작위 세션 ID만 사용한다. 브라우저 지문이나 원본 좌표를 식별자로 사용하지 않는다.
- 기기 위치는 위도·경도를 소수점 셋째 자리(약 100m)로 반올림한 뒤 sessionStorage와 현재 요청 bbox URL에만 사용한다. bbox query는 브라우저 기록과 Cloudflare 접근 로그 표면에 남을 수 있지만 D1 세션·`product_events`에는 기록하지 않는다.
- 운영 조회 결과를 내보낼 때 사용자·비회원 세션 ID와 metadata 원문을 불필요하게 복사하지 않는다.
- 장애 로그에는 예외 본문, 계정·세션 ID 또는 개인정보를 추가하지 않고 정의된 고정 오류 코드만 사용한다.

### 롤백

1. `ONBOARDING_ENABLED=false`로 설정한 호환 Worker를 배포한다.
2. 새 비회원 브라우저에서 `/places`가 온보딩으로 이동하지 않고 기존 추천을 표시하는지 확인한다.
3. `/onboarding/taste?returnTo=%2Fonboarding%2Ftaste`와 관리·인증 경로를 `returnTo`로 준 loader/direct POST가 `/places`로 돌아가고, 세션·배지·이벤트·쿠키를 변경하지 않는지 확인한다. `/places.data`는 지원 필터만 보존한 `/places`로 돌아가야 한다.
4. 로그인, 저장, 평가와 기존 장소 운영 화면이 정상인지 확인한다.
5. `0018`~`0023`은 기존 흐름과 호환되는 추가형 schema이므로 파괴적 역 migration을 실행하지 않는다. 후속 수정이 필요하면 새 순번의 순방향 migration을 작성한다.
6. 장애 시간, 영향 범위, Worker version, 기능 플래그, D1 migration 상태, 관찰 이벤트와 조치자를 기록한다.
