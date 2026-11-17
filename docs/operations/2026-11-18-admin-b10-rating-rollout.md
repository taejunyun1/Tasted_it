# B10 평가 작업 제어 배포 — 2026-11-18

상태: IMPLEMENTING / 운영 미실행. #442의 첫 작업 단위다. 담당은 Codex(root 통합·운영), b10_backend(서비스·0050·D1), b10_ui(화면·E2E)다. 기존 B09 운영을 유지하며 #397은 HOLD다.

## 적용 범위

평가 재계산만 대상으로 한다. PENDING 취소, 실패 작업 최대 3회 시도, 실행 시 10분 lease, lease가 만료된 새 작업의 복구를 지원한다. 실행 중 취소는 하지 않는다. lease 없는 과거 RUNNING은 결과불명으로 남기며 강제 재시도하지 않는다. attempt 기반 조건을 모든 평가 snapshot 변경에 결속하여 이전 실행이 복구 이후 결과를 쓰지 못하게 한다. 기존 수동과 cron은 같은 claim 경로를 사용한다.

각 변경은 현재 ADMIN·세션, 최근 재인증, 대상 상태/시도/lease 및 현재 설정을 확인한 B02 preview/commit과 감사 영수증을 사용한다. 새로운 provider·binding·cron·dependency는 없다. B10의 공공데이터·주차/EV 작업은 별도 순차 단위이며 이 PR의 완료로 표시하지 않는다.

## 필수 검증

- 실제 D1에서 동시 claim, 대기 취소와 claim 경합, 실패 상한, 만료/과거 lease 구분, 이전 attempt의 쓰기 차단, 상태 변경 후 preview 거절, 재인증·동일 영수증 재조회 및 감사 조회를 확인한다.
- 0050은 0049 이후 데이터가 들어 있는 DB에 적용해 작업·operation/commit/check의 기존 rowid/필드·FK와 guard 보존을 검증한다.
- 타입·빌드, 관련 desktop/mobile E2E 및 저장소 필수 4CI와 독립 diff 검토 후 squash merge한다. 관련 없는 로컬 전체 suite 반복은 하지 않는다.

## 운영 대상과 한도

기존 계정 `7543330c65069ee2df1b7b353fb0201c`, Worker `retaste-beta`, D1 `retaste-production` (`5181489d-83a7-4f78-9384-db096cadaa2d`)만 사용한다. 기존 R2·두 cron·flag·provider 설정은 보존한다. 원문 증거는 비공개 0700 디렉터리/0600 파일, 공개 문서는 요약·hash만 사용한다.

수동 HTTP 45회, D1 데이터/관리 명령 30회·SQL 조회 100개, export 1개, 신규 migration 1개, 고유 임시 ADMIN 세션 1개(최대 30분), RSI 1회가 상한이다. 실제 평가 재계산·취소·복구, 신규 사용자, 재인증 보증 생성, 메일·외부 유료 호출은 0이다. 기존 감사로 지정된 인증·미제한 ADMIN을 사용할 수 없으면 변경을 멈춘다.

## 전환 순서

1. 병합된 main을 primary checkout에서 빌드한다. 현재 운영 버전/설정, 0050만 pending인지, 계정·DB·두 cron이 일치하는지 확인한다. pnpm audit와 dry-run 결과를 기록한다.
2. 같은 빌드 설정에서 `CST_MAINTENANCE=true`, `assets.run_worker_first=true`만 바꾼 fence를 배포한다. 공개·로그인·ADMIN·정적·RSI 503/no-store를 확인한다.
3. 최소 60초 drain한다. 가능한 저장 Observability를 우선 사용한다. 연결 앱이 다른 계정만 제공하거나 조회 권한이 없으면 기존 CLI 인증의 bounded Wrangler tail JSON으로 전환한다. 알려진 이전 요청 종료와 두 cron의 마지막 시작 가능 시점+최대 15분 경계를 확인한다. HTTP 전체가 60초에 종료된다고 간주하지 않는다. 미확인 진행 작업이 관측되면 DB 전환을 보류한다.
4. Time Travel 정보와 export 한 개를 확보한다. 평가 작업·snapshot·원시표·회원·권한·operation/commit/check/감사의 정렬 digest와 핵심 건수를 보관한다. 백업을 실제 복원 성공으로 표현하지 않는다.
5. 0050을 한 번 적용한다. 기존 필드/rowid hash 동일, 추가 lease NULL, FK 위반 0, pending 0을 확인한다. 새 빌드의 정상 설정을 100% 배포한다.
6. 한정 live를 확인하고 finally에서 임시 세션과 그 세션에 묶인 PENDING만 정확 ID로 정리한다. 기존 감사와 확정 이력은 삭제하지 않는다.

## 한정 live

익명 ADMIN 거절, 인증된 평가 화면·단일 job 조회·B06 새 kind 필터, 잘못된 ID/교차 출처 요청 거절, no-store, 공개 페이지/사진을 확인한다. 안전한 기존 PENDING/FAILED가 있으면 변경 없는 preview와 최근 재인증 없는 확정 거절만 확인한다. 대상이 없으면 임의 운영 job을 만들지 않고 빈 상태를 기록한다. RSI ADMIN POST 1회로 고정 6경로와 정확 배포 버전의 정상 종료·감사 1행을 대조한다.

## 장애·종료 조건

0050 이후 이전 runtime은 attempt fence를 알지 못한다. 일반 운영 상태로 이전 버전을 재개하지 않는다. 불일치 시 새 schema를 이해하는 maintenance fence를 유지하고 전진 수정한다. DB 전체 복원·R2 삭제·권한 확대는 포함하지 않는다. 운영 결과는 SSOT와 기존 위키에 반영하고 문서 결과 PR 자체는 재배포하지 않는다. B11~B17 및 B10의 다른 작업 계열은 남은 범위로 유지한다.
