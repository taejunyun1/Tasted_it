# B17 ADMIN 통합 운영 전환

2026-11-18 · #460. 실행 담당은 Codex root. 이 계획은 기존 기능 PR의 승인·운영 범위를 한 번의 전환 창으로 묶는 검토안이며, 실제 실행은 해당 최종 코드와 이 계획의 PR 병합 뒤에만 한다. 최종 통합 PR이 수용되면 이전 개별 전환 문서의 별도 배포 순서를 아래 합동 전환 순서로 대체하고 통합 head를 최종 검증 기준으로 삼는다. #397 HOLD, #360의 사실·정책 미확정은 유지한다.

## 선행 조건과 대상

- #444/#446 및 #448/#455/#458/#464/#456/#461/#457/#459/#466, #463 날짜 선택 보완의 최종 코드가 main에 있어야 한다. 각 기능의 필요한 로컬 검증·독립 리뷰와 최종 통합 타입·migration·권한/거절·연결 검증을 보존한다. 모든 코드를 포함한 최종 통합 PR의 정확한 head에서 필수 4CI를 실제 통과해야 한다. 개별 PR은 구성 변경과 검토의 근거로 남기고, 통합 PR 병합 시 포함 관계와 실제 SHA를 기록해 중복 병합하지 않는다. CI 결제/지출 한도로 job이 시작되지 않으면 진행하지 않는다.
- 기존 Cloudflare 계정 `7543330c65069ee2df1b7b353fb0201c`, Worker `retaste-beta`, D1 `retaste-production` (`5181489d-83a7-4f78-9384-db096cadaa2d`), 기존 R2만 사용한다. 새 provider, dependency, secret, 권한, cron, 유료 플랜 변경은 없다.
- 대상 migration은 0050/0051/0052/0053/0054/0055/0056/0059/0060의 정확한 파일과 해시다. 0057/0058/0061 빈 migration을 만들지 않는다. 실행 직전 pending 목록과 대조해 다른 파일이 있으면 중단한다.

## 한 번의 전환 창

