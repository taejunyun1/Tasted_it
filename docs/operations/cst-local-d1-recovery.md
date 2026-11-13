# CST 합성 local D1 백업·복원 리허설

상위 [CST SSOT](../plans/2026-11-13-cst-service-ssot.md)의 W07/T08 중 **SQL export와 격리 복원의 재현성**만 확인한다. 실제 운영 D1/R2·사진·사용자 데이터·Worker rollback·백업 주기/RPO/RTO를 검증하거나 약정하지 않는다.

## 실행

현재 checkout의 의존성을 고정 설치한 뒤, Node.js 내장 `node:sqlite`를 사용할 수 있는 기존 개발 환경에서 명시 opt-in으로만 실행한다. 검증 환경은 Node 22.23.0 / Wrangler 4.118.0이다. `node:sqlite`는 이 버전에서 실험 기능 경고를 출력하며 운영 Worker에는 포함되지 않는다. 지원하지 않는 Node 환경은 실패로 남기며 새 의존성을 자동 설치하지 않는다.

```sh
node scripts/cst-local-d1-recovery.mjs --run
```

다른 인자·DB·SQL·config·환경 선택·원격 flag는 받지 않는다. 일반 테스트에서는 실제 export/import가 실행되지 않는다.

```sh
pnpm test tests/unit/cst-local-d1-recovery.test.ts
```

도구는 새 canonical 임시 run 디렉터리(0700), 서로 다른 source/restored 하위 디렉터리·생성 D1 config·무작위 가상 DB ID를 만든다. 프로젝트 운영 config, 기존 `.wrangler` 상태와 `.env`/`.dev.vars`·자격증명을 복사하지 않는다. Wrangler에는 선택한 최소 환경과 항상 `--local`을 전달한다. 설치된 Wrangler의 `d1 export`는 `--persist-to`를 지원하지 않으므로 source/restored의 cwd와 기본 상태를 따로 둔다.

## 순서와 판정

1. 현재 저장소의 migration 파일명·SHA-256과 실행 코드 SHA를 기록한다. migration은 수정하지 않고 source local D1에 적용한다.
2. 고정 합성 category·place·관계 1개씩을 추가한다. 실제 자료를 seed로 복제하지 않는다.
3. D1 API의 `quick_check`, `foreign_key_check`, 합성 표본 건수·정렬 행을 읽는다.
4. D1 API가 `integrity_check`를 허용하지 않으므로, Wrangler 프로세스 종료 후 **생성 local DB와 WAL/SHM을 새 scratch 폴더에 복사한 뒤 복사본만** Node SQLite API의 `readOnly:true`로 전체 `integrity_check`한다. 원본 파일을 이 API로 직접 열지 않는다. 파일 모호함·symlink·크기 상한·검사 실패는 PASS로 바꾸지 않는다.
5. SQL export를 32MiB 이하의 regular 파일로 한정하고 SHA-256을 기록한다. 소유 경로 밖·symlink·누락·0바이트·크기 초과·해시 불일치를 import 전에 거절한다.
6. source의 합성 장소 이름을 바꾸고 실제 값 차이를 확인한다. 검증된 백업 bytes의 독점 생성 사본만 별도의 빈 local D1으로 import한다.
7. 복원 DB의 quick/FK·전체 integrity(별도 scratch 복사본)·합성 건수·정렬 digest가 백업 시점과 일치해야 PASS다. SQL export bytes의 digest와 행 digest는 서로 다른 증거다.
8. 같은 실행에서 손상된 백업 사본과 누락 백업을 검사하고 **import 전 거절**을 확인한다. 손상된 SQL을 실행하거나 복원 성공으로 표시하지 않는다.

`result.json`은 생성한 run 폴더에 남고 stdout에는 비민감 요약만 출력된다. 실행 원본·복원·백업·실패 자료는 자동 삭제/재사용/재시도하지 않는다. 작업자는 이 실행이 생성한 정확한 폴더를 확인한 뒤 그 합성 폴더만 정리할 수 있다. 프로젝트/기존 로컬 상태를 삭제하는 정리 명령은 제공하지 않는다.

## 한계와 후속

표본 digest는 고정 category/place/관계의 값·연결을 확인하며 모든 업무 테이블 의미를 검증하지 않는다. 전체 DB의 물리 integrity와 FK 검사는 별도로 수행한다. 같은 사용자 계정의 악성 프로세스를 격리하는 sandbox는 아니며 private 폴더·검증 사본을 사용한다.

처음 검증한 main에는 `0041` guest migration이 있고 `0040` 리뷰어 migration은 아직 병합 전이었다. 순번의 간극을 기존 파일 수정으로 메우지 않았다. backend 병합 뒤 최신 main에서 별도 run으로 전체 migration 적용·복구를 재검증해야 한다. 사진/R2 일관성·삭제 후 백업 복원으로 정보가 재유입되지 않는 운영 정책·복구 시점/권한·원격 복원·백업 보관/암호화·RPO/RTO는 별도 작업이다. 이 도구의 PASS로 대체하지 않는다.

도구를 제거하려면 해당 PR을 revert한다. 운영 데이터 rollback이나 migration 역변경은 없다.
