# B17 격리 전환용 R2 보호·이관 대조 도구

2026-11-18 · #460 / [격리 전환안 #470](https://github.com/taejunyun1/Tasted_it/pull/470) · **로컬 준비 / 운영 HOLD**. 이 변경은 합성 자원에서 확인할 전환 도구를 추가한다. 필수 CI 복구·통과와 병합, 원격 실행 범위가 명시된 별도 운영 PR 승인이 실제 실행의 전제다. #397은 HOLD를 유지한다.

## 실행 순서와 판정

| 순서 | 입력과 확인 | 보류 조건 |
| --- | --- | --- |
| 1. R2 보호 계획 | 예비 조회에서 원본·후보 계정/버킷, 보호 접두사, 승인 객체 목록, 종료 시각, 기존 lock 규칙 전체 및 digest를 비공개 입력으로 고정한다. 이 목록은 D1 장벽 확인 뒤 다시 대조한다. `planB17R2Locks`로 기존 규칙을 보존한 교체 본문을 준비한다. 운영 승인을 받은 어댑터는 `installB17R2Locks` 실행 전과 후에 전체 규칙을 읽고 비교한다. | Cloudflare PUT은 전체 교체이며 원자적 조건부 갱신이 없다. 규칙 변경 권한과 외부 작업을 단일 운영 창으로 통제할 수 없거나 재조회가 불일치하면 중단한다. |
| 2. D1 기준선 대조 | 승인 창에서 원본 0049 catalog를 확인하고 `buildB17FreezeStatements`의 246개 장벽을 한 D1 batch에 적용한다. 모든 82개 앱 테이블의 INSERT/UPDATE/DELETE를 거절하고 대표 쓰기 거부·읽기 성공을 확인한다. 별도 후보에 기존 schema·장부·데이터·rowid를 복원한 후 `verifyB17IsolatedD1`로 양쪽의 schema, 장부, FK, signed 64-bit rowid와 형식별 값을 대조한다. 후보는 원본의 장벽을 갖지 않는다. | 원격 batch 한도, 실제 DB ID, 원본 bookmark·보존 사본, 장벽의 정확한 DDL, 복구 순서를 확정하지 못하거나 양쪽 digest가 다르면 HOLD다. |
| 3. 사진 목록 확정 | 고정 D1에서 `readB17IsolatedR2References`로 리뷰어 사진 전 버전, TEMP 원본·보충 사진을 확인한다. 이름과 주소를 출력하지 않고 TEMP 보충 참조를 배치·감사 증거와 맞춘다. 각 필수 키는 승인 R2 목록에 정확히 한 번 존재해야 한다. 리뷰어는 저장 길이·MIME, TEMP는 기록된 SHA-256·MIME과도 일치해야 한다. | 누락·추가·중복 참조, 보존 대상과 삭제 대기 작업의 충돌, 해시나 메타데이터 불일치는 HOLD다. 비결속 업로드·정리 전용 키는 원본에서 남겨 두고 후보로 복사할 목록에서 제외한다. |
| 4. 후보 복사·대조 | `runB17IsolatedTransfer`의 승인 digest는 두 D1 ID, 고정 D1 snapshot, R2 manifest와 lock plan을 결속한다. D1 대조 → 참조 목록 대조 → 원본 조건부 읽기·검증 및 후보 create-only PUT → 후보의 바이트 SHA-256·길이·메타데이터·목록 대조 → D1 재대조 순으로 실행한다. | 원본 R2에 새로 생긴 미참조 키는 원본에 격리한다. 후보에 예상 외 객체가 있거나 결과가 불명확하면 중단한다. 기존 영수증이 있으면 재복사 대신 검증된 영수증 digest로 `reconcile`을 실행해 읽기만 한다. |
| 5. 이후 단계 | `VERIFIED_BASELINE` 증거가 확보된 뒤에만 #470의 고정 9개 migration을 승인된 후보에서 적용하고 보존·권한 검증을 진행한다. 후보 읽기와 쓰기 개방은 격리 전환안의 각 관문에서 별도로 판정한다. | 이 결과는 0049 기준선의 대조를 증명한다. 운영 DB 복원, 9개 migration 적용, 구버전 작업 종료, 서비스 전환은 각각 별도 증거가 필요하다. |

