# 베타 운영 준비: 집계·검수·출시 판정

**상태: UNVERIFIED / 운영 계정 접근 복구 대기 (2026-10-07).** 담당 TJ/Codex, [Issue #290](https://github.com/taejunyun1/Tasted_it/issues/290), [Draft PR #291](https://github.com/taejunyun1/Tasted_it/pull/291). 조회 기준 소스는 `origin/main` `75094f25224914b07e787b9ca2076482628a67d3`이다. 이 문서는 읽기 전용 집계와 기존 관리자 검수·공개 절차를 연결한다. 문서·SQL 변경에는 배포가 필요하지 않다. 실제 운영 수치와 공개 베타 GO는 아직 확인되지 않았다.

## 확인된 증거와 비어 있는 증거

| 영역 | 2026-10-07 기준 증거 | 남은 확인 |
| --- | --- | --- |
| 공개 HTTP | `07:49:39 UTC`(16:49 KST)에 `/`, `/places`, `/login`, `/privacy`, `/terms`, `/robots.txt` 모두 200. HSTS·CSP 응답. 비로그인 `/admin`은 302로 `/login?returnTo=%2Fadmin`. `/privacy`와 `/terms`에는 `DRAFT`·출시 전 검토 안내가 있다. `/places` 최초 HTML의 고유 장소 링크는 4개. | 최초 HTML 4개는 전체 D1 공개 장소 수가 아니다. 실제 배포 버전·RSI 로그도 미확인. |
| 운영 접근 | CLI 로그인은 유효하고 계정 2개가 보이나 지정 운영 계정은 보이지 않는다. 브라우저에서도 대상에 접근할 수 없다. | 원격 D1 수치·스키마·migration 상태, 실제 검수·공개 결과 모두 미확인. 원격 읽기/쓰기, NAVER 실호출, 배포는 수행하지 않았다. |
| 저장소 | GitHub 저장소는 Private, 소유자 관리자 권한은 확인, `main` 보호는 없음. Branch protection/ruleset 조회는 403이며 응답은 GitHub Pro 업그레이드 또는 Public 전환을 안내했다. Wiki API `has_wiki=false`이나 인증된 `wiki.git` clone은 가능하다. | Private 유지 상태의 보호 방식은 소유자가 결정. 구매·가시성 변경은 수행하지 않았다. |
| 로컬 검증·CI | `origin/main` 기준선 `75094f2`에서 단위 테스트 147개 파일·906개 통과. 작업 커밋 `719693d`에서 SQL 32개 지표의 로컬 fixture/읽기 전용 검증. [PR #291 기존 CI](https://github.com/taejunyun1/Tasted_it/actions/runs/37590401493)는 build·typecheck·unit·Playwright 통과, 통합 테스트 357개 중 17개 실패(2개 파일). 로컬에서도 같은 17개 실패를 재현했다. 원인은 2026-09-09 만료 시드와 실행 시각을 읽는 경로의 혼용이었다. 두 테스트 파일에서 `Date`만 2026-08-10 00:10 UTC로 고정하고 매 테스트 후 복원하자 해당 76개가 모두 통과했다. 공백 없는 임시 복사본의 전체 통합 테스트도 71개 파일·357개 통과했다. | 수정 후 PR CI 결과는 아직 확인 전이다. 원래 로컬 worktree 경로의 공백은 별도 2개 파일에서 React 모듈 수집 오류를 일으켜, 그 경로의 전체 실행은 69개 파일·353개 테스트 통과 및 2개 파일 수집 실패였다. 임시 복사본과 작업 브랜치의 수정 테스트 파일 해시는 일치한다. |
| 배포 기록 | [배포 런북](./cloudflare-deploy.md)에 기록된 최근 버전은 `739a0b2d-d7fb-48ec-92f6-df3e21ea82ef`(소스 `0562910`, [PR #289](https://github.com/taejunyun1/Tasted_it/pull/289)의 2026-09-08 기록). | 기록된 버전이 **현재 라이브 버전이라는 확인은 없다**. 코드에는 RSI stage 0과 6시간 cron이 구현되어 있다. stage 1–4 확대는 HOLD다. |

로컬 단위 테스트와 SQL 검증은 운영 데이터 상태나 법률 문안 확정의 증거가 아니다. 원시 응답 본문, 장소 이름·주소·ID, 이메일, 토큰은 기록하지 않는다. 보고에는 집계값, 조회 시각, 소스 SHA, 공개 경로, 저장소 설정 메타데이터만 남긴다.

## 1. 지정 대상에서 읽기 전용 집계

[운영 계정 SSOT](./cloudflare-deploy.md#운영-대상-계정-ssot)의 대상은 계정 `7543330c65069ee2df1b7b353fb0201c`, Worker `retaste-beta`, D1 `retaste-production` (`5181489d-83a7-4f78-9384-db096cadaa2d`)이다. 다른 계정이나 같은 이름의 다른 DB로 대체하지 않는다.

1. 지정 운영자가 본인 CLI 세션에서 `pnpm exec wrangler whoami`로 계정 접근을 확인한다. 계정 목록에 대상 ID가 없다면 **중단**하고 권한을 복구한다. `whoami`의 개인 식별 내용과 전체 응답은 문서·PR·공유 로그에 붙이지 않는다. Worker와 D1 ID의 연결도 위 SSOT와 대조한다.
2. 대상이 확인된 후, 저장소 루트에서 아래 명령만 실행한다. SQL은 [집계 스크립트](../../scripts/audit-beta-readiness.sql)의 `SELECT` 32개 정수 지표다. 결과를 공유할 때는 지표명·숫자와 조회 시각만 발췌한다.

   ```sh
   CLOUDFLARE_ACCOUNT_ID=7543330c65069ee2df1b7b353fb0201c pnpm exec wrangler d1 execute retaste-production --remote --file scripts/audit-beta-readiness.sql --json
   ```

3. 스키마 오류·응답 오류·대상 불일치·지표 누락이면 **숫자를 0으로 해석하지 말고 중단**한다. 권한·대상·스키마를 먼저 확인한다. 이 절차에서 원격 migration apply/create/bootstrap, SQL `UPDATE`, 임의 시드, 일괄 공개를 실행하지 않는다.

SQL 구조만 로컬에서 재현하려면 `pnpm run db:bootstrap:local` 후 아래를 실행한다. 로컬 결과는 운영 실측이 아니다.

```sh
pnpm exec wrangler d1 execute retaste-production --local --file scripts/audit-beta-readiness.sql --json
```

### 32개 지표 읽는 법

| 묶음 | 지표와 분모 | 판단에 쓰는 범위와 한계 |
| --- | --- | --- |
| 장소·공개 상태 | `places_total`, `places_published`, `places_hidden`, `places_draft`는 `places` 행 상태별 수. `published_without_verified_at`, `published_closed`, `published_without_primary_category`, `published_multiple_primary_categories`, `published_without_source_link`는 원시 `PUBLISHED` 행의 결함 표시다. | 원시 `PUBLISHED`는 실제 공개 조회 적격성이나 GO가 아니다. 출처 링크 없음은 **추가 확인**이며 다른 출처의 위법·실패 판정이 아니다. 결함 표시는 서로 겹친다. |
| 분류 폭 | `published_active_primary_leaf_category_count`는 `PUBLISHED`에 연결된 활성(`is_active=1`) 주 분류 중 활성 자식이 없는 말단 분류의 **고유 ID 수**다. | 전체 장소 수·지역 커버리지·모든 카테고리 충족률이 아니다. |
| 작업 상태·단계 | `review_active_total`, `review_on_hold_total`, `review_completed_total`, `review_excluded_total`은 상태별 작업 수. `review_active_source_review`, `review_active_naver_verification`, `review_active_category_confirmation`, `review_active_duplicate_review`, `review_active_final_approval`은 `ACTIVE` 작업의 1–5단계 수다. 빈 단계도 0 행으로 반환한다. | 우선순위와 처리량을 정하는 대기열 수다. 공개 가능한 수와 같지 않다. |
| 원본·근거 결함 | `active_subject_missing`, `active_source_missing_address`, `active_source_missing_coordinates`, `active_with_hold_code`, `active_manual_evidence_present`는 `ACTIVE` 작업이 분모다. 수동 근거는 공백 제거 후 **20자 이상**인 수만 센다. | 근거 길이는 내용의 진실성·승인 증거가 아니다. 원본 누락은 주소·좌표 누락에 중복 계상될 수 있다. 좌표 `0`은 `NULL`이 아니며, 지역 밖 좌표는 이 SQL에서 측정하지 않는다. |
| 선택 분류 | `active_selected_category_missing`, `active_selected_category_inactive_or_nonleaf`의 분모는 3–5단계 `ACTIVE` 작업뿐이다. | 1–2단계 전체에 분류 누락을 적용하지 않는다. 실제 말단·활성 여부는 작업별로 확인한다. |
| NAVER 상태 | `active_candidate_naver_unchecked/verified/needs_attention`은 `ACTIVE` 사업자 후보, `active_place_naver_unchecked/matched/needs_attention`은 `ACTIVE` 기존 장소 작업을 분모로 한다. `unchecked`는 상태 행 부재 또는 `SKIPPED`다. | 저장된 `VERIFIED`/`MATCHED`는 현재성·원본 지문·로컬 방문 음식점 판정의 증거가 아니다. 서버가 현재 조회 시점의 증거를 다시 검증한다. |

모든 결함·주의 지표는 중복될 수 있어 합산하여 고유 장소 수로 읽지 않는다. 집계 전후 수치 차이도 실제 작업 로그와 함께 해석한다.

## 2. 기존 관리자 큐에서 근거별 검수·선택 공개

[등록 원칙](./poi-registration.md)과 [장소 운영 가이드](./place-operations-runbook.md)에 따라 담당 ADMIN이 `/admin/place-operations?flow=review&step=5`부터 실제 5단계 대기를 확인한다. 5단계에서 공개할 수 없는 원인을 찾은 다음 현재 집계에 맞춰 `step=3`, `4`, `2`, `1` 순으로 확인한다. 이 순서는 탐색 우선순위이며 단계 건너뛰기가 아니다. `status=ready`는 좌표 가용성 표시로 보며 공개 적격 판정으로 쓰지 않는다. 좌표 누락은 확인 필요로 남기고 자동 지오코딩하지 않는다.

1. 원천(1): 원본·주소·좌표·영업·지역과 실제 출처를 작업별로 확인한다. 비음식, 유흥, 배달·포장 전용, 소매, 체인, 도매 등은 [로컬 음식점 정책](../../app/features/places/local-dining-policy.ts)의 분류와 현장 근거에 따라 제외/보류한다. 이름의 애매한 단어만으로 임의 제외하지 않는다.
2. NAVER(2): 기존 [검증 런북](./naver-local-category-runbook.md)의 제한과 실제 증거를 따른다. 저장된 후보 `VERIFIED`에는 규칙 버전·만료·조회 시각·입력 지문, 장소 `MATCHED`에는 대상 키·90일 이내 확인 조건이 있다([서버 판정](../../app/features/places/local-dining-review.server.ts)). 현재 적격 근거가 없으면 작업별 관리자 확인을 수행한다. 수동 방문 음식점 확인은 실제 근거·확인 체크·20–300자 사유·현재 대상에 묶여야 하며, 빈 문구를 20자로 채워 전진시키지 않는다.
3. 분류(3)·중복(4): 활성 말단 업종을 확정하고 충돌 시 근거를 남긴다. 열린 중복 후보는 별도 장소 `DISTINCT` 판단 또는 보류가 필요하다. 기존 검수의 전이·보류·제외 상태를 사용한다.
4. 공개(5): 관리자가 **선택한** `ACTIVE`/`FINAL_APPROVAL` 작업만 실행한다. [공개 함수](../../app/features/places/place-review-publication.server.ts)는 현재 `stageVersion`, 선택 분류, 로컬 음식점 `ELIGIBLE`, 중복 후보의 `DISTINCT`, 동시 처리 claim을 확인한다. 사업자 후보는 [후보 승인 함수](../../app/features/candidates/candidate.server.ts)에서 주소·좌표·활성 말단 분류 등 추가 조건을 거친다. 기존 장소 작업은 별도 경로로 공개되므로 두 경로의 세부 검사를 같다고 가정하지 않는다. 실패·건너뜀 코드를 건별로 확인한다.
5. 한 번에 다루는 검수·공개 작업은 요청당 `REVIEW_BATCH_MAX=50` 이내다. 화면의 NAVER 선택 가능 수 100은 공개 상한이 아니다. 제한된 묶음 처리 후 32개 지표를 다시 조회하고 운영 대시보드의 **7일 공개/일, ACTIVE 단계별 대기열**과 건너뜀 코드의 종류·건수만 기록한다. ID·상호·주소·메모 원문은 보고에 옮기지 않는다.

[D-13](../decisions/2026-08-05-next-product-decisions.md)의 **검수된 광주 300곳**은 카탈로그 운영 게이트다. 정적 `/places` HTML 개수나 위 SQL만으로 통과하는 자동 게이트가 아니다. 지역·분류 커버리지와 실제 공개 조회 적격성을 사람이 함께 판정한다. 일괄 공개나 SQL 상태 변경으로 목표 수만 맞추지 않는다.

## 3. 사람 입력과 공개 베타 판정

| 담당 입력·결정 | 필요한 확인 |
| --- | --- |
| 운영자·연락처 | 개인/개인사업자/법인 등 법적 주체, 공개 명칭·주소, 개인정보 보호책임자의 성명·직책·실제 이메일·전화, 일반 문의처와 전화 운영 방침. 허구의 신원·연락처를 넣지 않는다. |
| 실제 처리 설정 | Cloudflare 계약 주체·처리 위치, 국외 이전 국가·시점·방법·보유기간, 접근/오류/보안 로그의 실제 보존 설정, Resend의 실제 처리·보존 설정. |
| 데이터와 문안 일치 | [데이터 인벤토리](../legal/privacy-data-inventory.md)의 비회원 취향 세션 30일, 제품 이벤트 30일, 위치 `sessionStorage`·URL·로그 표면, Resend 주소와 토큰, 소셜 식별자, 리뷰어 신청 정보 등을 현 설정 및 `/privacy`·`/terms` 초안과 대조한다. [문안 가이드](../legal/privacy-policy-guide.md)에 따라 최종 검토·변경일·시행일·구버전 보관 위치를 확정한다. 실제 입력 후 별도 PR에서 문안을 확정한다. 이 문서는 법률 문안 시행이나 적법성 판단이 아니다. |
| 출시 운영 결정 | 지정 계정 접근 복구 → 원격 집계와 스키마 확인 → 근거별 검수·선택 공개 → 광주 카탈로그/법률/Private 저장소 보호 방식 결정 → 소유자의 명시적 GO. 현재는 첫 단계부터 차단되어 GO가 아니다. |

RSI stage 1–4 확대, 다른 도시, 결제·대규모 확장은 이번 베타 잔여 작업에 포함하지 않는다. 작업 범위와 운영 행위의 승인 원본은 병합된 PR이며, 병합 기록 자체는 실제 운영 실행의 증거가 아니다.
