# B17 NAVER 사용량 전환 SQL 생성

#467. 이 문서는 #455의 미검증 quota HOLD를 해제할 수 있는 근거 기록을 준비하는 한정 절차다. `scripts/b17-provider-cutover.mjs`는 SQL 문자열을 생성할 뿐 파일·DB·네트워크에 접근하지 않는다. 실제 실행은 최종 B17 합동 계획을 포함한 PR의 병합과 필수 CI 이후 root만 수행한다. 이 기능 개발에서는 원격 SQL·공급자 호출·운영 변경을 실행하지 않는다.

## 고정 입력과 변경 범위

입력은 현재 `SELECT rowid,* FROM provider_daily_quotas WHERE provider='NAVER_LOCAL_SEARCH' AND is_cutover_anchor=1` 한 행 전체, 지정 운영자와 세션 ID, 검증 시각 `now`(UTC ISO), 원래 Worker 종료·전환 근거의 SHA-256, 서로 다른 이전/신규 Worker UUID다. 알려지지 않은 열·잘못된 값·전환 근거가 이미 있는 행은 거절한다. 근거 SHA와 Worker UUID의 형식 검사는 실제 종료 확인을 대신하지 않는다.

이전 Worker·cron 종료, 신규 코드의 모든 NAVER 경로가 원자 gate를 사용하는지, 기존 이력 보존을 먼저 확인한다. 최초 근거 3열은 NULL이고 anchor의 상태는 `CLOSED_LEGACY_UNCERTAIN`이어야 한다. rowid를 포함한 전 열을 비교한 뒤 `cutover_verified_at`, `ready_after_utc_day`, `cutover_receipt_ref`만 바꾼다. 카운터·baseline·anchor일·상태·갱신시각과 한도는 그대로다.

`naver_local_category_runs`에 RUNNING이 하나라도 남아 있으면 같은 transaction의 guard가 전환을 거절한다. 오래된 수동 작업은 15분이 지났다는 이유로 끝났다고 가정하지 않는다. 별도 종료 근거가 확인되기 전에는 HOLD를 유지하며, 이 도구는 기존 작업 상태를 변경하지 않는다.

준비일은 검증 시각의 UTC 날짜와 anchor 날짜 중 늦은 날짜에 하루를 더한다. 그 전에는 HOLD가 유지되며 날짜만 경과한 미검증 anchor는 열리지 않는다. 검증 시각보다 이르게 SQL을 적용하거나 다른 UTC 날짜에 적용하면 거절한다. 자정을 넘겼다면 새 시각·현재 행·근거를 다시 고정하고 재검토한다.

## 한정 실행 순서

1. 검증된 main·신규 Worker·migration 0053 및 B17 전환 조건을 확인한다. 지정 현재 ADMIN이 이메일 인증 완료·미제한 상태이며 세션이 유효해야 한다. 실제 사용자 권한을 새로 올리거나 인증 정보를 출력하지 않는다.
2. 입력과 생성한 SQL은 비공개 디렉터리·파일(0700/0600)에 보관한다. SQL에는 실행 세션 식별자가 포함되므로 저장소·위키·공개 로그에 올리지 않는다. 공개 증거에는 생성 SQL의 SHA-256과 비식별 결과만 남긴다.
3. 생성된 두 임시 trigger의 이름·내용을 검토하고, 기존 같은 이름이 없음을 확인한 뒤 `installSql`을 한 번 설치한다. `applySql`은 감사 한 행의 INSERT이며, 두 trigger가 현재 ADMIN/세션·날짜·전체 anchor snapshot을 검증하고 같은 transaction에서 3열만 갱신한다. 불일치는 감사와 변경을 함께 되돌린다.
4. 최초 적용은 정확한 감사 1행과 예상 3열 변경, 나머지 모든 필드/다른 행 보존을 확인한다. 같은 날짜·현재 권한으로 같은 apply를 재전송하면 새 변경 0이다. 감사 행이 없거나 anchor가 예상 결과와 다르면 성공으로 표시하지 않는다.
5. 성공/실패와 관계없이 `cleanupSql`로 이번 두 trigger를 제거하고 잔존 0을 확인한다. 생성된 각 SQL과 실제 결과를 대조하기 전에는 다음 단계로 가지 않는다.
6. 준비일 전후의 quota 상태를 읽기로 확인한다. 실제 NAVER probe·수동 수집은 하지 않는다. 다음 전체 UTC일의 기존 예약 gate가 기존 전역 20,000/지역 10,000 한도를 적용한다. 후속 전체 UTC일 관측과 실제 청구는 별도다.

이 하위 작업의 한도는 합동 B17 전체 예산 안에서 D1 조회·관리 8명령/SQL 16개다. 두 trigger 설치 2문, apply 1문, 정리 2문과 제한된 전후 조회, 필요한 경우 같은 manifest replay 1회만 포함한다. 기존 B17의 백업과 ADMIN 세션을 재사용한다. 자동 반복·새 migration·한도 증가·과거 집계 재작성은 없다. 적용 오류 또는 근거 불일치 시 HOLD를 유지하고 계획을 재검토한다. 운영 DB 전체 복원이나 카운터 환불은 이 범위에 없다.

2026-11-18 로컬 검증: 전환 도구 14건과 기존 quota 회귀 11건, 합계 Workers 통합 25건 통과. 현재/미래 준비일·필드 경합·인증 상태·RUNNING 작업·감사 marker 충돌·재실행 0건·trigger 정리를 확인했다. 독립 정적 리뷰에서 차단 사항 없음, Node 구문·diff 검사와 production dependency audit 0건을 확인했다. 원격 SQL·실제 NAVER 호출·운영 변경은 수행하지 않았다.
