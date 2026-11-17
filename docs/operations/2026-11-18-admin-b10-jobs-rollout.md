# B10 평가·공공·주차/EV 합동 전환

2026-11-18 · #442 / #443 / #445. 세 PR을 순차 병합한 main에서 **한 번의 maintenance 구간**으로 0050–0052를 순서대로 적용한다. 개별 로컬 검증과 필수 CI/독립 리뷰는 각각 유지한다. 평가 전용 계획의 0050 단독 전환을 이 합동 범위로 대체한다.

담당은 Codex(root 통합·운영), 평가/주차 backend와 공공 sync worker, UI worker다. #397은 HOLD다. 아직 운영 미실행이다.

## 수용한 기능 범위

- 평가: 정확 job의 대기 취소·실패 재시도·만료 lease 복구, 동일 job 최대 3회. 모든 snapshot 쓰기는 현재 attempt 조건. 과거 무임대 RUNNING은 결과 불명·강제 재개 금지.
- 공공 인허가: source/address 허용목록, 원자 claim, 페이지 전체 transaction/checkpoint, 최대 5페이지·요청별 최대 3회, 취소 뒤 새 grant/쓰기 차단. 과거 무임대 RUNNING이 있으면 새 공공 수집을 시작/재개하지 않는다. 취소 대상은 공공 인허가 수집이며 독립 NAVER 검증·자동 검수는 대상이 아니다.
- 주차/EV: source별 현재 attempt/lease만 staging 및 ACTIVE 전환, 실패·취소 시 기존 ACTIVE 유지. 누락/짧은 페이지·전체 건수 변동/불완전 EV 지역·기존 70% 품질 기준 거부. 현재 원천 범위/cron/90일 정기 주기는 유지하되 명시 PENDING은 다음 기존 cron에서 처리한다. 접수와 수집 완료를 구분한다.
- 관리자 변경은 현재 ADMIN·세션·최근 재인증·preview/CAS·감사 영수증을 사용한다. 신규 서비스/secret/권한 확대/cron/dependency는 없다.

## 전환 대상과 제한

기존 계정 `7543330c65069ee2df1b7b353fb0201c`, Worker `retaste-beta`, D1 `retaste-production` (`5181489d-83a7-4f78-9384-db096cadaa2d`)만 대상이다. 최초 관측 정상 version은 `d285759b-d529-4ea0-a7e9-9cf88b3e7cf1` 100%이며, 실행 직전 다시 확인한다. 예기치 않은 변경은 원인 확인 전 중단한다.

수동 HTTP 최대 60회, D1 데이터/관리 명령 40회·실제 SQL 조회 120개, export 1개, 지정 migration 3개, 고유 임시 ADMIN 세션 1개(최대 30분), RSI 1회가 한도다. 아래의 과거 대기 1건 상태 전환을 제외한 실제 평가/공공/주차/EV job 실행·취소·복구, 새 사용자, 재인증 보증 생성, 메일, 유료 외부 호출은 0이다. 읽기 또는 변경 없는 preview가 가능한 운영 대상이 없으면 임의 job을 생성하지 않고 미실행을 기록한다.

## 절차