원본 lock은 보호 대상의 삭제와 덮어쓰기를 막는다. 새 키 생성까지 막는다고 간주하면 안 된다. 장벽·격리가 작동하는 동안에도 구버전 HTTP, `waitUntil`, 이미 발행한 R2 호출의 종료 상태는 `UNKNOWN`으로 기록한다. 원본 보호 해제·후보 삭제·후보 재사용은 이전 요청과 개인정보·권리 보존 의무를 검토한 뒤 결정한다. [R2 Bucket locks](https://developers.cloudflare.com/r2/buckets/bucket-locks/) · [전체 규칙 교체 API](https://developers.cloudflare.com/api/resources/r2/subresources/buckets/subresources/locks/methods/update/) · [Workers R2 조건부 연산](https://developers.cloudflare.com/r2/api/workers/workers-api-reference/#conditional-operations) · [D1 batch](https://developers.cloudflare.com/d1/worker-api/d1-database/#batch)

## 도구 입력과 증거

- [R2 도구](../../scripts/b17-isolated-r2.mjs)는 `b17-isolated-r2-v1` 목록의 account ID, distinct bucket 이름, freeze/기한, 허용 prefix와 객체별 버전·ETag·길이·업로드 시각·SHA-256·HTTP 및 사용자 메타데이터·스토리지 클래스를 받는다. 허용 상한은 객체 1,000개, 객체당 10 MiB, 합계 64 MiB, 30분이다. 기존 lock 규칙과 교체 규칙은 전체 구성으로 대조한다. 원본 객체 본문을 SHA-256으로 검증한 뒤 후보에 한 번만 생성한다.
- [D1 도구](../../scripts/b17-isolated-d1.mjs)는 고정 0049 D1 두 개를 받는다. 후보 기준선에 대한 snapshot 증거는 형식이 붙은 값·정밀 rowid와 schema 및 migration 장부를 묶는다. 행 수·요청 크기 상한을 넘으면 작은 성공으로 보고하지 않고 중단한다.
- [통합 도구](../../scripts/b17-isolated-transfer.mjs)는 `hashB17TransferApproval`로 승인 본문을 고정하고 `runB17IsolatedTransfer(input, adapters)`로 대조한다. `input`은 `mode`, `approval`, `reviewedApprovalSha256`, `manifest`, `lockPlan`을 포함한다. 재대조에는 보존된 `receipt`와 그 저장 증거에서 독립적으로 얻은 `expectedReceiptSha256`를 전달한다.
- 어댑터는 두 D1과 두 R2의 물리 식별자를 신뢰 가능한 계정/바인딩 조회로 확인하고, 지정된 원본 규칙의 읽기·교체와 후보의 조건부 생성만 제공해야 한다. 영수증 저장소는 후보 버킷별로 첫 기록을 생성 전용으로 저장하고, 이후 각 시도 전에 직전 digest를 조건으로 내구성 있게 갱신한다. 전송 결과가 불명확하면 기존 후보는 읽기 대조만 한다. 새 실행이 필요하면 별도 승인으로 격리된 새 후보를 마련한다. 설치 함수는 독립 검토에서 승인된 `reviewedPlanSha256`를 받아야 한다. 운영 PR은 adapter 배포·자격, 대상 ID, 외부 규칙 변경 통제, 단일 실행자, 백업·정리 권한, 후보의 트래픽 차단과 단일 쓰기 권한을 확인한다. 실제 계정과 계획 수량의 D1·R2 요청·저장·시간 한도도 함께 산정한다. 복사 N건은 객체 호출 4N회, lock 규칙 읽기 최대 5N+4회, 후보 목록 조회 최대 8×(2N+2)페이지, 영수증 저장 최대 3N+2회다. 이는 어댑터 호출 설계 상한이고 계정 한도나 실제 소요 시간은 리허설에서 확인한다.
- 실제 객체 키·버킷·DB ID·원본 규칙·manifest·영수증은 권한 있는 비공개 저장소에 둔다. Wiki와 PR에는 PR 번호, 비식별 집계와 코드·CI 상태를 남긴다.

## 지정 로컬 검증

```sh
pnpm exec vitest run --config vitest.b17-isolated.config.ts
```

지정 검증 8/8 통과. 두 로컬 D1, 두 로컬 R2와 합성 객체로 0049 baseline, 후보 동일 키 변경·응답 유실, 사진 참조 누락 및 D1 재대조 실패를 확인했다. R2 규칙 관리 API는 테스트 더블로 확인한다. 로컬 R2가 비워 두는 스토리지 클래스는 fixture 값으로 채워 비교하므로 실제 클래스 보존은 운영 승인 뒤 확인한다. 실제 Cloudflare 규칙 적용·복사·배포도 이후 검증 항목이다.