1. 최신 merged main을 frozen lockfile로 빌드하고 실제 Worker 버전·plain vars·binding·두 cron을 비교한다. B09의 과거 버전 기록을 현재 조회의 대체물로 사용하지 않는다.
2. 동일 빌드의 CST_MAINTENANCE=true와 assets.run_worker_first=true를 적용해 정적 요청도 Worker의 점검 fence를 먼저 통과하게 한다. 공개·인증·관리자·정적·RSI의 503/no-store를 확인한다. 저장 Observability가 불가능한 기존 제한에서는 bounded Wrangler tail을 사용한다.
3. 기존 요청·cron이 끝났다는 관측과 최대 실행 창을 확인한다. 특히 새 사진 삭제 소유권을 도입하므로 원래 실행을 새 코드가 안전하게 인계한다고 가정하지 않는다. 기존 HTTP/R2 작업의 종료를 확인할 수 없으면 시간 경과만으로 진행하지 않고 fence를 유지한다. 아래 15분 fallback은 cron의 최대 실행 창에만 적용한다. [Cloudflare 공식 한도](https://developers.cloudflare.com/workers/platform/limits/)는 HTTP 연결 지속시간에 같은 상한을 두지 않으므로 이를 HTTP/R2 완료 증거로 확대하지 않는다. 관측 공백이 있으면 fence 이후 최대 cron 실행 창 15분을 기다리고, 최소60초 및 마지막 가능한 원래 cron 시작+15분 조건을 함께 만족해야 한다.
4. TimeTravel 정보와 비공개 export 1개를 확보한다. 각 관련 원장·job·설정의 기존 필드와 rowid·권한·감사를 정렬해 건수/digest를 남긴다. 백업 확보는 실제 복원 성공이 아니다. 특히 기존 admin operations/commits/checks, public/rating/parking runs, reviewer photo cleanup, rating config/원시표/사진/학생 권한을 포함한다.
5. 지정 migration을 순서대로 적용한다. 새 열을 제외한 기존 자료·관계·rowid/FK가 같아야 한다. 새 quota는 역사 추정치와 초기 HOLD, feature stop 기본0, privacy/domain 표 빈 상태, cleanup 신규 소유권 값, 최종 kind union/trigger 조건을 확인한다. 실패 시 새 schema를 이해하는 fence를 유지하고 전진 수정한다. 구버전 정상 운영 재개·전체 DB 덮어쓰기는 하지 않는다.
6. B10 계획의 정확한 기존 공공 대기 작업 한 건만 그 계획의 현재 전체값/운영자/감사/중복 guard로 RUNNING→PENDING 전환할 수 있다. 기존 사전조회 이후 값이 변했으면 새 고정 manifest를 작성하고 값과 범위를 다시 검토한다. 다른 기존 작업/점수/권한/사진/개인정보 요청은 변경하지 않는다.
7. 정상 설정으로 같은 main을 100% 배포한다. 기존 ADMIN 계정의 고유 임시 세션 한 개(최대30분)로 각 새 화면의 읽기, 익명 거절, no-store, 제한된 오류·미확정 미리보기·재인증 없는 확정 거절을 확인한다. 일반회원403은 이 ADMIN 세션으로 증명하지 않으며 별도 범위가 없으면 로컬 검증/라이브 NOT_RUN으로 구분한다. 실제 설정 중단, 회원/장소 변경, 사진 삭제, 개인정보 처분, CSV 원문 추출, Resend 요청·메일, 수동 NAVER probe는 실행하지 않는다.
8. 같은 Worker에서 기존 고정 RSI 한 번의 6경로 결과/정확 버전/정상 종료를 확인한다. 이번 ADMIN·요청 시간창·trigger=admin·target=rsi-admin에 일치하는 감사 한 행을 대조하고 전체 감사 건수 증가만으로 판정하지 않는다. finally에서 이번 세션과 이 세션에 결속된 PENDING만 정확 ID로 정리한다. 완료 영수증·기존 감사는 보존한다. 최종 원장 변화는 명시된 migration/대기전환/RSI·시험 정리만 허용하며 그 외 변동은 원인을 확인한다.

합동 수동 한도는 애플리케이션 HTTP90회, D1 조회·관리50회, 관리 SQL180문장, 고정 migration 본문 SQL201문장(9파일), export1개, 기존 ADMIN 계정의 고유 임시 세션1개, RSI1회다. SQL 총상한은381문장이다. 관리 SQL180에는 읽기·변경·정리뿐 아니라 Wrangler migration 장부 처리11문장도 포함한다. D1 50회에는 한 번의 `migrations apply` 내부 요청11회도 포함하며, CLI 실행 한 번을 D1 한 번으로 축소 계수하지 않는다. Cloudflare 설정 조회·배포 등 제어 API 호출은 애플리케이션 HTTP probe와 구분해 실행 기록에 남긴다.

기존 초안의 ‘전체 SQL180’은 지정된9파일 본문만201문장인 사실을 반영하지 못한 계수 오류였다. 이 수정은 migration·운영 변경을 추가하지 않는다. 현재 lockfile의 `readD1Migrations`로 확인한 아래 본문 수와 파일 해시를 고정하며, 변경되면 실행을 중단하고 계획을 다시 검토한다. 설치된 Wrangler의 `migrations apply`는 장부 `CREATE`1·`SELECT`1·파일별 `INSERT`9를 추가한다. 이11문장은 관리180 안에서 사용한다. 부작용이 있는 별도 `migrations list` 대신 사전 장부 읽기를 사용하고, 적용 종료코드만으로 성공을 판정하지 않는다.

| migration | 본문 SQL 수 |
| --- | ---: |
| 0050 | 29 |
| 0051 | 28 |
| 0052 | 27 |
| 0053 | 11 |
| 0054 | 24 |
| 0055 | 32 |
| 0056 | 22 |
| 0059 | 26 |
| 0060 | 2 |
| 합계 | 201 |

[로컬 소스 계수 기록](../evidence/b17-preparation-20261118/migration-cost.json)은 각 파일 해시·본문 SQL 수와 설치된 Wrangler 4.118.0의 장부 처리 근거를 남긴다. 원격 요청이나 migration 실행 결과가 아니다.

읽기 결과가 너무 크면 원래 필드·행을 잘라 통과시키지 않고 전체 비교가 가능한 수집 방식을 다시 설계한다. 무제한 재시도하거나 상한을 자동으로 올리지 않는다. 각 개별 계획의 중복 session/backup/RSI는 재사용한다. finally 정리 몫 D1 5회/관리 SQL12문장은 전체50회/180문장 안에 예약한다. 이 계획은 아직 검토안이며, 정정한 한도도 최종 PR 병합 전에는 원격 실행 권한이 아니다.

## NAVER 사용량 전환의 별도 확인

0053 직후에는 과거 미완전 집계 때문에 원자 quota가 HOLD다. 날짜가 바뀌었다는 이유로 근거 없이 해제하지 않는다. 원래 Worker가 종료됐다는 관측·새 원자 gate의 모든 호출 경로·migration 보존 증거를 확보하고 RUNNING NAVER 작업이 없음을 확인한 뒤에만 전환 기록을 준비한다. 과거 RUNNING을 임의 종료해 이 조건을 우회하지 않는다.

[#468 전환 도구](https://github.com/taejunyun1/Tasted_it/pull/468)의 `buildB17ProviderCutoverSql`을 사용한다. 전환 대상은 NAVER_LOCAL_SEARCH의 is_cutover_anchor=1 한 행이다. 현재 전체값을 고정하고, 현재 지정 ADMIN/유효 세션과 변경 전 NULL 근거값을 검증한다. 단 한 번의 감사와 같은 transaction에서 cutover_verified_at, 현재 UTC일과 anchor일보다 뒤인 첫 전체 UTC일 ready_after_utc_day, 증거 SHA-256 참조만 설정한다. 기존 추정/예약/전송 카운터·원래 anchor일·한도는 바꾸지 않는다. 완료 재전송은 중복 변경0, 불일치는 전체0이어야 한다. 적용 transaction에서 RUNNING NAVER 작업이 없음을 다시 검사하며, finally에서 이 계획의 정확한 trigger 두 개를 제거하고 잔존0을 확인한다. 실제 실행 시각·증거를 고정한 SQL의 검토/로컬 검증이 준비되지 않으면 HOLD를 유지한다.

이 전환은 기존 20,000/지역10,000 한도를 늘리지 않고 새 credential·provider를 도입하지 않는다. 지정한 전체 UTC일 이전에는 수집이 계속 차단된다. 공개 데이터와 별개인 NAVER 자동 호출은 그 시각 이후 기존 cron에서만 가능하며, 이 수동 live 검증에서는 호출하지 않는다. 운영 수용에는 실제 적용된 전환 근거·시각·현재 UI의 HOLD/READY가 일치해야 한다.

## 완료 기록

기능 PR/head, main SHA, 실제 Worker 버전, migration 해시와 적용/보존 결과, 합성 검증·운영 probe의 구분, 쿼터 전환 상태, 시험 잔존0을 SSOT/위키에 기록한다. 실제 복원·실제 메일 수신·현장 실증·정책 확정·전체 A01~34를 이 전환만으로 완료 처리하지 않는다. 문서-only 변경은 다시 배포하지 않는다.

[배포 재개 준비표](2026-11-18-admin-b17-readiness.md)는 기존 B10 스크립트 재사용 제한과 현재 로컬 검증/미실행 범위를 정리한다.

## 후속 실행 경로와 기존 요청 종료 확인

2026-11-18 재확인에서 전체 종료를 증명할 공개 Cloudflare API를 찾지 못했다. [격리 전환 검토안](2026-11-18-admin-b17-isolated-cutover.md)에 원본 보호·별도 후보 저장소·읽기부터 개방하는 대체 순서를 기록했다. 이 안의 새 자원·원본 보호·예산은 별도 검토 대상으로 남긴다.

`prepare`로 고정 소스·migration을 확인한다. 필수 CI를 통과한 통합 PR 병합 후 `preflight`로 현재 100% Worker·vars·D1/R2·두 cron과 pending을 확인한다. 기존 요청 전체를 확인할 수 있는 방법을 확보한 뒤, 같은 빌드의 점검 버전을 배포하고 5개 경로에서 503 및 no-store를 검증한다. 현재 B09에서 그 방법이 확보되지 않아 서비스 점검 전 단계가 HOLD다.

정상 동작 확인의 기준 입력은 운영 버전 조회에서 얻은 이전 Worker 버전과 100% 점검 버전, 점검 deployment 시각(UTC), 빌드 SHA-256, 9개 migration 이름/해시의 SHA-256이다. 원본 입력과 checkpoint는 저장소 밖 동일 0700 폴더의 0600 파일로 다룬다. 예상 시점과 버전의 불일치, 변경된 빌드나 장부, 종료 근거 부족은 후속 경로에서 차단한다. 입력 파일의 임의 증명값으로 진행할 수 없다.

```sh
node scripts/b17-rollout-runner.mjs prepare
node scripts/b17-rollout-runner.mjs preflight --private-dir "$B17_PRIVATE_DIR" --input "$B17_PRIVATE_DIR/input.json"
node scripts/b17-rollout-runner.mjs continue --private-dir "$B17_PRIVATE_DIR" --input "$B17_PRIVATE_DIR/input.json" --checkpoint "$B17_PRIVATE_DIR/checkpoint.json"
```

- 기존 요청 관측은 현재 승인된 자격으로 Observability keys와 events를 최대 한 번씩 조회한다. Worker 이름·이전 버전 ID·invocation 유형을 고정하고 최대30분/100행/1MiB/요청당10초를 적용한다. 로그 원문·헤더·URL은 출력하지 않고 요청 종류·종료 결과·점검 이후 명시 종료 건수와 누락 가능성만 보고한다. 조회 거부와 불완전 응답도 HOLD다. [Cloudflare Observability API](https://developers.cloudflare.com/api/resources/workers/subresources/observability/subresources/telemetry/methods/query/)
- B09의 입구 점검을 이미 통과한 요청은 R2 삭제·업로드 또는 D1 변경을 이어갈 수 있다. Worker 교체 시각, 마지막 로그, 샘플링이 없는 조회, Cron 15분 경과는 그 요청 집합을 열거하지 못한다. 정기 런타임 업데이트의 최대 20분 grace period도 별도 플랫폼 동작이다. [Workers 실행 한도](https://developers.cloudflare.com/workers/platform/limits/#duration), [실시간 로그](https://developers.cloudflare.com/workers/observability/logs/real-time-logs/#limits)
- 전환을 열려면 Cloudflare에서 이전 버전에 대한 새 요청 차단 시각, HTTP·cron·waitUntil의 모든 실행 종료 또는 취소, 이미 발행된 D1/R2 작업의 종료를 확인할 수 있는 근거가 필요하다. 계정·Worker·버전 쌍·점검 UTC에 결속된 근거를 기존 지원 경로에서 확인한다. 공개 API에서 이 보장을 제공하는 응답은 확인하지 못했다. 향후 인증된 근거 수집 경로가 추가되기 전까지 네이티브 판정은 UNKNOWN이다. 서명처럼 보이는 입력 필드나 수동 문서는 실행 권한을 부여하지 않는다.

`continue`는 종료 판정 뒤 bookmark·비공개 export, 기존82표 보존 수집, 고정9 migration, 적용 장부·보존·FK/초기값 대조, 단일 임시 ADMIN·한정 읽기와 거절 검증·RSI·정확 ID 정리를 순서대로 연결한다. export 반복은 동일 bookmark에서 최대3회로 제한한다. 초기 준비 단계의 가상 비용과 별도로 실제 단계별 요청을 계수한다. SQL/보존 raw는 저장소 밖에서만 다룬다. 정상 배포를 시도한 뒤 확인이나 정리가 실패하면 같은 소스의 점검 상태 복구를 시도하고 결과를 기록한다. 부분 migration 및 불명확한 쓰기는 원장·증거를 조사한다.

공공 대기 전환을 포함하면 현재 실제 전체 스냅샷의 검토된 SHA-256이 checkpoint와 일치해야 한다. 새 NAVER anchor 시각은 0053 적용 때 생성되므로 합동 실행에서는 quota HOLD를 유지한다. 후속 APPLY는 실제 anchor를 검토한 뒤 기존 [NAVER 전환 도구 절차](2026-11-18-b17-provider-cutover.md)를 따른다.


## UI 후속 합류 — #471 / #472

최종 통합에는 #472의 인증/저장·지도 읽기 복구·평가 근거·공개 목록/metadata·접근성과 ADMIN 결과/제안 페이지 보완 `0644633`도 포함한다. UI와 기존 B17의 평가 설정 적용일을 함께 유지하며, 별도 Worker/배포 창이나 신규 migration은 추가하지 않는다.

기존 7단계의 정상 배포 확인에서 공개 홈·목록·한정 카테고리 지도·상세·로그인 복귀 입력·sitemap의 문서/정적 파일을 읽고, 기존 ADMIN 세션으로 수정된 검수/회원 제안·표·403 경계를 확인한다. 이 확인은 앞서 정한 HTTP90 전체 한도 안에서 배분하며 자동 확대하지 않는다. 공개 목록 페이지를 사용할 수 없는 경우 존재하지 않는 결과를 만들지 않고 빈 페이지의 복귀/noindex를 확인한다.

UI 확인을 위해 실제 저장·투표·메일/외부 OAuth·Golden Pick 요청·새 위치 권한이나 임의 운영 계정을 발급하지 않는다. 로컬 합성 양성/경합/응답 유실 증거와 실제 운영 읽기/거절 확인은 계속 구분한다. #472를 구성 변경으로 포함한 최종 #470 head의 필수 CI가 성공하기 전에는 병합·운영 적용을 하지 않는다.
