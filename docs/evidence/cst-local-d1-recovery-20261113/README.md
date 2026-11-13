# CST W07/T08 local D1 리허설 증거

추적 #375 / SSOT #354. 2026-11-13, 담당 Jay/Codex. [실행 절차](../../operations/cst-local-d1-recovery.md).

- 원본 실패는 `initial-d1-authorizer-failure.json`에 보존했다. source migration·합성 seed는 성공했지만 D1 API의 `PRAGMA integrity_check`가 `SQLITE_AUTH`로 거절되어 전체 실행은 FAIL이었다.
- 원본 DB 직접 열기 명령은 자동 검토(quant-guard)에서 거절됐다. 안내된 scratch 복사본 경계를 적용해 생성 DB/WAL/SHM을 복사한 뒤 복사본만 읽기 전용 검사한다. 원본/운영 DB의 직접 open으로 우회하지 않았다.
- 수정 후 `ffd2557`에서 실제 local 흐름을 1회 실행해 PASS. `verified-local-round-trip.json`에 코드·migration hash, SQL export hash, source/restored 동일 digest, 관계별1개·FK0·D1 quick_check 및 source/restored scratch 전체 integrity ok를 기록했다.
- source의 합성 이름 변경 뒤에도 백업시점 원래 값을 복원했고, 손상/누락 백업은 import 전에 거절했다. 실제 운영/개인정보·R2·외부 API·요금 발생 없음.
- 범위 unit 5개(명시 opt-in/실행 entry 원격 인자 거절, 소유경로·regular/symlink/상한/해시, 복원 불일치 거절). 같은 branch에서 RED(module 미구현)→GREEN, Node syntax/diff-check 검증.
- 최초 actual의 migration 목록은 0041 포함·0040 미포함이다. backend 병합 뒤 최신 main에서 재검증할 필요를 유지한다. 이 증거는 종합 T08·운영 복구/백업 SLA 완료가 아니다.

- 후속 경계 보강: 최초 export read 전에 크기를 검사하도록 추가하고 executable-entry 원격 인자 거절 시험을 보강했다. 최종 코드 `8c6584f`에서 새 합성 run을 1회 수행해 동일 수용조건 PASS를 확인했다(`bounded-export-final-run.json`). 기존 실패·성공 JSON은 유지하며 migration 목록은 이전 성공 JSON과 동일 digest로 참조한다.

- 독립 리뷰 후 표본만 남고 도메인 table/trigger/row가 누락되는 반례를 RED로 재현하고, 모든 프로젝트 소유 table/index/view/trigger의 type/name/table/SQL digest 및 각 도메인 table의 전체 row count·정렬 데이터 digest를 비교하도록 보강했다. `sqlite_*`·`_cf_*`·`d1_migrations`와 그 소유 객체만 플랫폼 메타데이터로 명시 제외한다.
- 최신 main `3ab7256` 반영 후 실행 코드 `4bde49f`의 actual1회가 PASS했다(`complete-domain-final-run.json`): 도메인67테이블·156행의 schema/data digest와 물리/FK 검사 일치. 각 table/객체의 개별 digest 원장은 해당 run의 `project-source.json`·`project-restored.json`에 보존한다. unit6/6 PASS. 이전 표본 검증 결과는 확장된 전체 도메인 검증으로 소급해서 표시하지 않는다.
