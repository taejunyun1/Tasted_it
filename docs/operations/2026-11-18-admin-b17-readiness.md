# B17 배포 재개 준비표

2026-11-18 · #460 / #470. 사용자는 GitHub 결제·Actions 한도를 지금 복구하기 어렵다고 밝혔고, 운영자 명칭·문의처·보관/삭제 기간은 미정으로 유지했다. 이 문서는 배포 준비를 위한 로컬 검증과 재개 조건을 구분한다. CI 우회·운영 배포·원격 SQL·실제 정리 작업은 수행하지 않는다.

## 도구 지원 범위와 남은 중단점

전체 기존 HTTP·R2 작업의 종료를 확정할 공개 API는 11/18 재확인에서도 발견하지 못했다. 별도 후보 D1·R2에 격리하는 [대체 전환 검토안](2026-11-18-admin-b17-isolated-cutover.md)을 작성했다. 원본 D1의 82표 장벽과 오류 시 전량 철회는 로컬 검증 범위다. 실제 쓰기 종료 판정과 현행 runner HOLD를 유지한다.

- `b17-preservation-evidence.mjs`: 실제 0049 D1 schema에서 추출한 기존82개 테이블·853개 열과 schema object hash를 기준으로 전체 원장을 수집·비교한다. 기존 열·rowid·SQLite 자료형을 보존하며, 학생 권한/업무·원시 평가·사진 권리·설정·감사도 포함한다. 새로운9개 테이블의 존재와 schema는 전환 후 catalog로 확인하되 새 기본값·권한/trigger 검증은 기존 B17 리허설과 구분한다.
- `b17-rollout-runner.mjs prepare`: 네트워크 없이 파일 해시·고정201 SQL·수집 비용·실행 한도를 점검한다.
- `preflight`는 병합된 소스와 해당 PR head의 CI, 실제 현재 설정·binding·cron·pending을 읽는다. B09의 HTTP/R2 종료를 확정할 방법이 없어 `LIVE_HTTP_DRAIN_OBSERVATION_REQUIRED`로 보류한다.
- `continue`는 확인된 점검 버전에서 백업·원장 보존·migration·정상 배포 확인·정리를 잇는 코드다. 현행 네이티브 판정은 기존 요청을 최대 두 번의 Observability 조회로 관측하며 UNKNOWN을 반환한다. 로컬 검증은 HTTP/Cloudflare 전송을 대체하고 실제 D1 SQL을 실행했다. [운영 순서](2026-11-18-admin-b17-rollout.md#후속-실행-경로와-기존-요청-종료-확인)
- 초기 `rehearseB17Lifecycle` 회귀의 단계·할당 검증과 새 continuation의 실행 검증을 각각 기록한다. 배포 및 shutdown 근거를 확인하기 전 서비스 점검 시작을 보류한다.

## 지금 실행할 수 있는 로컬 확인

```sh
pnpm test:integration tests/integration/b17-rollout-rehearsal.test.ts
pnpm test:integration tests/integration/b17-preservation-evidence.test.ts
pnpm test tests/unit/b17-rollout-evidence.test.ts tests/unit/b17-preservation-evidence.test.ts tests/unit/b17-rollout-runner.test.ts
pnpm test tests/unit/b17-drain-evidence.test.ts tests/unit/b17-rollout-continuation.test.ts
pnpm test:integration tests/integration/b17-rollout-continuation.test.ts tests/integration/b17-continuation-*.test.ts
node scripts/b17-rollout-evidence.mjs manifest --root .
node scripts/b17-rollout-runner.mjs prepare --root .
```

manifest는 현재 checkout의 0050/0051/0052/0053/0054/0055/0056/0059/0060 파일과 커밋된 같은 파일의 SHA-256을 비교한다. 지정 목록 밖의 신규 migration, 누락 또는 커밋과 다른 내용은 통과로 처리하지 않는다. 이 출력은 `LOCAL_PREPARATION`, `executed:false`이며 원격 적용 상태를 뜻하지 않는다.

전체 보존은 `verifyB17PreservationSources`로 모든 migration 소스를 확인한 뒤 `buildB17PreservationCatalogQuery` → `planB17PreservationCapture` → `collectB17PreservationSnapshot` → `compareB17PreservationSnapshots` 순서로 실행한다. 전후 catalog를 각각 검증하며 caller의 `complete:true`나 줄인 projection을 신뢰하지 않는다. 각 시점에 catalog1회+수집7회, 전후 총16 D1 요청/관리 SQL이다. 최대12표/SQL90KiB의 묶음이며 실제 D1에서 compound SELECT 한도를 넘던 초안은 bounded `json_each` 방식으로 바꿨다.

상한은 표당10,000행·전체50,000행·셀256KiB·묶음10,000행/4MiB·전체64MiB다. 초과·누락·중복 rowid·잘린 응답은 실패한다. 64bit 정수는 문자열, BLOB은 hex로 비교하고 원문 값 대신 표별 건수/digest·불일치 위치만 보고한다. 원문 snapshot은 저장소 밖0700 디렉터리/0600 파일로만 보관한다. runtime catalog나 실제 행 없이 offline 비용 설명만으로 보존 PASS를 만들지 않는다.

아래 기존 `compare` 명령은 이전7개 재구성 표 형식의 호환 도구로 유지한다. **전체 원장 보존을 대신하지 않는다.**

```sh
node scripts/b17-rollout-evidence.mjs compare \
  --before /private/path/before.json \
  --after /private/path/after.json
```

출력은 테이블명·건수·digest·불일치 위치만 포함한다. 원문 값은 출력하지 않는다. 차이가 있으면 종료코드1, 형식이나 상한이 맞지 않으면 종료코드2다. 입력 JSON은 저장소 밖의 0700 디렉터리/0600 파일로 다루고 Git에 넣지 않는다. 최대 테이블당10,000행·전체50,000행·스칼라64MiB이며 초과를 잘라서 통과시키지 않는다.

- 재구성되는 7개 테이블: `admin_operations`, `admin_operation_commits`, `admin_operation_checks`, `rating_recompute_jobs`, `public_data_sync_runs`, `parking_sync_runs`, `reviewer_photo_cleanup_jobs`.
- 로컬 연속 적용 리허설에서 함께 보존을 확인하는 11개 테이블: users, sessions, places, rating_configs, rating_snapshots, reviewer_visit_reviews, vote_events, current_votes, parking_data_snapshots, naver_local_category_runs, admin_audit_logs.
- 리허설은 빈 테이블 통과를 피하도록 위 11개에도 합성 행을 넣는다. 9개 migration 후 기존 열·rowid·값, FK, 불변 영수증, 모든 작업 종류, 새 열 기본값, quota 초기 HOLD와 마지막 publication trigger를 확인한다.

이전18개 테이블의 합성 리허설은 원래 범위의 증거로 유지한다. 새 전체82표 비교도 합성 로컬 검증이며 실제 운영 DB 복원 시험이 아니다. 실제 전환의 보존 범위와 입력 자료는 [B17 운영 계획](2026-11-18-admin-b17-rollout.md)을 따르며, 원격 적용 전 현재 데이터로 다시 비교해야 한다.

## 기존 B10 스크립트의 재사용 제한

기존 비공개 B10 스크립트는 3개 migration, 과거 Worker 버전, 3개 관리 화면을 전제로 만든 도구다. 그대로 B17에 실행하지 않는다. 재개 시에는 다음 항목이 모두 반영된 실행본만 사용한다.

| 확인 | 완료 조건 |
|---|---|
| 코드/환경 고정 | 실제 merged main·정확한 통합 CI head·현재 Worker 버전·설정/binding/2개 cron 일치 |
| migration 고정 | 지정9개 pending 목록 및 현재 manifest 해시 일치, 그 밖의 pending이 있으면 중단 |
| 보존 대상 | 새82표/853열 collector의 정확한 runtime catalog·동일 projection·typed rowid/값 비교. 실제 운영 비교는 미실행 |
| 한도 원장 | 애플리케이션 HTTP90·D1 요청50·관리 SQL180(장부11 포함)·고정9파일 본문 SQL201, SQL 총381. CLI 내부 요청도 계수. 제어 API 호출은 별도 기록. export1·migration9·임시세션1·RSI1 별도 계수 |
| 정리 예약 | 최종 정리에 D1명령5/SQL12를 남김. 잔여량이 부족하면 새 변경을 시작하지 않음. 예약은 전체 한도 안의 몫 |
| 전체 finally | 세션 생성 전 정확 ID를 비공개 저장. 응답 유실과 정상 배포 후 확인 실패에서 임시 세션/대기/등록 trigger를 정확히 정리하고 동일 빌드의 점검 상태 복구를 시도. 운영 실행은 미확인 |
| drain 증거 | 이번 fence 버전·시각에 연결된 관측. 외부 JSON의 `safeToMigrate:true` 값만 믿지 않음 |

초기 offline 할당 계산은 준비 증거에 남겼다. 새 후속 경로는 실제로 실행할 요청마다 계수하고, 시작 전 D1 정리 몫5회·관리 SQL12문장을 예약한다. export는 동일 작업을 최대3번 조회하며, 정리 몫을 포함해 D1 50회·SQL381문장·HTTP90회 상한을 적용한다.

정상 로컬 시나리오의 계수는 사전 점검·점검 probe·정리 몫을 포함해 D1 46회, 관리 SQL59문장, migration 본문201문장, HTTP39회다. D1은 실제 로컬 SQL, HTTP와 플랫폼 응답은 대체 전송이며 export의 D1 4회는 bookmark 및 최대 3회의 예약치다. 이전 버전 종료·실제 export 응답·RSI 로그의 운영 관측은 별도로 확인한다. [검증 증거](../evidence/b17-continuation-20261118/summary.json)

## live 검증에서 구분할 증거

관리자 임시 세션 1개만 만든다. 익명 거절과 ADMIN 읽기는 live에서 확인한다. 일반회원403은 별도 기존 회원 세션을 사용하는 범위를 승인·확보하지 않는 한 로컬 증거로 남기고 live에서는 `NOT_RUN`으로 표시한다. 익명302를 일반회원403 검증으로 쓰지 않는다.

새 화면은 providers, settings, privacy, reliability, rating-config, records, email-domain, lifecycle 및 기존 B10 작업 화면을 포함한다. 읽기·입력 거절·미확정 미리보기·최근 인증 없는 확정 거절만 확인하며, 실제 사용자 변경·사진 삭제·메일·수동 유료 요청은 하지 않는다.

RSI는 전체 감사 건수의 단순 `+1`로 판정하지 않는다. 요청 시작/종료 UTC, 이번 임시 ADMIN, `action=RSI_SELF_CHECK`, `target_type=OPERATIONS`, `target_id=rsi-admin`에 맞는 단 한 행을 찾아 payload의 `trigger=admin`, `ok=true`, 고정6경로 결과를 확인한다. 같은 창의 Worker 로그에서 정확 배포 버전과 정상 종료를 함께 확인한다. 예정 cron의 다른 기록은 별도로 남긴다.

NAVER 전환은 [검증된 전환 도구](2026-11-18-b17-provider-cutover.md)만 사용한다. 현재 anchor 전체값·권한·시각·RUNNING0을 적용 transaction에서 검사하며 기존 카운터를 유지한다. 실패·중복·원격 결과불명에 임의 UPDATE로 대응하지 않는다.

## 아직 실행하지 않은 항목

필수 GitHub CI 재개, main 병합, 현재 운영 원장 사전조회/백업, fence/drain, 9개 원격 migration, 기존 대기·quota의 한정 전환, 정상 배포, live 확인과 정리는 모두 미실행이다. 운영자/연락처/보존 정책은 `정책 확인 필요`, #397은 HOLD다.
