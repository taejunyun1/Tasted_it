# CST W07/T08 local D1 리허설 증거

추적 #375 / SSOT #354. 2026-11-13, 담당 Jay/Codex. [실행 절차](../../operations/cst-local-d1-recovery.md).

- 원본 실패는 `initial-d1-authorizer-failure.json`에 보존했다. source migration·합성 seed는 성공했지만 D1 API의 `PRAGMA integrity_check`가 `SQLITE_AUTH`로 거절되어 전체 실행은 FAIL이었다.
- 원본 DB 직접 열기 명령은 자동 검토(quant-guard)에서 거절됐다. 안내된 scratch 복사본 경계를 적용해 생성 DB/WAL/SHM을 복사한 뒤 복사본만 읽기 전용 검사한다. 원본/운영 DB의 직접 open으로 우회하지 않았다.
- 수정 후 `ffd2557`에서 실제 local 흐름을 1회 실행해 PASS. `verified-local-round-trip.json`에 코드·migration hash, SQL export hash, source/restored 동일 digest, 관계별1개·FK0·D1 quick_check 및 source/restored scratch 전체 integrity ok를 기록했다.
- source의 합성 이름 변경 뒤에도 백업시점 원래 값을 복원했고, 손상/누락 백업은 import 전에 거절했다. 실제 운영/개인정보·R2·외부 API·요금 발생 없음.
- 범위 unit 5개(명시 opt-in/실행 entry 원격 인자 거절, 소유경로·regular/symlink/상한/해시, 복원 불일치 거절). 같은 branch에서 RED(module 미구현)→GREEN, Node syntax/diff-check 검증.
- 최초 actual의 migration 목록은 0041 포함·0040 미포함이다. backend 병합 뒤 최신 main에서 재검증할 필요를 유지한다. 이 증거는 종합 T08·운영 복구/백업 SLA 완료가 아니다.