1. 세 기능의 정확 최종 head 필수 4CI와 독립 diff 리뷰 통과 후 순차 squash merge. primary main을 업데이트하고 frozen lock build/audit, 현재 설정/binding/두 cron 대조, dry-run 확인. 대상 pending migration은 0050/0051/0052만 허용한다.
2. 같은 build 설정에서 CST_MAINTENANCE=true와 assets.run_worker_first=true만 바꿔 fence 배포. 공개/로그인/관리자/정적/RSI가 503·no-store인지 확인.
3. 최소 60초 drain. 저장 Observability를 우선하되 연결 앱이 대상 계정을 제공하지 않거나 조회 권한이 없으면 기존 인증의 bounded Wrangler tail JSON을 사용한다. 관측된 이전 요청 종료와 두 cron의 마지막 시작 가능 시각 + 최대 15분 경계를 확인한다. 과거 HTTP 전체가 60초에 종료됐다고 간주하지 않으며 미확인 진행 작업이 있으면 전환 보류.
4. TimeTravel 정보·export 1개(비공개 0700/0600) 확보. 기존 rowid/필드의 정렬 digest와 건수: admin_operations/commits/checks, rating_recompute_jobs/snapshots, public_data_sync_runs, parking_sync_runs/data_snapshots/facilities, ev_charging_stations/parking_ev_links, users 권한, places/reviewer 원장/감사. 새 열을 제외한 기존 필드 투영으로 전후 비교한다. 백업은 실제 복원 검증과 구분한다.
5. 지정 3 migration을 순서대로 한 번 적용. 기존 필드/rowid와 권한·감사 보존, 과거 job lease NULL, 신규 guard 비어 있음, FK 0, pending 0 확인. 실패 시 fence 유지·전진 수정한다. 아래에 명시한 과거 대기 1건의 확인된 전환 외에는 기존 무임대 job을 강제로 상태 변경하지 않는다.
6. 같은 main의 정상 설정을 100% 배포하고 공개 화면/상세/사진·익명 ADMIN 차단 확인. 감사로 지정된 인증·비탈퇴·미제한 ADMIN에 고유 임시 세션 1개(아래의 대기 작업 전환에 사용한 세션을 그대로 재사용)로 세 관리 경로 조회, 입력 오류/교차 출처 거절, no-store, 신규 kind 감사 조회 확인. 기존 대상의 비변경 preview와 재인증 없는 확정 거절만 검증한다.
7. 기존 ADMIN RSI POST 1회로 고정 6경로·같은 Worker 버전 정상 종료·감사 1행을 대조한다. finally에서 이번 세션 및 이에 묶인 PENDING만 정확 ID로 정리하고 잔존 0 확인. 기존 감사/완료 영수증은 삭제하지 않는다.
8. 실제 버전, main SHA, migration, 전후 hash/건수, 합성/운영 증거와 미실행 경계를 SSOT·기존 위키에 기록한다. 결과 문서만 바뀐 PR은 재배포하지 않는다.

## 실패 시

0050 이후 이전 런타임은 새 attempt fence를 모른다. 일반 운영으로 구버전을 재개하지 않고 새 schema를 이해하는 maintenance fence를 유지한 채 전진 수정한다. DB 전체 복원·R2 삭제·외부 발신·권한 확대는 이 범위에 없다. B10의 허용된 작업 제어를 전체 ADMIN·전체 실증·실제 복구 성공으로 확대하지 않는다. 다음은 SSOT 순서 B11이며 미확정 법적/정책 사실은 별도 유지한다.

## 확인된 과거 대기 작업 1건의 전환

사전 조회에서 참조 `c0bfc95dbcd7`인 공공 수집 작업 1건을 확인했다. `REST_CAFE` / `LOTNO_ADDR`, 최종 기록은 `2026-11-16T18:17:56.570Z`, 다음 페이지는 71, 누적 수집은 7,000/39,416건이다. 과거 `syncPublicDataBatch`는 5페이지를 마친 뒤 다음 cron을 기다리는 상태도 `RUNNING`으로 저장했다. 새 코드에서는 무임대 `RUNNING`을 임의 재개하지 않으므로, 이 기존 대기를 그대로 두면 새 수집이 차단된다.

이 한 건에 대해서만 다음 예외를 수용한다. 먼저 maintenance fence와 이전 실행 종료를 확인하고, 0050–0052 적용 전후의 기존 값·rowid 보존을 검증한다. 그 후 감사로 지정된 운영자에 고유 30분 세션을 한 번만 만들고, 정상 배포 후 live 검증에도 같은 세션을 재사용한다. `scripts/b10-legacy-public-resume.mjs`로 현재 ADMIN·유효 세션·해당 행의 전체 고정값·무임대/미실행 상태를 검사하는 일회성 감사 trigger 두 개(입력·재실행 검사, 상태 전환)를 만든다. 동일 감사 INSERT 트랜잭션 안에서 감사와 `RUNNING → PENDING`, 갱신시각만 원자적으로 반영한다. 기존 시작시각·다음 페이지·누적 건수·출처·자료는 보존한다. 다른 행은 변경하지 않는다.

운영자는 실제 이전 Worker 버전, fence 버전, drain 관측의 SHA-256을 입력한다. 조건 불일치 시 감사와 상태 모두 적용하지 않으며, 같은 marker를 재전송해도 중복 적용하지 않는다. finally에서 일회성 trigger 두 개를 모두 삭제하고 잔존 0을 확인한다. 전환 전후 hash의 허용 차이는 이 한 행의 상태/갱신시각과 감사 1행뿐이다. 이 작업은 외부 수집 실행이나 과거 수집 결과의 성공 판정이 아니다. 새 코드의 일반 ADMIN 경로는 여전히 과거 무임대 실행의 재개·취소를 거절한다.
