# B17 배포 재개 준비표

2026-11-18 · #460 / #470. 사용자는 GitHub 결제·Actions 한도를 지금 복구하기 어렵다고 밝혔고, 운영자 명칭·문의처·보관/삭제 기간은 미정으로 유지했다. 이 문서는 배포 준비를 위한 로컬 검증과 재개 조건을 구분한다. CI 우회·운영 배포·원격 SQL·실제 정리 작업은 수행하지 않는다.

## 지금 실행할 수 있는 로컬 확인

```sh
pnpm test:integration tests/integration/b17-rollout-rehearsal.test.ts
pnpm test tests/unit/b17-rollout-evidence.test.ts
node scripts/b17-rollout-evidence.mjs manifest --root .
```

manifest는 현재 checkout의 0050/0051/0052/0053/0054/0055/0056/0059/0060 파일과 커밋된 같은 파일의 SHA-256을 비교한다. 지정 목록 밖의 신규 migration, 누락 또는 커밋과 다른 내용은 통과로 처리하지 않는다. 이 출력은 `LOCAL_PREPARATION`, `executed:false`이며 원격 적용 상태를 뜻하지 않는다.

보존 비교는 다음 형식의 비공개 JSON 두 파일을 읽는다. `tables`에는 아래 7개 테이블을 모두 넣고 `columns`에는 0049의 기존 열 전체와 `rowid`를 넣는다. `rows`는 그 열들의 실제 값이다. 수동으로 열을 줄이거나 값·rowid를 재작성하지 않는다.

```sh
node scripts/b17-rollout-evidence.mjs compare \
  --before /private/path/before.json \
  --after /private/path/after.json
```

출력은 테이블명·건수·digest·불일치 위치만 포함한다. 원문 값은 출력하지 않는다. 차이가 있으면 종료코드1, 형식이나 상한이 맞지 않으면 종료코드2다. 입력 JSON은 저장소 밖의 0700 디렉터리/0600 파일로 다루고 Git에 넣지 않는다. 최대 테이블당10,000행·전체50,000행·스칼라64MiB이며 초과를 잘라서 통과시키지 않는다.

- 재구성되는 7개 테이블: `admin_operations`, `admin_operation_commits`, `admin_operation_checks`, `rating_recompute_jobs`, `public_data_sync_runs`, `parking_sync_runs`, `reviewer_photo_cleanup_jobs`.
- 로컬 연속 적용 리허설에서 함께 보존을 확인하는 11개 테이블: users, sessions, places, rating_configs, rating_snapshots, reviewer_visit_reviews, vote_events, current_votes, parking_data_snapshots, naver_local_category_runs, admin_audit_logs.
- 리허설은 빈 테이블 통과를 피하도록 위 11개에도 합성 행을 넣는다. 9개 migration 후 기존 열·rowid·값, FK, 불변 영수증, 모든 작업 종류, 새 열 기본값, quota 초기 HOLD와 마지막 publication trigger를 확인한다.

이 18개 테이블의 합성 리허설은 전체 운영 DB 복원 시험이 아니다. 실제 전환의 보존 범위와 입력 자료는 [B17 운영 계획](2026-11-18-admin-b17-rollout.md)을 따르며, 원격 적용 전 현재 데이터로 다시 비교해야 한다.

## 기존 B10 스크립트의 재사용 제한

기존 비공개 B10 스크립트는 3개 migration, 과거 Worker 버전, 3개 관리 화면을 전제로 만든 도구다. 그대로 B17에 실행하지 않는다. 재개 시에는 다음 항목이 모두 반영된 실행본만 사용한다.

| 확인 | 완료 조건 |
|---|---|
| 코드/환경 고정 | 실제 merged main·정확한 통합 CI head·현재 Worker 버전·설정/binding/2개 cron 일치 |
| migration 고정 | 지정9개 pending 목록 및 현재 manifest 해시 일치, 그 밖의 pending이 있으면 중단 |
| 보존 대상 | 재구성7개뿐 아니라 사용자 권한·학생 seat/업무·원시표·설정·감사 등 승인된 원장을 같은 projection으로 비교 |
| 한도 원장 | 읽기와 mutation·D1 관리 명령을 모두 HTTP90/D1명령50/SQL180에 합산. export1·migration9·임시세션1·RSI1 별도 계수 |
| 정리 예약 | 최종 정리에 D1명령5/SQL12를 남김. 잔여량이 부족하면 새 변경을 시작하지 않음. 예약은 전체 한도 안의 몫 |
| 전체 finally | 임시 세션 생성 직후부터 대기 전환·quota 전환·live 확인 전체를 finally로 감싸고 이번 정확 ID만 정리 |
| drain 증거 | 이번 fence 버전·시각에 연결된 관측. 외부 JSON의 `safeToMigrate:true` 값만 믿지 않음 |

## live 검증에서 구분할 증거

관리자 임시 세션 1개만 만든다. 익명 거절과 ADMIN 읽기는 live에서 확인한다. 일반회원403은 별도 기존 회원 세션을 사용하는 범위를 승인·확보하지 않는 한 로컬 증거로 남기고 live에서는 `NOT_RUN`으로 표시한다. 익명302를 일반회원403 검증으로 쓰지 않는다.

새 화면은 providers, settings, privacy, reliability, rating-config, records, email-domain, lifecycle 및 기존 B10 작업 화면을 포함한다. 읽기·입력 거절·미확정 미리보기·최근 인증 없는 확정 거절만 확인하며, 실제 사용자 변경·사진 삭제·메일·수동 유료 요청은 하지 않는다.

RSI는 전체 감사 건수의 단순 `+1`로 판정하지 않는다. 요청 시작/종료 UTC, 이번 임시 ADMIN, `action=RSI_SELF_CHECK`, `target_type=OPERATIONS`, `target_id=rsi-admin`에 맞는 단 한 행을 찾아 payload의 `trigger=admin`, `ok=true`, 고정6경로 결과를 확인한다. 같은 창의 Worker 로그에서 정확 배포 버전과 정상 종료를 함께 확인한다. 예정 cron의 다른 기록은 별도로 남긴다.

NAVER 전환은 [검증된 전환 도구](2026-11-18-b17-provider-cutover.md)만 사용한다. 현재 anchor 전체값·권한·시각·RUNNING0을 적용 transaction에서 검사하며 기존 카운터를 유지한다. 실패·중복·원격 결과불명에 임의 UPDATE로 대응하지 않는다.

## 아직 실행하지 않은 항목

필수 GitHub CI 재개, main 병합, 현재 운영 원장 사전조회/백업, fence/drain, 9개 원격 migration, 기존 대기·quota의 한정 전환, 정상 배포, live 확인과 정리는 모두 미실행이다. 운영자/연락처/보존 정책은 `정책 확인 필요`, #397은 HOLD다.
